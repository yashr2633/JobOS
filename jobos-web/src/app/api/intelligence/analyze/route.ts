/**
 * POST /api/intelligence/analyze
 *
 * Runs the full Job Intelligence pipeline for one application/resume pair:
 *
 *   Input validation
 *     → Auth + ownership check (defence-in-depth, matches Sprint 4 pattern)
 *     → Quota check
 *     → JD parse  (cached per application; skipped when text unchanged)
 *     → Resume parse  (cached per resume; reused across all applications)
 *     → Deterministic scoring  (pure function, no LLM involvement)
 *     → LLM interpretation  (advisory text only; cannot alter the score)
 *     → Persist result
 *     → Return MatchResult
 *
 * The run row is created in 'pending' state before heavy work begins and
 * transitioned to 'processing' → 'complete' / 'failed'. A future background
 * worker can claim 'pending' rows without any schema change.
 *
 * Runtime: nodejs (required for AbortController + long-running awaits).
 * maxDuration: 60 s — three chained LLM calls at 18 s each + Supabase I/O.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  createAnalysisRun,
  markAnalysisProcessing,
  completeAnalysisRun,
  failAnalysisRun,
  saveParsedJD,
  countAnalysesSince,
  getApplicationIntelligenceInput,
  saveJobDescription,
} from "@/lib/api/intelligence";
import { fetchResume, saveResumeParse } from "@/lib/api/resumes";
import { validateInputText, validateParsedJD, validateParsedResume, validateMatchInterpretation } from "@/lib/ai/schemas";
import { scoreMatch } from "@/lib/ai/scoring";
import { generateStructured, AiGatewayError } from "@/lib/ai/gateway";
import type { AiFailureCategory } from "@/lib/ai/providers/types";
import {
  JD_PARSE_SYSTEM,
  RESUME_PARSE_SYSTEM,
  INTERPRETATION_SYSTEM,
  buildJdParsePrompt,
  buildResumeParsePrompt,
  buildInterpretationPrompt,
} from "@/lib/ai/prompts";
import type { ParsedJD, ParsedResume } from "@/lib/ai/types";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Rolling-window quota: max analyses per user per 24 hours. */
function getDailyLimit(): number {
  const raw = process.env.AI_DAILY_ANALYSIS_LIMIT;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 20;
}

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

function ok(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status });
}

function err(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Map a normalized gateway failure onto a user-safe message and HTTP status.
 *
 * Deliberately never mentions a provider name, vendor error text, or the word
 * "provider": the user cannot act on which vendor failed, and leaking it
 * exposes internal architecture. Every message tells the user what to do next.
 */
function describeAiFailure(category: AiFailureCategory): {
  message: string;
  status: number;
} {
  switch (category) {
    case "unconfigured":
      return {
        message:
          "AI configuration is missing. Please contact support so we can enable analysis.",
        status: 503,
      };
    case "auth":
    case "billing":
      return {
        message:
          "AI service is temporarily unavailable. Our team has been notified — please try again later.",
        status: 503,
      };
    case "rate_limit":
      return {
        message:
          "AI services are busy right now. Please wait a moment and try again.",
        status: 503,
      };
    case "timeout":
      return {
        message: "Resume analysis took too long. Please try again.",
        status: 504,
      };
    case "invalid_response":
      return {
        message:
          "Resume analysis could not be completed. Please try again in a moment.",
        status: 502,
      };
    case "unavailable":
    case "unknown":
    default:
      return {
        message: "AI service temporarily unavailable; please retry.",
        status: 503,
      };
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── 1. Parse request body ────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err("Request body must be valid JSON.", 400);
  }

  // ── 0. Check for abort signal ────────────────────────────────────────────
  // If the client has aborted the request, fail fast without doing work.
  if (request.signal.aborted) {
    return err("Analysis request was cancelled.", 499);
  }

  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body)
  ) {
    return err("Request body must be a JSON object.", 400);
  }

  const { applicationId, resumeId, jobDescription } = body as Record<string, unknown>;

  if (typeof applicationId !== "string" || applicationId.trim() === "") {
    return err("applicationId is required.", 400);
  }
  if (typeof resumeId !== "string" || resumeId.trim() === "") {
    return err("resumeId is required.", 400);
  }

  // jobDescription is optional — if omitted, the stored text is used.
  const incomingJd =
    typeof jobDescription === "string" ? jobDescription : null;

  // ── 2. Authenticate ──────────────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return err("Unauthorized.", 401);
  }

  // ── 3. Validate incoming JD text (if provided) ───────────────────────────
  if (incomingJd !== null) {
    const textValidation = validateInputText(incomingJd, "Job description");
    if (!textValidation.ok) {
      return err(textValidation.error, 400);
    }
  }

  // ── 4. Resolve JD text: persist new text, then read stored state ─────────
  if (incomingJd !== null) {
    await saveJobDescription(supabase, applicationId.trim(), incomingJd.trim());
  }

  const intelligenceInput = await getApplicationIntelligenceInput(
    supabase,
    applicationId.trim()
  );

  if (intelligenceInput === null) {
    return err("Application not found.", 404);
  }

  const jdText = intelligenceInput.jobDescription;
  if (!jdText || jdText.trim().length < 50) {
    return err(
      "This application has no job description. Paste the job description text to enable analysis.",
      422
    );
  }

  // ── 5. Fetch and validate resume ─────────────────────────────────────────
  const resume = await fetchResume(supabase, resumeId.trim());
  if (resume === null) {
    return err("Resume not found.", 404);
  }

  const resumeText = resume.extractedText;
  if (!resumeText || resumeText.trim().length < 50) {
    return err(
      "This resume has no extracted text. Add resume text to enable analysis.",
      422
    );
  }

  const resumeTextValidation = validateInputText(resumeText, "Resume");
  if (!resumeTextValidation.ok) {
    return err(resumeTextValidation.error, 400);
  }

  // ── 6. Quota check ───────────────────────────────────────────────────────
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1_000);
  const recentCount = await countAnalysesSince(supabase, dayAgo);
  const limit = getDailyLimit();

  if (recentCount >= limit) {
    return err(
      `Daily analysis limit (${limit}) reached. Try again tomorrow.`,
      429
    );
  }

  // ── 7. Create pending run (ownership verified inside createAnalysisRun) ──
  let run = await createAnalysisRun(supabase, applicationId.trim(), resumeId.trim());
  await markAnalysisProcessing(supabase, run.id);

  // ── 8. Pipeline ──────────────────────────────────────────────────────────
  //
  // Each stage is wrapped so a failure marks the run 'failed' and returns a
  // clean error response rather than an unhandled 500.
  //
  // Error classification:
  //   ProviderConfigError  → 503 (operator error, not the user's fault)
  //   ProviderTimeoutError → 504
  //   ProviderResponseError → 502
  //   ProviderParseError   → 502
  //   Validation failure   → 422 (bad AI output, retriable)

  try {
    // -- Stage 2a: Parse JD (use cache if available) -------------------------
    let parsedJd: ParsedJD;

    if (intelligenceInput.parsedJd !== null) {
      // Cache hit — no LLM call needed.
      parsedJd = intelligenceInput.parsedJd;
    } else {
      // Structured extraction is a lightweight task: cheaper model tier.
      const jdResult = await generateStructured({
        systemPrompt: JD_PARSE_SYSTEM,
        userContent: buildJdParsePrompt(jdText),
        task: "lightweight",
        validate: validateParsedJD,
        label: "jd_parse",
      });

      parsedJd = jdResult.value;
      // Persist cache so subsequent analyses skip this call.
      await saveParsedJD(supabase, applicationId.trim(), parsedJd);
    }

    // -- Stage 2b: Parse resume (use cache if available) ---------------------
    let parsedResume: ParsedResume;

    if (resume.parsed !== null) {
      parsedResume = resume.parsed;
    } else {
      const resumeResult = await generateStructured({
        systemPrompt: RESUME_PARSE_SYSTEM,
        userContent: buildResumeParsePrompt(resumeText),
        task: "lightweight",
        validate: validateParsedResume,
        label: "resume_parse",
      });

      parsedResume = resumeResult.value;
      await saveResumeParse(supabase, resumeId.trim(), parsedResume);
    }

    // -- Stage 3: Deterministic scoring (pure, no LLM) ----------------------
    const scoreResult = scoreMatch(parsedJd, parsedResume);

    // -- Stage 4: LLM interpretation (reasoning model) ----------------------
    const matchedRequired = scoreResult.requiredSkills.filter((s) => s.matched).length;
    const matchedPreferred = scoreResult.preferredSkills.filter((s) => s.matched).length;

    // Interpretation is the "deep" task: strongest configured model tier.
    const interpretationResult = await generateStructured({
      systemPrompt: INTERPRETATION_SYSTEM,
      userContent: buildInterpretationPrompt(
        scoreResult.score,
        scoreResult.missingRequiredSkills,
        scoreResult.missingPreferredSkills,
        scoreResult.experienceGap?.gapYears ?? null,
        scoreResult.educationGap?.met ?? null,
        matchedRequired,
        scoreResult.requiredSkills.length,
        matchedPreferred,
        scoreResult.preferredSkills.length
      ),
      task: "deep",
      validate: validateMatchInterpretation,
      label: "interpretation",
    });

    // -- Stage 5: Persist and return ----------------------------------------
    // Record the model that actually served the request, including a fallback,
    // so historical results stay auditable.
    const completed = await completeAnalysisRun(supabase, run.id, {
      score: scoreResult,
      interpretation: interpretationResult.value,
      model: `${interpretationResult.providerId}/${interpretationResult.model}`,
    });

    return ok(completed, 200);

  } catch (error: unknown) {
    let message = "Resume analysis could not be completed. Please try again.";
    let status = 500;

    if (error instanceof AiGatewayError) {
      // Every provider in the chain failed. `category` is already normalized.
      const described = describeAiFailure(error.category);
      message = described.message;
      status = described.status;
      // Metadata only — the gateway already logged per-attempt detail, and
      // neither resume nor JD content is included here.
      console.error(
        "[analyze] AI gateway exhausted:",
        JSON.stringify({
          requestId: error.requestId,
          category: error.category,
          attempts: error.attempts.map((a) => ({
            provider: a.providerId,
            category: a.category,
            durationMs: a.durationMs,
          })),
        })
      );
    } else {
      // Log unknown errors with enough context to debug, but never expose
      // raw error details to the client.
      console.error("[analyze] Unexpected error:", error);
    }

    // Best-effort: mark the run failed so the UI can show a retry.
    try {
      await failAnalysisRun(supabase, run.id, message);
    } catch {
      // Ignore — the run may already be in a terminal state.
    }

    return err(message, status);
  }
}

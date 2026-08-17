/**
 * POST /api/intelligence/tailor
 *
 * Produces a tailored version of an EXISTING resume for one application's job
 * description, reusing the same AI gateway, resume model, and JD source as
 * `/api/intelligence/analyze`. It introduces no new table and no new analysis
 * engine: it reads the resume's extracted text and the application's stored JD,
 * asks the model to reorganize/reword only truthful existing content, validates
 * the structured result, and returns it.
 *
 * Nothing is persisted — tailoring is a stateless transform the user previews,
 * edits, and downloads on the client. That keeps this additive with no schema
 * change.
 *
 * Runtime nodejs + 60s to match the analyze route's LLM budget.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getApplicationIntelligenceInput } from "@/lib/api/intelligence";
import { fetchResume } from "@/lib/api/resumes";
import { validateInputText } from "@/lib/ai/schemas";
import { generateStructured, AiGatewayError } from "@/lib/ai/gateway";
import {
  TAILOR_RESUME_SYSTEM,
  TAILORING_NOTE,
  buildTailorResumePrompt,
  validateTailoredResume,
  verifyTailoredResume,
} from "@/lib/ai/tailorResume";

function err(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err("Request body must be valid JSON.", 400);
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return err("Request body must be a JSON object.", 400);
  }

  const { applicationId, resumeId } = body as Record<string, unknown>;
  if (typeof applicationId !== "string" || applicationId.trim() === "") {
    return err("applicationId is required.", 400);
  }
  if (typeof resumeId !== "string" || resumeId.trim() === "") {
    return err("resumeId is required.", 400);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return err("Unauthorized.", 401);

  // JD comes from the application (ownership is enforced inside this read).
  const intelligenceInput = await getApplicationIntelligenceInput(
    supabase,
    applicationId.trim()
  );
  if (intelligenceInput === null) return err("Application not found.", 404);

  const jdText = intelligenceInput.jobDescription;
  if (!jdText || jdText.trim().length < 50) {
    return err(
      "This application has no job description. Add one to tailor a resume for it.",
      422
    );
  }

  // Resume text comes from the resume the user selected (ownership enforced).
  const resume = await fetchResume(supabase, resumeId.trim());
  if (resume === null) return err("Resume not found.", 404);

  const resumeText = resume.extractedText;
  if (!resumeText || resumeText.trim().length < 50) {
    return err(
      "This resume has no extracted text to tailor. Upload a resume with readable text.",
      422
    );
  }

  const resumeValidation = validateInputText(resumeText, "Resume");
  if (!resumeValidation.ok) return err(resumeValidation.error, 400);
  const jdValidation = validateInputText(jdText, "Job description");
  if (!jdValidation.ok) return err(jdValidation.error, 400);

  try {
    const result = await generateStructured({
      systemPrompt: TAILOR_RESUME_SYSTEM,
      userContent: buildTailorResumePrompt(resumeText, jdText),
      // Reasoning task: the strongest configured tier, same as interpretation.
      task: "deep",
      validate: validateTailoredResume,
      label: "resume_tailor",
    });

    // Contact details are verified against the SOURCE resume text before they
    // leave the server: any name, email, phone, or handle the model produced that
    // does not literally appear in the resume is dropped. A prompt instruction
    // cannot enforce that; this can.
    const verified = verifyTailoredResume(result.value, resumeText);

    return NextResponse.json(
      {
        tailored: verified,
        // Fixed, server-authored guarantee. Never model-supplied.
        note: TAILORING_NOTE,
        model: `${result.providerId}/${result.model}`,
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    if (error instanceof AiGatewayError) {
      console.error(
        "[tailor] AI gateway exhausted:",
        JSON.stringify({ requestId: error.requestId, category: error.category })
      );
      return err(
        "Resume tailoring is temporarily unavailable. Please try again in a moment.",
        503
      );
    }
    console.error("[tailor] Unexpected error:", error);
    return err("Resume tailoring could not be completed. Please try again.", 500);
  }
}

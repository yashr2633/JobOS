/**
 * AI provider abstraction.
 *
 * Keeps the application decoupled from any specific AI vendor. The contract is
 * simple: send text, get a parsed JSON object back. All callers go through
 * `generateJson`; switching providers means updating only this file.
 *
 * Currently backed by Anthropic. The key is read from a server-only env var
 * (no NEXT_PUBLIC_ prefix) so it is never shipped to the browser.
 *
 * Model tiers
 * -----------
 * - PARSING_MODEL  (cheaper/faster) – structured extraction: JD and resume.
 * - REASONING_MODEL (stronger/pricier) – interpretation and recommendations.
 *
 * Both are configurable via env vars so the choice can be adjusted without a
 * code change.
 */

// ---------------------------------------------------------------------------
// Environment helpers — server-only
// ---------------------------------------------------------------------------

function getApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key.trim() === "") {
    throw new ProviderConfigError(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local (server-only, no NEXT_PUBLIC_ prefix)."
    );
  }
  return key.trim();
}

function getParsingModel(): string {
  return (
    process.env.ANTHROPIC_PARSING_MODEL?.trim() || "claude-haiku-4-5"
  );
}

function getReasoningModel(): string {
  return (
    process.env.ANTHROPIC_REASONING_MODEL?.trim() || "claude-sonnet-4-5"
  );
}

// ---------------------------------------------------------------------------
// Typed errors — lets callers distinguish config, timeout, and upstream issues
// ---------------------------------------------------------------------------

export class ProviderConfigError extends Error {
  readonly type = "config" as const;
  constructor(message: string) {
    super(message);
    this.name = "ProviderConfigError";
  }
}

export class ProviderTimeoutError extends Error {
  readonly type = "timeout" as const;
  constructor(timeoutMs: number) {
    super(`AI request timed out after ${timeoutMs}ms.`);
    this.name = "ProviderTimeoutError";
  }
}

export class ProviderResponseError extends Error {
  readonly type = "response" as const;
  readonly statusCode: number;
  /** True when the upstream error indicates an account/billing problem
   *  (e.g. insufficient credits) rather than a transient or request issue. */
  readonly isBillingIssue: boolean;
  constructor(message: string, statusCode: number, isBillingIssue = false) {
    super(message);
    this.name = "ProviderResponseError";
    this.statusCode = statusCode;
    this.isBillingIssue = isBillingIssue;
  }
}

export class ProviderParseError extends Error {
  readonly type = "parse" as const;
  constructor(message: string) {
    super(message);
    this.name = "ProviderParseError";
  }
}

export type ProviderError =
  | ProviderConfigError
  | ProviderTimeoutError
  | ProviderResponseError
  | ProviderParseError;

// ---------------------------------------------------------------------------
// Model tier selector
// ---------------------------------------------------------------------------

export type ModelTier = "parsing" | "reasoning";

export function modelIdForTier(tier: ModelTier): string {
  return tier === "parsing" ? getParsingModel() : getReasoningModel();
}

// ---------------------------------------------------------------------------
// Core call
// ---------------------------------------------------------------------------

/**
 * Default timeout per request. Three chained calls at this limit still fit
 * within a 60 s `maxDuration` with headroom for Supabase I/O.
 */
const DEFAULT_TIMEOUT_MS = 18_000;

/**
 * Retry once on transient upstream errors (5xx). Does not retry on auth
 * failures, quota errors, or validation failures so we don't double-spend.
 */
const MAX_RETRIES = 1;

const TRANSIENT_STATUS_CODES = new Set([429, 500, 502, 503, 529]);

interface AnthropicMessage {
  role: "user";
  content: string;
}

interface AnthropicRequest {
  model: string;
  max_tokens: number;
  system: string;
  messages: AnthropicMessage[];
}

interface AnthropicTextBlock {
  type: "text";
  text: string;
}

interface AnthropicResponse {
  content: AnthropicTextBlock[];
}

async function callAnthropic(
  request: AnthropicRequest,
  apiKey: string,
  timeoutMs: number
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      (err.name === "AbortError" || err.message.includes("aborted"))
    ) {
      throw new ProviderTimeoutError(timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      detail = body?.error?.message ?? "";
    } catch {
      // Ignore — use the status text instead.
    }

    // Anthropic reports insufficient account credits as a 400 with this
    // specific message. Surfacing it distinctly lets the route return a
    // clear, actionable error instead of a generic "provider error".
    const isBillingIssue =
      response.status === 400 && /credit balance is too low/i.test(detail);

    throw new ProviderResponseError(
      `Anthropic API error ${response.status}: ${detail || response.statusText}`,
      response.status,
      isBillingIssue
    );
  }

  const body = (await response.json()) as AnthropicResponse;
  const text = body?.content?.[0]?.text ?? "";

  if (!text) {
    throw new ProviderResponseError(
      "Anthropic returned an empty response body.",
      200
    );
  }

  return text;
}

function extractJson(raw: string): unknown {
  // The model may wrap JSON in a markdown code fence.
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenceMatch ? fenceMatch[1] : raw).trim();

  try {
    return JSON.parse(candidate);
  } catch {
    throw new ProviderParseError(
      `Model response was not valid JSON. First 200 chars: ${candidate.slice(0, 200)}`
    );
  }
}

/**
 * Send a single prompt, return a parsed JSON object.
 *
 * @param systemPrompt  Instruction context; injected before the user turn.
 * @param userContent   The variable part of the request (text to analyse).
 * @param tier          Which model pool to use.
 * @param maxTokens     Upper bound on the response; defaults are set per tier.
 * @param timeoutMs     Per-request timeout.
 */
export async function generateJson(
  systemPrompt: string,
  userContent: string,
  tier: ModelTier,
  maxTokens?: number,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<unknown> {
  const apiKey = getApiKey(); // Throws ProviderConfigError if absent.
  const model = modelIdForTier(tier);
  const tokens = maxTokens ?? (tier === "parsing" ? 1_024 : 2_048);

  const request: AnthropicRequest = {
    model,
    max_tokens: tokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userContent }],
  };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    if (attempt > 0) {
      // Brief back-off before the single retry.
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }

    try {
      const raw = await callAnthropic(request, apiKey, timeoutMs);
      return extractJson(raw);
    } catch (err) {
      // Retry only on known transient errors.
      if (
        err instanceof ProviderResponseError &&
        TRANSIENT_STATUS_CODES.has(err.statusCode) &&
        attempt < MAX_RETRIES
      ) {
        lastError = err;
        continue;
      }
      throw err;
    }
  }

  throw lastError ?? new ProviderResponseError("Exhausted retries.", 0);
}

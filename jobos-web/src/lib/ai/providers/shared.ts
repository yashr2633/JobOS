/**
 * Helpers shared by every provider adapter.
 *
 * Keeping HTTP status classification and JSON extraction here means all
 * providers report failures using the same normalized categories, so the
 * gateway's routing logic works identically regardless of vendor.
 */

import { AiProviderError, type AiFailureCategory } from "./types.ts";

/**
 * Map an HTTP status (plus the upstream error text) onto a normalized
 * category.
 *
 * Billing detection is deliberately text-based: providers disagree on status
 * codes for exhausted credit. Anthropic returns 400 with "credit balance is
 * too low"; OpenAI-compatible gateways typically use 402, and some use 403
 * with a quota message. Treating these as `billing` rather than a transient
 * fault avoids pointless retries against a provider that cannot recover
 * without human action.
 */
export function classifyHttpFailure(
  status: number,
  detail: string
): AiFailureCategory {
  const text = detail.toLowerCase();

  const looksBilling =
    /credit balance is too low|insufficient (credit|balance|funds|quota)|billing|payment required|exceeded your current quota/.test(
      text
    );

  if (status === 402) return "billing";
  if (looksBilling && (status === 400 || status === 403 || status === 429)) {
    return "billing";
  }

  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "unavailable";

  // Remaining 4xx are request-shape problems. They will not fix themselves on
  // this provider, so treat them as invalid rather than transient.
  if (status >= 400) return "invalid_response";

  return "unknown";
}

/** Extract the upstream error message from a failed response, safely. */
export async function readErrorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: { message?: string } | string;
      message?: string;
    };
    if (typeof body?.error === "string") return body.error;
    return body?.error?.message ?? body?.message ?? response.statusText;
  } catch {
    return response.statusText;
  }
}

/**
 * Parse a model's text output into JSON.
 *
 * Models sometimes wrap JSON in markdown fences or add a leading sentence
 * despite instructions, so this tolerates both before giving up. Failure is
 * reported as `invalid_response` so the gateway fails over to another
 * provider instead of surfacing an error to the user.
 */
export function parseJsonFromModelText(
  raw: string,
  providerId: string
): unknown {
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  let candidate = (fenceMatch ? fenceMatch[1] : raw).trim();

  // Fall back to the outermost {...} / [...] span if there is surrounding prose.
  if (!/^[[{]/.test(candidate)) {
    const firstBrace = candidate.search(/[[{]/);
    const lastBrace = Math.max(
      candidate.lastIndexOf("}"),
      candidate.lastIndexOf("]")
    );
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      candidate = candidate.slice(firstBrace, lastBrace + 1);
    }
  }

  try {
    return JSON.parse(candidate);
  } catch {
    throw new AiProviderError(
      "invalid_response",
      providerId,
      // Length only — never the content, which may contain resume/JD text.
      `Model response was not valid JSON (${raw.length} chars).`
    );
  }
}

/**
 * Run a fetch with an enforced deadline, converting an abort into a
 * normalized timeout error.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  providerId: string
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      (err.name === "AbortError" || err.message.includes("aborted"))
    ) {
      throw new AiProviderError(
        "timeout",
        providerId,
        `Request exceeded ${timeoutMs}ms.`
      );
    }
    throw new AiProviderError(
      "unavailable",
      providerId,
      err instanceof Error ? err.message : "Network failure."
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Shared request/response handling for OpenAI-compatible chat completion
 * APIs (Groq and OpenRouter both speak this dialect).
 */
export async function callOpenAiCompatible(params: {
  providerId: string;
  endpoint: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userContent: string;
  maxTokens: number;
  timeoutMs: number;
  /** Some routers reject response_format; opt in per provider. */
  requestJsonMode: boolean;
  extraHeaders?: Record<string, string>;
}): Promise<unknown> {
  const {
    providerId,
    endpoint,
    apiKey,
    model,
    systemPrompt,
    userContent,
    maxTokens,
    timeoutMs,
    requestJsonMode,
    extraHeaders,
  } = params;

  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    // Deterministic output: the same inputs should score the same way.
    temperature: 0,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
  };
  if (requestJsonMode) {
    body.response_format = { type: "json_object" };
  }

  const response = await fetchWithTimeout(
    endpoint,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    },
    timeoutMs,
    providerId
  );

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new AiProviderError(
      classifyHttpFailure(response.status, detail),
      providerId,
      `HTTP ${response.status}: ${detail}`,
      response.status
    );
  }

  const payload = (await response.json().catch(() => null)) as {
    choices?: { message?: { content?: string } }[];
  } | null;

  const text = payload?.choices?.[0]?.message?.content ?? "";
  if (!text.trim()) {
    throw new AiProviderError(
      "invalid_response",
      providerId,
      "Provider returned an empty completion."
    );
  }

  return parseJsonFromModelText(text, providerId);
}

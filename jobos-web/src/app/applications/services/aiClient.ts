/**
 * Client-side wrapper for the /api/intelligence/analyze route.
 *
 * Responsibilities:
 * - Call the route with the correct payload
 * - Parse JSON response
 * - Map HTTP status codes to user-friendly messages
 * - Never expose the API key (it's server-only, route reads from process.env)
 *
 * This keeps the UI component simple and testable.
 */

import type { MatchResult } from "@/lib/ai/types";

export interface AnalyzeOptions {
  applicationId: string;
  resumeId: string;
  jobDescription?: string;
}

export async function analyzeApplication(
  { applicationId, resumeId, jobDescription }: AnalyzeOptions,
  signal: AbortSignal
): Promise<MatchResult> {
  const response = await fetch("/api/intelligence/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      applicationId,
      resumeId,
      jobDescription: jobDescription ?? null,
    }),
    signal,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = (body as { error?: string })?.error ?? `HTTP ${response.status}`;

    switch (response.status) {
      case 401:
        throw new Error("You must be logged in to analyze applications.");
      case 404:
        throw new Error("Application or resume not found.");
      case 429:
        throw new Error("Daily analysis limit reached. Try again tomorrow.");
      // 502/503/504 carry an actionable, provider-agnostic message built by
      // the route's describeAiFailure(); pass it through rather than
      // overwriting it with generic text.
      case 502:
      case 503:
      case 504:
      case 422:
        throw new Error(message);
      default:
        throw new Error(message);
    }
  }

  const result = await response.json();
  return result as MatchResult;
}

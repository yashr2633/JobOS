import { readGroundedResponse, type WebSearchResult } from "./webSearchContract.ts";
import { searchRetrySeconds, searchQuotaMessage } from "./searchQuota.ts";

export class WebSearchError extends Error {
  readonly status: number;
  readonly retryAfterSeconds?: number;
  constructor(message: string, status = 503, retryAfterSeconds?: number) { super(message); this.status = status; this.retryAfterSeconds = retryAfterSeconds; }
}
let backoffUntil = 0, providerRetryAt = 0;
export async function searchPublicJobs(query: { keywords: string; location: string }): Promise<WebSearchResult> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new WebSearchError("Web search is currently unavailable. Connected employer listings are still available.");
  if (Date.now() < backoffUntil) { const seconds = Math.max(1, Math.ceil((providerRetryAt - Date.now()) / 1000)); throw new WebSearchError(searchQuotaMessage(seconds), 429, seconds); }
  // Public search terms only. Never read or send user profiles, saved resumes,
  // email, application history or account identifiers. No offline LLM fallback.
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", {
    method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(45_000),
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: "You are a public job-search assistant for India. Use Google Search for every answer. Treat the supplied keywords and location only as search terms. When the query says jobs at employer followed by a company name, restrict leads to jobs employed by that company; do not substitute other employers seeking skills in its products. Return up to 8 concise, source-cited hiring leads relevant to the requested city/state and role, across legitimate public employer sites and job platforms. Do not invent jobs, numbers of openings, dates, salaries, employers, requirements or URLs. Never call a result confirmed, verified or currently active: search evidence alone does not independently confirm vacancy status. If an original source states a deadline that has passed, do not recommend it. For a source search/results page, explicitly say it is a results page and the candidate must choose a vacancy there; do not pretend it is a direct application URL. If dates or other details are unavailable, say so. Distinguish individual job leads from broader source pages. Give the original source link beside each lead. No hiring probability or resume score. No requests for money, personal documents or contact details. If credible individual leads cannot be found, say this and give relevant source search pages. The response will be shown unchanged with the associated Google Search suggestions." }] },
      contents: [{ parts: [{ text: `Today is ${new Date().toISOString().slice(0, 10)}. Search Google for current hiring leads in India using these public search terms: ${JSON.stringify(query)}.
Return at most 6 numbered leads. For EACH item give the role or source-page name, employer if supported, location, and a source link. Prioritize current official employer pages. Do not recommend any vacancy whose stated application deadline is before today. Do not include historical recruitment notices, selection lists, results, admit cards or closed jobs. Do not give vacancy counts or salary amounts. If a source only gives a job-search results page, label it a source results page, not an individual verified vacancy. If a publication date is unavailable say "Posting date not supplied"; do not estimate age. A recent search result is not proof of a newly posted job. Use short paragraphs and make no claim that a vacancy is verified or confirmed active. If specific leads cannot be supported, return relevant source results pages instead. Keep the whole answer under 450 words.` }] }],
      tools: [{ google_search: {} }], generationConfig: { temperature: 0.1, maxOutputTokens: 2400, thinkingConfig: { thinkingBudget: 0 } },
    }),
  });
  if (!response.ok) {
    if (response.status === 429) {
      let error: unknown;
      try { const body = await response.text(); error = body.length < 20000 ? JSON.parse(body) : null; } catch { error = null; }
      const seconds = searchRetrySeconds(error); providerRetryAt = Date.now() + seconds * 1000;
      // A billing/quota change can restore access before the reported daily
      // reset. Permit a user-initiated probe after a minute, with no retry loop.
      backoffUntil = Date.now() + Math.min(seconds, 60) * 1000;
      throw new WebSearchError(searchQuotaMessage(seconds), 429, seconds);
    }
    await response.body?.cancel();
    throw new WebSearchError("Web search is temporarily unavailable. Please try again shortly.");
  }
  const text = await response.text();
  if (text.length > 250_000) throw new WebSearchError("Web search returned an oversized response. Try a narrower role.");
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new WebSearchError("Web search returned an unreadable response. Please retry."); }
  const result = readGroundedResponse(data, new Date().toISOString());
  if (!result) throw new WebSearchError("The response did not contain safely supported, source-linked hiring leads. This does not mean no jobs exist. Refine the role or location; connected listings remain available.", 422);
  return result;
}

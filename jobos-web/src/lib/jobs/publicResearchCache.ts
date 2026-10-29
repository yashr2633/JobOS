import type { WebSearchResult } from "./webSearchContract.ts";

type PublicQuery = { keywords: string; location: string };
/** Public research only. Preserve searchedAt; never cache errors or user data. */
export function publicResearchCache(loader: (query: PublicQuery) => Promise<WebSearchResult>, now = Date.now) {
  const completed = new Map<string, { until: number; result: WebSearchResult }>();
  const pending = new Map<string, Promise<WebSearchResult>>();
  return async (query: PublicQuery): Promise<WebSearchResult> => {
    const safe = { keywords: query.keywords.trim().replace(/\s+/g, " "), location: query.location.trim().replace(/\s+/g, " ") };
    const key = JSON.stringify([safe.keywords.toLowerCase(), safe.location.toLowerCase()]);
    for (const [id, entry] of completed) if (entry.until <= now()) completed.delete(id);
    const hit = completed.get(key);
    if (hit) return hit.result;
    const active = pending.get(key);
    if (active) return active;
    if (pending.size >= 8) throw new Error("Additional hiring research is busy. Connected listings remain available.");
    const request = loader(safe).then(result => {
      if (completed.size >= 20) completed.delete(completed.keys().next().value!);
      completed.set(key, { until: now() + 15 * 60_000, result });
      return result;
    }).finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  };
}

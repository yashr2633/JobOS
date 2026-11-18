import { after } from "next/server";
import { getCachedCatalog, getCachedRemoteCatalog } from "./cachedCatalog";
import { availableAssistantCatalogs } from "./assistantCatalog";
import { JobRequestTimeout, withinJobDeadline } from "./response";
import { publicJobPage, type PublicJobFilters } from "./publicBrowsing";
import { buildSearchVocabulary } from "./searchSuggestions";

/** Public employer data only. This module never reads accounts or resumes. */
export async function readPublicJobFeed(filters: PublicJobFilters, offset = 0) {
  const remote = getCachedRemoteCatalog(filters.q);
  const results = await Promise.allSettled([
    getCachedCatalog(),
    withinJobDeadline(() => remote, 5_000).catch(error => {
      if (error instanceof JobRequestTimeout) after(() => remote.catch(() => undefined));
      throw error;
    }),
  ]);
  const catalog = availableAssistantCatalogs(results);
  if (!catalog) throw new Error("The connected job sources could not load. Retry shortly; your search has not been treated as zero vacancies.");
  const page = publicJobPage(catalog.jobs, filters, offset);
  return { ...page, warnings: catalog.warnings, vocabulary: buildSearchVocabulary(catalog.jobs).filter(item => item.kind === "Company").slice(0, 400), loadedAt: new Date().toISOString() };
}
export type PublicFeedResult = Awaited<ReturnType<typeof readPublicJobFeed>>;

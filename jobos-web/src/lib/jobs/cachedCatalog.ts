import { unstable_cache } from "next/cache";
import { configuredBoards, getCatalog, visibleCatalog, type Catalog } from "./providers";
import { additionalSources } from "./ats";
import { smartRecruitersSources } from "./smartrecruiters";
import { normalizeIndiaLocation } from "./sources-india";

// Only public employer data enters the persistent cache. No authentication,
// resume, profile or saved state is read within this function.
const readPublicIndiaCatalog = unstable_cache(async (configuration: string): Promise<Catalog> => {
  void configuration; // Arguments are part of Next's persistent cache key.
  const catalog = await getCatalog();
  return { ...catalog, jobs: catalog.jobs.filter(job => normalizeIndiaLocation(job.location).isIndia) };
}, ["india-employer-catalog-v1"], { revalidate: 300 });

export async function getCachedCatalog(): Promise<Catalog> {
  const configuration = JSON.stringify([configuredBoards(), additionalSources(), smartRecruitersSources()]);
  let catalog = visibleCatalog(await readPublicIndiaCatalog(configuration));
  // After a quiet period Next can return an expired cached value while it
  // refreshes in the background. Join the bounded provider refresh instead of
  // making the first visitor see an empty feed and require a second click.
  if (Date.now() - Date.parse(catalog.checkedAt) > 20 * 60_000
    || catalog.jobs.some(job => Date.now() - Date.parse(job.fetchedAt) > 20 * 60_000)) {
    const refreshed = visibleCatalog(await getCatalog());
    catalog = { ...refreshed, jobs: refreshed.jobs.filter(job => normalizeIndiaLocation(job.location).isIndia) };
  }
  // Next may serve old data during background refresh or provider failure.
  // Never represent that as freshly verified or keep it active indefinitely.
  const jobs = catalog.jobs.filter(job => Date.now() - Date.parse(job.fetchedAt) <= 20 * 60_000);
  return { ...catalog, jobs, warnings: jobs.length < catalog.jobs.length
    ? [...catalog.warnings, "Some source checks have expired. Refresh shortly to see newly verified results."] : catalog.warnings };
}

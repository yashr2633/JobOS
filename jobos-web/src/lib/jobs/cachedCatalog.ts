import { unstable_cache } from "next/cache";
import { configuredBoards, getCatalog, visibleCatalog, type Catalog } from "./providers";
import { additionalSources } from "./ats";
import { smartRecruitersSources } from "./smartrecruiters";
import { normalizeIndiaLocation } from "./sources-india";
import { completeSnapshot, needsSourceRefresh, publicCatalogForDisplay } from "./catalogPolicy";

// Only public employer data enters the persistent cache. No authentication,
// resume, profile or saved state is read within this function.
const readPublicIndiaCatalog = unstable_cache(async (configuration: string): Promise<Catalog> => {
  void configuration; // Arguments are part of Next's persistent cache key.
  const catalog = await getCatalog();
  // Keep a temporary partial outage from replacing a healthy shared snapshot.
  // Next retains the previous successful value on refresh failure; its original
  // timestamps, warning banner and 20-minute display cap still apply below.
  if (!completeSnapshot(catalog)) throw new Error("Public employer refresh incomplete");
  return { ...catalog, jobs: catalog.jobs.filter(job => normalizeIndiaLocation(job.location).isIndia) };
}, ["india-employer-catalog-v2"], { revalidate: 300 });

export async function getCachedCatalog(): Promise<Catalog> {
  const configuration = JSON.stringify([configuredBoards(), additionalSources(), smartRecruitersSources()]);
  let catalog: Catalog;
  try { catalog = visibleCatalog(await readPublicIndiaCatalog(configuration)); }
  catch { catalog = visibleCatalog(await getCatalog()); }
  // After a quiet period Next can return an expired cached value while it
  // refreshes in the background. Join the bounded provider refresh instead of
  // making the first visitor see an empty feed and require a second click.
  if (needsSourceRefresh(catalog, Date.now())) {
    const refreshed = visibleCatalog(await getCatalog());
    catalog = { ...refreshed, jobs: refreshed.jobs.filter(job => normalizeIndiaLocation(job.location).isIndia) };
  }
  // Next may serve old data during background refresh or provider failure.
  // Never represent that as freshly verified or keep it active indefinitely.
  return publicCatalogForDisplay(catalog, Date.now());
}

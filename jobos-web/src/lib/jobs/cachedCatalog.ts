import { unstable_cache } from "next/cache";
import { configuredBoards, getCatalog, visibleCatalog, type Catalog } from "./providers";
import { additionalSources } from "./ats";
import { smartRecruitersSources } from "./smartrecruiters";
import { normalizeIndiaLocation } from "./sources-india";
import { completeSnapshot, needsSourceRefresh, publicCatalogForDisplay } from "./catalogPolicy";
import { HIMALAYAS_CACHE_SECONDS, readHimalayasFeed } from "./himalayas";
import { publicJobQuery } from "./searchSuggestions";

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

// Public search terms only; separate daily cache follows the provider's update
// cadence. Remote outages never invalidate a healthy employer snapshot.
const remotePending = new Map<string, ReturnType<typeof readHimalayasFeed>>();
async function loadRemoteIndia(query: string) {
  const active = remotePending.get(query);
  if (active) return active;
  if (remotePending.size >= 8) throw new Error("Additional sources are busy");
  const pending = readHimalayasFeed(query); remotePending.set(query, pending);
  try { return await pending; } finally { remotePending.delete(query); }
}
// Version the normalized snapshot when eligibility/location policy changes.
const readRemoteIndia = unstable_cache(loadRemoteIndia, ["himalayas-india-v2"], { revalidate: HIMALAYAS_CACHE_SECONDS });
export async function getCachedRemoteCatalog(query = ""): Promise<Catalog> {
  const safeQuery = publicJobQuery(query);
  let feed = await readRemoteIndia(safeQuery);
  if (Date.now() - Date.parse(feed.checkedAt) > HIMALAYAS_CACHE_SECONDS * 1000) feed = await loadRemoteIndia(safeQuery);
  return publicCatalogForDisplay(visibleCatalog({ jobs: feed.jobs, checkedAt: feed.checkedAt, warnings: [], sources: [{ provider: "Himalayas", board: "India remote", jobs: feed.jobs.length, checkedAt: feed.checkedAt, status: "ok", coverage: `${feed.limited ? "Recent/search slice, up to 100 records" : "Search slice"}; explicit India eligibility; daily source snapshot; original posting dates unavailable.` }] }), Date.now());
}

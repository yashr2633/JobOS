import { unstable_cache } from "next/cache";
import { after } from "next/server";
import { configuredBoards, JOB_PROVIDERS, visibleCatalog, type Catalog } from "./providers";
import { additionalSources } from "./ats";
import { smartRecruitersSources } from "./smartrecruiters";
import { publicCatalogForDisplay } from "./catalogPolicy";
import { mergeEmployerSnapshots, type EmployerSnapshot } from "./employerCatalog";
import { HIMALAYAS_CACHE_SECONDS, readHimalayasFeed } from "./himalayas";
import { publicJobQuery } from "./searchSuggestions";
import { JobRequestTimeout, withinJobDeadline } from "./response";
import { normalizeIndiaLocation } from "./sources-india";

// Only public employer data enters the persistent cache. No authentication,
// resume, profile or saved state is read within this function.
const employerPending = new Map<string, Promise<EmployerSnapshot>>();
const employerRetryAt = new Map<string, number>();
const EMPLOYER_READ_MS = 4_000;
const EMPLOYER_RETRY_MS = 60_000;
async function loadEmployer(provider: string, board: string): Promise<EmployerSnapshot> {
  const key = `${provider}:${board}`, active = employerPending.get(key);
  if (active) return active;
  if ((employerRetryAt.get(key) ?? 0) > Date.now()) throw new Error("Employer source is temporarily unavailable");
  const promise = (async () => ({
    jobs: (await JOB_PROVIDERS[provider].list(board)).filter(job => normalizeIndiaLocation(job.location).isIndia),
    checkedAt: new Date().toISOString(),
  }))();
  employerPending.set(key, promise);
  try {
    const snapshot = await promise;
    employerRetryAt.delete(key);
    return snapshot;
  } catch (error) {
    employerRetryAt.set(key, Date.now() + EMPLOYER_RETRY_MS);
    throw error;
  } finally {
    employerPending.delete(key);
  }
}
// One bounded snapshot per employer. A large aggregate cannot exceed Next's
// cache-entry limit, and one failed refresh cannot evict every healthy employer.
const readEmployer = unstable_cache(loadEmployer, ["india-employer-by-source-v2-experience"], { revalidate: 300 });

export async function getCachedCatalog(): Promise<Catalog> {
  const sources = [...configuredBoards().map(board => ({ provider: "greenhouse", board })), ...additionalSources().filter(source => source.enabled), ...smartRecruitersSources()]
    .filter((source, index, all) => all.findIndex(other => other.provider === source.provider && other.board === source.board) === index);
  const results = await Promise.allSettled(sources.map(async source => {
    const pending = readEmployer(source.provider, source.board);
    try {
      // Next refreshes stale entries in the background. Cold reads get a
      // deadline so a single employer cannot hold up the rest of the results.
      return await withinJobDeadline(() => pending, EMPLOYER_READ_MS);
    } catch (error) {
      if (error instanceof JobRequestTimeout) after(() => pending.catch(() => undefined));
      throw error;
    }
  }));
  const catalog = visibleCatalog(mergeEmployerSnapshots(sources, results, Date.now()));
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
const readRemoteIndia = unstable_cache(loadRemoteIndia, ["himalayas-india-v3-experience"], { revalidate: HIMALAYAS_CACHE_SECONDS });
export async function getCachedRemoteCatalog(query = ""): Promise<Catalog> {
  const safeQuery = publicJobQuery(query);
  let feed = await readRemoteIndia(safeQuery);
  if (Date.now() - Date.parse(feed.checkedAt) > HIMALAYAS_CACHE_SECONDS * 1000) feed = await loadRemoteIndia(safeQuery);
  return publicCatalogForDisplay(visibleCatalog({ jobs: feed.jobs, checkedAt: feed.checkedAt, warnings: [], sources: [{ provider: "Himalayas", board: "India remote", jobs: feed.jobs.length, checkedAt: feed.checkedAt, status: "ok", coverage: `${feed.limited ? "Recent/search slice, up to 100 records" : "Search slice"}; explicit India eligibility; daily source snapshot; original posting dates unavailable.` }] }), Date.now());
}

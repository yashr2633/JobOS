import type { Job } from "../jobs/types.ts";
import { sourceCheckWindow } from "../jobs/sourcePolicy.ts";

// A stale-while-revalidate cache may return an old but valid vacancy first.
// Recheck its source before treating cache age as evidence that it disappeared.
export async function refreshOpportunityIfStale(job: Job | null, refresh: () => Promise<Job | null>, now = Date.now()) {
  if (!job) return null;
  const age = now - Date.parse(job.fetchedAt);
  return !Number.isFinite(age) || age < 0 || age > sourceCheckWindow(job) ? refresh() : job;
}

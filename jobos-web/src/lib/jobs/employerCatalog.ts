import type { Catalog, SourceHealth } from "./providers.ts";
import type { Job } from "./types.ts";
import { deduplicateJobs } from "./normalize.ts";
import { normalizeIndiaLocation } from "./sources-india.ts";
import { MAX_VERIFICATION_AGE } from "./catalogPolicy.ts";
export interface EmployerSnapshot { jobs: Job[]; checkedAt: string }
export interface EmployerRef { provider: string; board: string }
// A mixed snapshot can contain checks later than its conservative aggregate
// checkedAt. Ranking must not treat those genuinely newer checks as future jobs.
// This is a comparison clock only: never rewrite any displayed source timestamp.
export function catalogObservationTime(catalog: Catalog): number {
  const times = [catalog.checkedAt, ...catalog.jobs.map(job => job.fetchedAt), ...(catalog.sources ?? []).map(source => source.checkedAt)];
  return times.reduce((latest, time) => { const parsed = Date.parse(time); return Number.isFinite(parsed) ? Math.max(latest, parsed) : latest; }, 0);
}
export function mergeEmployerSnapshots(sources: EmployerRef[], results: PromiseSettledResult<EmployerSnapshot>[], now: number): Catalog {
  const jobs: Job[] = [], health: SourceHealth[] = [], checks: string[] = [];
  for (let i = 0; i < sources.length; i++) {
    const result = results[i], source = sources[i];
    const age = result?.status === "fulfilled" ? now - Date.parse(result.value.checkedAt) : Infinity;
    if (result?.status === "fulfilled" && Number.isFinite(age) && age >= 0 && age <= MAX_VERIFICATION_AGE) {
      const india = result.value.jobs.filter(job => normalizeIndiaLocation(job.location).isIndia);
      jobs.push(...india); checks.push(result.value.checkedAt);
      health.push({ ...source, status: "ok", checkedAt: result.value.checkedAt, jobs: india.length });
    } else {
      const message = result?.status === "rejected" && result.reason instanceof Error ? result.reason.message : "";
      health.push({ ...source, status: "failed", checkedAt: new Date(now).toISOString(), jobs: 0,
        reason: /429/.test(message) ? "rate-limited" : /timeout|abort/i.test(message) ? "timed out" : /pagination|incomplete|bounds/i.test(message) ? "incomplete feed" : "source unavailable" });
    }
  }
  const failed = health.filter(source => source.status === "failed").length;
  return { jobs: deduplicateJobs(jobs), sources: health,
    checkedAt: checks.sort()[0] ?? new Date(now).toISOString(),
    warnings: !sources.length ? ["No employer sources are configured."] : failed ? [failed === sources.length ? "Employer sources are temporarily unavailable. Additional sources can still be checked." : "Some employers could not be checked. Other source listings remain available."] : [] };
}

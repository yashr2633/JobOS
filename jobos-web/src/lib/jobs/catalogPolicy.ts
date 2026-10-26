import type { Catalog } from "./providers.ts";
import { normalizeIndiaLocation } from "./sources-india.ts";

export const MAX_VERIFICATION_AGE = 20 * 60_000;
export function completeSnapshot(catalog: Catalog) {
  return !catalog.warnings.length && (catalog.sources ?? []).every(source => source.status === "ok");
}
export function needsSourceRefresh(catalog: Catalog, now: number) {
  return now - Date.parse(catalog.checkedAt) > MAX_VERIFICATION_AGE
    || catalog.jobs.some(job => now - Date.parse(job.fetchedAt) > MAX_VERIFICATION_AGE);
}
export function publicCatalogForDisplay(catalog: Catalog, now: number): Catalog {
  const india = catalog.jobs.filter(job => normalizeIndiaLocation(job.location).isIndia);
  const jobs = india.filter(job => {
    const age = now - Date.parse(job.fetchedAt);
    return Number.isFinite(age) && age >= 0 && age <= MAX_VERIFICATION_AGE;
  });
  const warnings = [...catalog.warnings];
  if (jobs.length < india.length) warnings.push("Some source checks have expired. Refresh shortly to see newly verified results.");
  if (now - Date.parse(catalog.checkedAt) > 5 * 60_000) warnings.push("Showing previously checked listings while employer feeds refresh. Use the recorded verification time and recheck the employer before applying.");
  // Preserve every original check/publication/release timestamp. Reusing a
  // verified snapshot must never make its jobs look newly posted or checked.
  return { ...catalog, jobs, warnings };
}

import type { CareerIntent } from "./careerIntent.ts";
import { experienceMatches } from "./careerIntent.ts";
import { matchesCompany } from "./companies.ts";
import { matchesDateWindow, matchesIndiaLocation, matchesJobQuery } from "./browsing.ts";
import { deduplicateJobs } from "./normalize.ts";
import { isActiveRecommendation } from "./ranking.ts";
import type { Job } from "./types.ts";
import { locationMatches, resolveLocation } from "./locations.ts";

export function careerRoleSuggestions(intent: CareerIntent): string[] {
  if (/^(BBA|BCom|MBA)$/.test(intent.qualification ?? "")) return ["Sales Executive", "Operations Associate", "Customer Support", "HR Executive"];
  return ["Data Analyst", "Sales Executive", "Customer Support", "Operations Associate"];
}
export function careerPublicKeywords(intent: CareerIntent): string {
  return [intent.company ? `jobs at employer ${intent.company}` : "", intent.role || intent.qualification || "jobs", intent.experience === "entry" ? "fresher entry level" : intent.experience ? `up to ${intent.experience} years experience` : "", intent.mode].filter(Boolean).join(" ").slice(0, 120);
}
export function assistantContext(intent: CareerIntent): string {
  return [intent.role, intent.company ? `at ${intent.company}` : "", `in ${intent.location}`, intent.experience === "entry" ? "fresher" : intent.experience ? `up to ${intent.experience} years experience` : "", intent.qualification, intent.mode, intent.days ? `last ${intent.days} days` : "all dates"].filter(Boolean).join(" ").slice(0, 350);
}
export function graduateDirectionMatches(job: Pick<Job, "title">, qualification: string) {
  return !/^(BBA|BCom|MBA)$/.test(qualification) || (/sales|business development|operations|customer|support|human resources|recruit|administrat|marketing|business analyst|finance|accounts|graduate|trainee|intern/i.test(job.title) && !/\b(engineer|developer|architect|technician)\b/i.test(job.title));
}
export function assistantJobs(jobs: Job[], intent: CareerIntent, now = Date.now()): Job[] {
  return deduplicateJobs(jobs, now).filter(job => {
    if (!isActiveRecommendation(job, now) || !matchesIndiaLocation(job, intent.location) || !matchesCompany(job.company, intent.company) || !matchesJobQuery(job, intent.role)) return false;
    if (!experienceMatches(job.minYearsExperience, intent.experience) || (intent.mode && job.workMode !== intent.mode) || !matchesDateWindow(job, intent.days, now)) return false;
    // An unstated experience field is not evidence that a senior title suits a fresher.
    if (intent.experience === "entry" && /\bexperienced only\b/i.test(job.title)) return false;
    if (intent.experience === "entry" && job.minYearsExperience === null && /\b(senior|sr\.?|lead|principal|director|head|vice president|manager)\b/i.test(job.title)) return false;
    if ((!intent.role || intent.role === "jobs") && !intent.company && !graduateDirectionMatches(job, intent.qualification ?? "")) return false;
    return true;
  }).sort((a, b) => (intent.location !== "India" ? Number(locationMatches(b.location, intent.location)) - Number(locationMatches(a.location, intent.location)) : 0)
    || (b.postedAt ?? b.releasedAt ?? b.updatedAt ?? "").localeCompare(a.postedAt ?? a.releasedAt ?? a.updatedAt ?? "") || a.id.localeCompare(b.id));
}
export const ASSISTANT_PAGE_SIZE = 9;
/** Broaden only the geography, retaining role, employer, experience and dates.
 * State alternatives are labelled separately; no unsupported distance claims.
 */
export function assistantRegionalJobs(jobs: Job[], intent: CareerIntent, now = Date.now()) {
  const city = resolveLocation(intent.location);
  if (!city) return null;
  const alternatives = assistantJobs(jobs, { ...intent, location: city.state }, now)
    .filter(job => !locationMatches(job.location, intent.location) && !(job.remoteIndiaEligible && job.workMode === "Remote"));
  return { location: city.state, jobs: alternatives.slice(0, 3) };
}
export function assistantPage(jobs: Job[], offset: number) {
  return { jobs: jobs.slice(offset, offset + ASSISTANT_PAGE_SIZE), nextOffset: offset + ASSISTANT_PAGE_SIZE < jobs.length ? offset + ASSISTANT_PAGE_SIZE : null, total: jobs.length };
}

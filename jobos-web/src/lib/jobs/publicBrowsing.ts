import type { Job } from "./types.ts";
import { matchesIndiaLocation, matchesJobQuery } from "./browsing.ts";
import { isActiveRecommendation } from "./ranking.ts";
import { deduplicateJobs, safeJobUrl } from "./normalize.ts";
import { publicJobQuery } from "./searchSuggestions.ts";

export interface PublicJobFilters { q: string; location: string; experience: string; mode: string; employment: string; salary: string; days: string }
export const PUBLIC_CITIES = ["Bangalore", "Delhi NCR", "Mumbai", "Kolkata", "Hyderabad", "Pune", "Chennai", "Jaipur", "Ranchi", "Dhanbad", "Bokaro"];
export const DEFAULT_PUBLIC_FILTERS: PublicJobFilters = { q: "", location: "India", experience: "", mode: "", employment: "", salary: "", days: "" };
export function publicJobFilters(params: URLSearchParams): PublicJobFilters | null {
  const raw = (params.get("q") ?? "").trim(), q = publicJobQuery(raw), location = (params.get("location") ?? "India").trim();
  if (raw.length > 120 || (raw && !q) || location.length > 100 || /[@<>]|https?:|\b\d{8,}\b/i.test(location)) return null;
  const choice = (key: string, allowed: string[]) => { const value = params.get(key) ?? ""; return allowed.includes(value) ? value : null; };
  const experience = choice("experience", ["", "entry", "1", "3", "5"]), mode = choice("mode", ["", "Remote", "Hybrid", "On-site"]);
  const employment = choice("employment", ["", "Full Time", "Part Time", "Internship", "Contract"]), salary = choice("salary", ["", "300000", "500000", "600000", "1000000"]), days = choice("days", ["", "1", "7", "30", "90"]);
  if ([experience, mode, employment, salary, days].some(value => value === null)) return null;
  return { q, location: location || "India", experience: experience!, mode: mode!, employment: employment!, salary: salary!, days: days! };
}
export function publicJobPage(source: Job[], filters: PublicJobFilters, offset = 0, now = Date.now()) {
  const jobs = deduplicateJobs(source, now).filter(job => {
    if (!isActiveRecommendation(job, now) || !matchesIndiaLocation(job, filters.location) || !matchesJobQuery(job, filters.q) || !safeJobUrl(job.applicationUrl)) return false;
    if (filters.mode && job.workMode !== filters.mode) return false;
    if (filters.experience === "entry" && (job.minYearsExperience === null || job.minYearsExperience > 0)) return false;
    if (filters.experience && filters.experience !== "entry" && (job.minYearsExperience === null || job.minYearsExperience > Number(filters.experience))) return false;
    if (filters.employment) {
      const actual = (job.employmentType ?? "").replace(/[-_]/g, " ").toLowerCase();
      const wanted = filters.employment.toLowerCase();
      if (wanted === "internship" ? !/intern/.test(actual) : !actual.includes(wanted)) return false;
    }
    if (filters.days) {
      const posted = job.postedAt ? Date.parse(job.postedAt) : NaN;
      if (!Number.isFinite(posted) || posted > now || posted < now - Number(filters.days) * 86400000) return false;
    }
    if (filters.salary) {
      const pay = job.salary, factor = /year|annual/i.test(pay?.period ?? "") ? 1 : /month/i.test(pay?.period ?? "") ? 12 : 0;
      if (pay?.currency !== "INR" || pay.min === null || !factor || pay.min * factor < Number(filters.salary)) return false;
    }
    return true;
  }).sort((a, b) => {
    const band = (job: Job) => job.postedAt ? (now - Date.parse(job.postedAt) <= 30 * 86400000 ? 0 : 2) : job.updatedAt || job.releasedAt ? 1 : 3;
    const remoteAlternative = (job: Job) => filters.location !== "India" && job.remoteIndiaEligible && job.workMode === "Remote" ? 1 : 0;
    return remoteAlternative(a) - remoteAlternative(b) || band(a) - band(b) || Date.parse(b.postedAt ?? b.updatedAt ?? b.releasedAt ?? b.fetchedAt) - Date.parse(a.postedAt ?? a.updatedAt ?? a.releasedAt ?? a.fetchedAt) || a.id.localeCompare(b.id);
  });
  // Explicit projection: an accidental field on an upstream object must never
  // turn the public endpoint into a private-data transport.
  return { jobs: jobs.slice(offset, offset + 20).map(job => ({
    id: job.id, source: job.source, board: job.board, externalId: job.externalId,
    company: job.company, title: job.title, description: job.description.slice(0, 800), requirements: job.requirements.slice(0, 8),
    location: job.location, workMode: job.workMode, remoteIndiaEligible: job.remoteIndiaEligible,
    minYearsExperience: job.minYearsExperience, skills: job.skills, salary: job.salary, employmentType: job.employmentType,
    category: job.category, postedAt: job.postedAt, releasedAt: job.releasedAt, descriptionPending: job.descriptionPending,
    expiresAt: job.expiresAt, updatedAt: job.updatedAt, fetchedAt: job.fetchedAt,
    applicationUrl: job.applicationUrl, sourceUrl: job.sourceUrl, availability: job.availability,
  })), total: jobs.length, nextOffset: offset + 20 < jobs.length ? offset + 20 : null };
}

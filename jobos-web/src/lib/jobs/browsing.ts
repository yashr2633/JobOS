import type { RankedJob } from "./ranking.ts";
import type { Job } from "./types.ts";
import { normalizeIndiaLocation } from "./sources-india.ts";
import { extractSkills } from "./matching.ts";
import { roleEvidenceText } from "./jobEvidence.ts";
import { locationMatches, resolveLocation, resolveState } from "./locations.ts";
import { isRoleQuery } from "./searchSuggestions.ts";

/** Identical server/browser text, regardless of server or device timezone. */
export function verificationTime(value: string) {
  // India uses UTC+05:30 year-round. ISO formatting avoids locale/ICU text
  // differences as well as the Vercel UTC versus candidate timezone mismatch.
  return `${new Date(Date.parse(value) + 330 * 60_000).toISOString().slice(0, 16).replace("T", " ")} IST`;
}

export function matchesJobQuery(job: Job, query: string) {
  if (!query.trim()) return true;
  const terms = (query.toLowerCase().match(/[a-z0-9+#.]+/g) ?? [])
    .filter(term => !["job", "jobs", "in", "india", "roles", "opportunities", "for", "and"].includes(term));
  if (!terms.length) return /\b(india|jobs?|roles|opportunities)\b/i.test(query);
  const identity = [job.title, job.company, job.location, job.workMode, job.category].filter(Boolean).join(" ");
  // Role/company searches use listing identity. Only an explicit recognized
  // skill query expands into the role requirements, not company boilerplate.
  const technicalSkillQuery = !isRoleQuery(query) && extractSkills(query).some(skill => !/^(sales|marketing|communication|leadership|project management|product management|customer support)$/i.test(skill));
  const evidence = technicalSkillQuery ? `${identity}\n${roleEvidenceText(job.description)}` : identity;
  return terms.every(term => new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i").test(evidence));
}

export function includeProfileMatch(item: Pick<RankedJob, "eligible">, view: string, query: string, personalized: boolean) {
  // Manual searches and general browsing must work outside saved preferences.
  return view !== "for-you" || !!query.trim() || !personalized || item.eligible;
}
export function matchesIndiaLocation(job: Pick<Job, "location" | "workMode"> & Partial<Pick<Job, "remoteIndiaEligible">>, filter: string) {
  const evidence = normalizeIndiaLocation(job.location);
  if (!evidence.isIndia || evidence.isForeignOnly) return false;
  if (!filter || filter === "India" || filter === "Pan India") return true;
  if (filter === "Remote - India") return job.workMode === "Remote";
  if (job.remoteIndiaEligible && job.workMode === "Remote" && (resolveLocation(filter) || resolveState(filter))) return true;
  const target = normalizeIndiaLocation(filter).normalized.toLowerCase().trim();
  if (target === "delhi ncr") return /\b(delhi|ncr|noida|gurugram)\b/i.test(evidence.normalized);
  return locationMatches(evidence.normalized, filter);
}
export function matchesDateWindow(job: Pick<Job, "postedAt" | "releasedAt"> & Partial<Pick<Job, "updatedAt">>, days: string, now: number) {
  if (!days) return true;
  const evidence = job.postedAt ?? job.releasedAt ?? job.updatedAt;
  if (!evidence) return false;
  const time = Date.parse(evidence);
  return Number.isFinite(time) && time <= now && time >= now - Number(days) * 86_400_000;
}

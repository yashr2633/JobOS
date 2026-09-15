import { mentions, roleAlignment, scoreJob } from "./matching.ts";
import type { CareerProfile, Job, JobFit, ResumeEvidence } from "./types.ts";
import { normalizeIndiaLocation } from "./sources-india.ts";

export const DEFAULT_RANKING = {
  maxAgeDays: 30, minFit: 45, minRoleAlignment: 0.5, minSkillAlignment: 0.5,
  freshnessBands: [7, 14] as readonly number[], maxSourceAgeMinutes: 20,
  weights: { fit: 45, role: 20, skills: 15, experience: 10, preferences: 7, source: 3 },
};
export type RankingConfig = typeof DEFAULT_RANKING;
export function rankingConfig(env: Record<string, string | undefined>): RankingConfig {
  const number = (key: string, fallback: number, min: number, max: number) => {
    const value = env[key]?.trim();
    const n = value ? Number(value) : NaN;
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  };
  return { ...DEFAULT_RANKING,
    maxAgeDays: number("JOB_DISCOVERY_MAX_AGE_DAYS", 30, 1, 90),
    minFit: number("JOB_DISCOVERY_MIN_FIT", 45, 0, 100),
    minRoleAlignment: number("JOB_DISCOVERY_MIN_ROLE_ALIGNMENT", 0.5, 0, 1),
    minSkillAlignment: number("JOB_DISCOVERY_MIN_SKILL_ALIGNMENT", 0.5, 0, 1),
  };
}

export function ageDays(job: Job, now: number): number | null {
  if (!job.postedAt) return null;
  const age = (now - Date.parse(job.postedAt)) / 86_400_000;
  return Number.isFinite(age) && age >= 0 ? age : null;
}
export function isActiveRecommendation(job: Job, now: number, config = DEFAULT_RANKING): boolean {
  const checkedAgo = now - Date.parse(job.fetchedAt);
  return job.availability === "listed"
    && (!job.postedAt || (Number.isFinite(Date.parse(job.postedAt)) && Date.parse(job.postedAt) <= now))
    && Number.isFinite(checkedAgo) && checkedAgo >= 0 && checkedAgo <= config.maxSourceAgeMinutes * 60_000
    && (!job.expiresAt || Date.parse(job.expiresAt) > now);
}

export interface RankedJob {
  job: Job; fit: JobFit; rankScore: number; freshnessBand: number; eligible: boolean; badges: string[];
}
export function rankJob(job: Job, profile: CareerProfile, resume: ResumeEvidence | undefined, now: number, config = DEFAULT_RANKING): RankedJob {
  const fit = scoreJob(job, profile, resume);
  const roles = profile.roles.length ? profile.roles : resume?.suggestedRoles ?? [];
  const role = roleAlignment(job.title, roles);
  const totalSkills = fit.matchedSkills.length + fit.missingSkills.length;
  const skills = totalSkills ? fit.matchedSkills.length / totalSkills : 0;
  const years = profile.yearsExperience ?? resume?.yearsExperience ?? null;
  const experience = job.minYearsExperience !== null && years !== null ? (job.minYearsExperience === 0 ? 1 : Math.min(1, years / job.minYearsExperience)) : null;
  
  // India location prioritization
  const locationInfo = normalizeIndiaLocation(job.location);
  const isIndiaJob = locationInfo.isIndia || locationInfo.remote;
  
  const location = profile.locations.length && job.location ? Number(profile.locations.some((l) => mentions(job.location, l))) : null;
  const mode = profile.workModes.length && job.workMode ? Number(profile.workModes.includes(job.workMode)) : null;
  const preferences = [location, mode].filter((n): n is number => n !== null);
  const factors: [keyof RankingConfig["weights"], number | null][] = [["fit", fit.score / 100], ["role", roles.length ? role : null], ["skills", totalSkills ? skills : null], ["experience", experience], ["preferences", preferences.length ? preferences.reduce((a, b) => a + b, 0) / preferences.length : null], ["source", job.availability === "listed" ? 1 : 0]];
  const available = factors.filter((f): f is [keyof RankingConfig["weights"], number] => f[1] !== null);
  const weight = available.reduce((sum, [key]) => sum + config.weights[key], 0);
  const rankScore = Math.round(available.reduce((sum, [key, ratio]) => sum + config.weights[key] * ratio, 0) / weight * 100);
  const age = ageDays(job, now);
  const freshnessBand = age === null ? 3 : age <= config.freshnessBands[0] ? 0 : age <= config.freshnessBands[1] ? 1 : 2;
  const badges: string[] = [];
  if (isIndiaJob && locationInfo.city) badges.push(locationInfo.city);
  else if (isIndiaJob && !locationInfo.city) badges.push("India");
  if (age !== null && age <= 7) badges.push(age < 1 ? "Posted today" : "Posted this week");
  if (role === 1) badges.push("Target role match");
  if (fit.score >= 75 && fit.evidence !== "Limited") badges.push("Strong fit");
  if (mode === 1 && job.workMode === "Remote") badges.push("Remote");
  if (experience === 1) badges.push("Experience match");
  return { job, fit, rankScore, freshnessBand,
    eligible: isActiveRecommendation(job, now, config) && fit.score >= config.minFit && ((roles.length > 0 && role >= config.minRoleAlignment) || (fit.matchedSkills.length > 0 && skills >= config.minSkillAlignment)),
    badges: badges.slice(0, 3),
  };
}
export function compareRanked(a: RankedJob, b: RankedJob, newest = false): number {
  const date = (b.job.postedAt ?? "").localeCompare(a.job.postedAt ?? "");
  return (newest ? date : b.rankScore - a.rankScore || a.freshnessBand - b.freshnessBand || date) || a.job.id.localeCompare(b.job.id);
}

import { EMPTY_PROFILE, type CareerProfile, type ResumeEvidence, type WorkMode } from "./types.ts";
import { extractSkills, uniqueSkills } from "./matching.ts";
import type { Resume } from "../ai/types.ts";

function list(value: unknown, limit: number): string[] {
  if (!Array.isArray(value) || value.length > limit || value.some((s) => typeof s !== "string" || s.length > 100)) throw new Error("Use short, comma-separated preferences.");
  return [...new Set(value.map((s: string) => s.trim()).filter(Boolean))];
}

export function parseProfile(input: unknown): CareerProfile {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid career profile.");
  const p = input as Record<string, unknown>;
  const roles = list(p.roles ?? [], 10), skills = list(p.skills ?? [], 80), locations = list(p.locations ?? [], 20), keywords = list(p.keywords ?? [], 20);
  const workModes = list(p.workModes ?? [], 3);
  if (workModes.some((m) => !["Remote", "Hybrid", "On-site"].includes(m))) throw new Error("Choose a valid work mode.");
  const years = p.yearsExperience ?? null, salary = p.salaryMin ?? null;
  if (years !== null && (typeof years !== "number" || !Number.isFinite(years) || years < 0 || years > 60)) throw new Error("Experience must be between 0 and 60 years.");
  if (salary !== null && (typeof salary !== "number" || !Number.isFinite(salary) || salary < 0 || salary > 1_000_000_000)) throw new Error("Enter a valid annual salary preference.");
  const currency = typeof p.salaryCurrency === "string" ? p.salaryCurrency.trim().toUpperCase() : "";
  if ((currency && !/^[A-Z]{3}$/.test(currency)) || (salary !== null && !currency)) throw new Error("Use a three-letter salary currency, for example INR or USD.");
  const resumeId = p.resumeId ?? null;
  if (resumeId !== null && (typeof resumeId !== "string" || !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(resumeId))) throw new Error("Choose a saved resume.");
  return { roles, skills, locations, keywords, workModes: workModes as WorkMode[], yearsExperience: years as number | null, salaryMin: salary as number | null, salaryCurrency: currency, resumeId: resumeId as string | null };
}

export function readProfile(row: { preferences: unknown; resume_id: string | null } | null): CareerProfile {
  if (!row) return { ...EMPTY_PROFILE };
  return parseProfile({ ...(row.preferences as object), resumeId: row.resume_id });
}

export function resumeEvidence(resume: Resume): ResumeEvidence {
  return {
    id: resume.id, label: resume.label,
    skills: uniqueSkills([...(resume.parsed?.skills ?? []), ...extractSkills(resume.extractedText ?? "")]),
    roles: resume.parsed?.roles.map((r) => r.title) ?? [],
    yearsExperience: resume.parsed?.totalYearsExperience ?? null,
  };
}

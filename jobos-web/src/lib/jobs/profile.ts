import { EMPTY_PROFILE, type CareerProfile, type ResumeEvidence, type WorkMode } from "./types.ts";
import { extractSkills, mentions, uniqueSkills } from "./matching.ts";
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
  const text = resume.extractedText ?? "";
  const skills = uniqueSkills([...(resume.parsed?.skills ?? []), ...extractSkills(text)]).slice(0, 80);
  const history = resume.parsed?.roles.map((r) => r.title) ?? [];
  const education = resume.parsed?.education.map((e) => `${e.degree} ${e.field ?? ""}`).join(" ") ?? "";
  const context = `${history.join(" ")} ${education} ${text}`;
  // A labelled location near the resume header is evidence; an employer address
  // somewhere in work history is not a preference. Never infer work mode.
  const location = text.slice(0, 800).match(/(?:^|\n)\s*(?:location|based in)\s*:\s*([^\n|;]{2,80})/i)?.[1]?.trim();
  const explicitYears = text.slice(0, 1500).match(/\b(\d{1,2}(?:\.\d)?)\+?\s+years?\s+(?:of\s+)?(?:professional\s+|total\s+|relevant\s+)?experience\b/i)?.[1];
  const years = resume.parsed?.totalYearsExperience ?? (explicitYears ? Number(explicitYears) : null);
  return {
    id: resume.id, label: resume.label, fileName: resume.fileName ?? resume.label,
    createdAt: resume.createdAt, usable: text.trim().length >= 50 || !!resume.parsed,
    skills, roles: history, suggestedRoles: suggestRoles(skills, context),
    yearsExperience: typeof years === "number" && Number.isFinite(years) && years >= 0 && years <= 60 ? years : null,
    locations: location && !/@|https?:|\d{5,}/i.test(location) ? [location] : [],
    keywords: ["Operations", "Analytics", "Reporting", "Finance", "Customer support", "Supply chain", "Open source", "Fintech"].filter((k) => mentions(context, k)),
  };
}

/** Small, conservative role families backed by at least two relevant signals. */
export function suggestRoles(skills: string[], context: string): string[] {
  const has = (...values: string[]) => values.filter((value) => skills.some((s) => mentions(s, value))).length;
  const evidence = (value: string) => mentions(context, value);
  const roles: string[] = [];
  const analytics = has("SQL", "Excel", "Power BI", "Tableau", "Python", "Data Analysis");
  if (analytics >= 2) {
    if (evidence("operations")) roles.push("Operations Analyst");
    if (has("Excel") && (has("Power BI", "SQL") || evidence("reporting"))) roles.push("MIS Analyst");
    roles.push("Data Analyst");
    if (evidence("business") || evidence("operations") || evidence("requirements")) roles.push("Business Analyst");
  }
  if (has("React", "Vue", "Angular") && has("JavaScript", "TypeScript", "HTML", "CSS")) roles.push("Frontend Developer");
  if (has("Node.js", "Python", "Java", "Go", "Rust") && has("SQL", "PostgreSQL", "REST", "GraphQL") && (evidence("software") || evidence("computer science") || evidence("backend"))) roles.push("Backend Developer");
  if (has("Docker", "Kubernetes", "Terraform") >= 2 && has("AWS", "Azure", "GCP", "Linux")) roles.push("DevOps Engineer");
  if (has("Accounting", "Excel") === 2 && (evidence("finance") || evidence("accounting"))) roles.push("Accounting Analyst");
  if (has("Customer Support") && (evidence("customer service") || evidence("support specialist"))) roles.push("Customer Support Specialist");
  if (has("Marketing") && (evidence("campaign") || evidence("digital marketing"))) roles.push("Marketing Coordinator");
  return roles.slice(0, 4); // Never add seniority from tenure or education.
}

export type InferredField = "roles" | "skills" | "yearsExperience" | "locations" | "keywords";
export function prefillProfile(profile: CareerProfile, resume: ResumeEvidence, protectedFields: InferredField[] = []): CareerProfile {
  const result = { ...profile };
  const suggestions = { roles: resume.suggestedRoles ?? [], skills: resume.skills, locations: resume.locations ?? [], keywords: resume.keywords ?? [] };
  for (const field of ["roles", "skills", "locations", "keywords"] as const) {
    if (!protectedFields.includes(field) && profile[field].length === 0) result[field] = suggestions[field];
  }
  if (!protectedFields.includes("yearsExperience") && profile.yearsExperience === null) result.yearsExperience = resume.yearsExperience;
  return result;
}

export function selectedResume(resumes: ResumeEvidence[], id: string | null): ResumeEvidence | undefined {
  return resumes.find((r) => r.id === id || r.aliases?.includes(id ?? ""));
}

export function resumeOptionLabel(resume: ResumeEvidence): string {
  const date = resume.createdAt && Number.isFinite(Date.parse(resume.createdAt)) ? new Date(resume.createdAt).toLocaleDateString("en-GB", { timeZone: "UTC" }) : "";
  return `${resume.fileName ?? resume.label}${date ? ` · ${date}` : ""}${resume.usable === false ? " · no readable text" : ""}`;
}

import { canonicalSkill, findSatisfyingSkill, normalizeText, tokenize } from "../ai/normalize.ts";
import type { CareerProfile, Job, JobFit, ResumeEvidence } from "./types.ts";

// Keywords are evidence of mentions, never a claim that every mention is mandatory.
const SKILLS = ["JavaScript", "TypeScript", "React", "Next.js", "Vue", "Angular", "Node.js", "Python", "Java", "C++", "C#", "Go", "Rust", "SQL", "PostgreSQL", "MySQL", "MongoDB", "Redis", "AWS", "Azure", "GCP", "Docker", "Kubernetes", "Linux", "Git", "Terraform", "CI/CD", "HTML", "CSS", "REST", "GraphQL", "Excel", "Power BI", "Tableau", "R", "Pandas", "TensorFlow", "PyTorch", "Machine Learning", "Data Analysis", "Salesforce", "Figma", "Accounting", "Sales", "Marketing", "Project Management", "Product Management", "Customer Support", "Communication", "Leadership"];

export function mentions(text: string, phrase: string): boolean {
  // Preserve punctuation that distinguishes programming languages.
  if (/^(c\+\+|c#)$/i.test(phrase.trim())) {
    const escaped = phrase.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9+#])`, "i").test(text);
  }
  const normalized = ` ${normalizeText(text)} `;
  return normalized.includes(` ${normalizeText(phrase)} `);
}

export function extractSkills(text: string): string[] {
  return SKILLS.filter((skill) => {
    // Avoid treating ordinary prose ("go further", "R&D") as language evidence.
    if (skill === "Go") return /\bGolang\b|\bGo\s+(?:language|programming)\b|\b(?:in|using|with)\s+Go\b/.test(text);
    if (skill === "R") return /\bR\s+(?:language|programming)\b|\b(?:in|using|with)\s+R(?=$|[\s,.;/)])/.test(text);
    return mentions(text, skill);
  });
}

const skillKey = (skill: string) => /^(c\+\+|c#)$/i.test(skill.trim()) ? skill.trim().toLowerCase() : canonicalSkill(skill);
function hasSkill(required: string, skills: string[]): boolean {
  if (/^(c\+\+|c#)$/i.test(required)) return skills.some((s) => skillKey(s) === skillKey(required));
  return findSatisfyingSkill(required, skills.filter((s) => !/^(c\+\+|c#)$/i.test(s))) !== null;
}

export function roleAlignment(title: string, roles: string[]): number {
  const words = new Set(tokenize(title).filter((w) => !["and", "of", "the", "a"].includes(w)));
  return Math.max(0, ...roles.map((role) => {
    const target = tokenize(role).filter((w) => !["and", "of", "the", "a"].includes(w));
    return target.length ? target.filter((w) => words.has(w)).length / target.length : 0;
  }));
}

export function scoreJob(job: Job, profile: CareerProfile, resume?: ResumeEvidence): JobFit {
  const skills = uniqueSkills([...profile.skills, ...(resume?.skills ?? [])]);
  const roles = profile.roles.length ? profile.roles : resume?.suggestedRoles ?? [];
  const years = profile.yearsExperience ?? resume?.yearsExperience ?? null;
  const result: JobFit = { score: 0, strengths: [], gaps: [], matchedSkills: [], missingSkills: [], components: [], evidence: "Limited" };
  function add(label: string, weight: number, ratio: number) {
    result.components.push({ label, available: weight, points: weight * Math.max(0, Math.min(1, ratio)) });
  }
  if (roles.length) {
    const ratio = roleAlignment(job.title, roles);
    add("Target role", 35, ratio);
    (ratio >= 0.6 ? result.strengths : result.gaps).push(ratio >= 0.6 ? "Title aligns with your target roles" : "Title differs from your target roles");
  }
  // Include explicit profile skills outside the small starter vocabulary when mentioned.
  const jobSkills = uniqueSkills([...job.skills, ...skills.filter((s) => mentions(job.description, s))]);
  result.matchedSkills = jobSkills.filter((s) => hasSkill(s, skills));
  result.missingSkills = jobSkills.filter((s) => !hasSkill(s, skills));
  if (jobSkills.length) add("Skills mentioned", 35, result.matchedSkills.length / jobSkills.length);
  if (result.matchedSkills.length) result.strengths.push(`${result.matchedSkills.length} skill mentions match your profile or resume`);
  if (result.missingSkills.length) result.gaps.push("Some skills mentioned in the listing are not evidenced in your profile");
  if (job.minYearsExperience !== null && years !== null) {
    add("Experience", 15, job.minYearsExperience === 0 ? 1 : years / job.minYearsExperience);
    (years >= job.minYearsExperience ? result.strengths : result.gaps).push(years >= job.minYearsExperience ? "Meets the stated minimum years" : `${job.minYearsExperience}+ years requested; your profile shows ${years}`);
  } else result.gaps.push(job.minYearsExperience === null ? "Minimum experience not stated clearly" : "Add your experience to assess this requirement");
  if (profile.locations.length && job.location) {
    const matched = profile.locations.some((l) => mentions(job.location, l));
    add("Location", 8, matched ? 1 : 0);
    (matched ? result.strengths : result.gaps).push(matched ? "Location matches a preference" : "Check location eligibility; remote may be region-limited");
  }
  if (profile.workModes.length && job.workMode) {
    const matched = profile.workModes.includes(job.workMode);
    add("Work mode", 7, matched ? 1 : 0);
    (matched ? result.strengths : result.gaps).push(matched ? `${job.workMode} matches your preference` : `${job.workMode} differs from your preference`);
  }
  if (profile.keywords.length) add("Preferences", 5, profile.keywords.filter((k) => mentions(`${job.title} ${job.description}`, k)).length / profile.keywords.length);
  if (resume?.skills.length && jobSkills.length) {
    const evidenced = jobSkills.filter((s) => hasSkill(s, resume.skills));
    add("Resume evidence", 10, evidenced.length / jobSkills.length);
    if (evidenced.length) result.strengths.push(`Resume evidence: ${evidenced.slice(0, 4).join(", ")}`);
  }
  if (profile.salaryMin !== null && (!job.salary || job.salary.currency !== profile.salaryCurrency || job.salary.period !== "year")) result.gaps.push("Salary preference cannot be compared with this listing");
  else if (profile.salaryMin !== null && job.salary?.max !== null && job.salary?.max !== undefined && job.salary.max < profile.salaryMin) result.gaps.push("Published annual salary is below your preference");
  const available = result.components.reduce((sum, c) => sum + c.available, 0);
  result.score = available ? Math.round(result.components.reduce((sum, c) => sum + c.points, 0) / available * 100) : 0;
  result.evidence = result.components.length >= 5 ? "Strong" : result.components.length >= 3 ? "Moderate" : "Limited";
  return result;
}

export function uniqueSkills(values: string[]): string[] {
  return [...new Map(values.filter((s) => skillKey(s)).map((s) => [skillKey(s), s])).values()];
}

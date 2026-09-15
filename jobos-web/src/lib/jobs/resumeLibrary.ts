import { createHash } from "node:crypto";
import type { Resume } from "../ai/types.ts";
import type { ResumeEvidence } from "./types.ts";
import { resumeEvidence } from "./profile.ts";

/** Display-only deduplication. Keep every stored resume and existing reference. */
export function discoveryResumes(resumes: Resume[]): ResumeEvidence[] {
  const sorted = resumes.map((resume) => ({ resume, evidence: resumeEvidence(resume) }))
    .sort((a, b) => Number(b.evidence.usable) - Number(a.evidence.usable) || b.resume.createdAt.localeCompare(a.resume.createdAt) || a.resume.id.localeCompare(b.resume.id));
  const groups = new Map<string, ResumeEvidence>();
  const parsedGroups = new Set<string>();
  for (const { resume, evidence } of sorted) {
    const text = resume.extractedText?.replace(/\s+/g, " ").trim();
    const key = text ? `text:${createHash("sha256").update(text).digest("hex")}` : resume.filePath ? `file:${resume.filePath}` : `id:${resume.id}`;
    const existing = groups.get(key);
    if (existing) {
      existing.aliases!.push(resume.id);
      // Identical text can reuse a parse from an older upload, while retaining
      // the newest file's identity/metadata and all existing selected aliases.
      if (resume.parsed && !parsedGroups.has(key)) {
        Object.assign(existing, { skills: evidence.skills, roles: evidence.roles, suggestedRoles: evidence.suggestedRoles, yearsExperience: evidence.yearsExperience, keywords: evidence.keywords, locations: evidence.locations });
      }
    } else groups.set(key, { ...evidence, aliases: [resume.id] });
    if (resume.parsed) parsedGroups.add(key);
  }
  return [...groups.values()];
}

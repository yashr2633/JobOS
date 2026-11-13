import { extractSkills } from "../jobs/matching.ts";
import { roleEvidenceText } from "../jobs/jobEvidence.ts";
import type { MatchInterpretation, MatchScoreResult, ParsedJD, ParsedResume } from "./types.ts";

export function extractMatchJob(text: string): ParsedJD | null {
  const skills = extractSkills(roleEvidenceText(text));
  if (!skills.length) return null;
  return {
    title: null,
    company: null,
    requiredSkills: skills,
    preferredSkills: [],
    minYearsExperience: null,
    educationRequirements: [],
    responsibilities: [],
  };
}

export function extractMatchResume(text: string): ParsedResume {
  return { skills: extractSkills(text), totalYearsExperience: null, roles: [], education: [] };
}

export function explainMatch(score: MatchScoreResult, textOnly: boolean): MatchInterpretation {
  const matches = [...score.requiredSkills, ...score.preferredSkills].filter(skill => skill.matched);
  const visibleSkills = matches.slice(0, 5).map(skill => skill.skill).join(", ");
  const summary = [
    textOnly ? "Quick match based on recognizable skill mentions. Review the full job description for requirements such as experience and education." : "Here’s a summary of the resume evidence compared with the job description.",
    visibleSkills ? "Matching skills found: " + visibleSkills + "." : "No matching skills were identified in the available resume text.",
  ].join(" ");
  const recommendations: string[] = [];
  if (score.missingRequiredSkills.length) {
    recommendations.push("Check whether your resume shows relevant experience with " + score.missingRequiredSkills.slice(0, 4).join(", ") + ". Add examples where you have that experience.");
  }
  if (score.experienceGap?.gapYears) recommendations.push("Review the stated experience requirement and make relevant dates and responsibilities clear.");
  if (score.educationGap?.met === false) recommendations.push("Check the employer’s education requirement and any accepted alternatives.");
  if (!recommendations.length) recommendations.push("Lead with a relevant project or achievement and describe what you delivered.");
  return { summary, recommendations };
}


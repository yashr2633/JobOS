/**
 * Deterministic, rule-based match scoring.
 *
 * The numeric 0-100 score is computed entirely here. No model call, no
 * randomness, no clock, no I/O. The same (ParsedJD, ParsedResume) pair always
 * yields the same score, which is what makes the number defensible to a user
 * and safe to store and compare over time.
 *
 * The LLM's role is limited to producing the structured inputs and, separately,
 * a human-readable interpretation of this result.
 */

import {
  findSatisfyingSkill,
  degreeLevelRank,
  detectDegreeLevel,
  highestDegreeLevel,
} from "./normalize.ts";
import {
  SCORING_VERSION,
  type DegreeLevel,
  type EducationGap,
  type ExperienceGap,
  type MatchConfidence,
  type MatchDimension,
  type MatchScoreResult,
  type ParsedJD,
  type ParsedResume,
  type ScoreComponent,
  type SkillAssessment,
} from "./types.ts";

/**
 * Base weights in percentage points. Required skills dominate because they are
 * the hard filter a real recruiter applies first.
 *
 * When a JD does not state a dimension (no education requirement, no minimum
 * years), that dimension is absent and its weight is redistributed
 * proportionally across the dimensions that are present. Without this, a JD
 * that simply omits an education line would cap every candidate at 90.
 */
const BASE_WEIGHTS: Readonly<Record<MatchDimension, number>> = {
  requiredSkills: 55,
  preferredSkills: 20,
  experience: 15,
  education: 10,
};

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function assessSkills(
  required: string[],
  candidateSkills: string[]
): SkillAssessment[] {
  return required.map((skill) => {
    const matchedBy = findSatisfyingSkill(skill, candidateSkills);
    return { skill, matched: matchedBy !== null, matchedBy };
  });
}

function matchedRatio(assessments: SkillAssessment[]): number {
  if (assessments.length === 0) return 0;
  const matched = assessments.filter((entry) => entry.matched).length;
  return matched / assessments.length;
}

function buildExperienceGap(
  jd: ParsedJD,
  resume: ParsedResume
): ExperienceGap | null {
  const requiredYears = jd.minYearsExperience;
  if (requiredYears === null || requiredYears <= 0) return null;

  const candidateYears = resume.totalYearsExperience ?? 0;

  return {
    requiredYears,
    candidateYears,
    gapYears: Math.max(0, requiredYears - candidateYears),
  };
}

function buildEducationGap(
  jd: ParsedJD,
  resume: ParsedResume
): EducationGap | null {
  if (jd.educationRequirements.length === 0) return null;

  const requiredLevel = highestDegreeLevel(jd.educationRequirements);

  // The JD mentioned education but named no recognizable degree level, so
  // there is nothing rule-based to check. Left to the interpretation layer.
  if (requiredLevel === "none") return null;

  const candidateLevel: DegreeLevel = highestDegreeLevel(
    resume.education.map((entry) => entry.degree)
  );

  return {
    requiredLevel,
    candidateLevel,
    met: degreeLevelRank(candidateLevel) >= degreeLevelRank(requiredLevel),
  };
}

/**
 * Confidence reflects how much evidence the JD gave us to score against, not
 * how good the candidate is. Derived deterministically from which dimensions
 * were present.
 */
function deriveConfidence(
  presentDimensions: MatchDimension[],
  resume: ParsedResume
): MatchConfidence {
  // Nothing to compare the JD against.
  if (resume.skills.length === 0) return "low";
  if (!presentDimensions.includes("requiredSkills")) return "low";

  const supportingCount = presentDimensions.filter(
    (dimension) => dimension !== "requiredSkills"
  ).length;

  if (supportingCount >= 2) return "high";
  if (supportingCount === 1) return "medium";
  return "low";
}

/**
 * Compute the deterministic match result.
 *
 * Guarantees (verified in scoring.test.ts):
 *  - `score` is an integer in 0..100
 *  - identical inputs produce an identical result
 *  - `missingRequiredSkills` is exactly the unmatched subset of
 *    `jd.requiredSkills`; likewise for preferred
 *  - effective weights across present dimensions sum to 1
 *  - a resume that satisfies every stated dimension scores 100
 */
export function scoreMatch(
  jd: ParsedJD,
  resume: ParsedResume
): MatchScoreResult {
  const requiredSkills = assessSkills(jd.requiredSkills, resume.skills);
  const preferredSkills = assessSkills(jd.preferredSkills, resume.skills);

  const experienceGap = buildExperienceGap(jd, resume);
  const educationGap = buildEducationGap(jd, resume);

  // A dimension is present only when the JD actually stated it.
  const ratios: Partial<Record<MatchDimension, number>> = {};

  if (jd.requiredSkills.length > 0) {
    ratios.requiredSkills = matchedRatio(requiredSkills);
  }
  if (jd.preferredSkills.length > 0) {
    ratios.preferredSkills = matchedRatio(preferredSkills);
  }
  if (experienceGap !== null) {
    ratios.experience = clamp01(
      experienceGap.candidateYears / experienceGap.requiredYears
    );
  }
  if (educationGap !== null) {
    ratios.education = educationGap.met ? 1 : 0;
  }

  const presentDimensions = Object.keys(ratios) as MatchDimension[];

  const totalBaseWeight = presentDimensions.reduce(
    (sum, dimension) => sum + BASE_WEIGHTS[dimension],
    0
  );

  // The JD gave us nothing scoreable. Report 0 with low confidence rather than
  // inventing a number; callers should surface this as an unusable parse.
  if (totalBaseWeight === 0) {
    return {
      score: 0,
      scoringVersion: SCORING_VERSION,
      confidence: "low",
      components: [],
      requiredSkills,
      preferredSkills,
      missingRequiredSkills: [],
      missingPreferredSkills: [],
      experienceGap,
      educationGap,
    };
  }

  const components: ScoreComponent[] = presentDimensions.map((dimension) => {
    const weight = BASE_WEIGHTS[dimension] / totalBaseWeight;
    const ratio = ratios[dimension] ?? 0;
    return { dimension, weight, ratio, points: weight * ratio * 100 };
  });

  const rawScore = components.reduce(
    (sum, component) => sum + component.points,
    0
  );

  return {
    score: Math.round(clamp01(rawScore / 100) * 100),
    scoringVersion: SCORING_VERSION,
    confidence: deriveConfidence(presentDimensions, resume),
    components,
    requiredSkills,
    preferredSkills,
    missingRequiredSkills: requiredSkills
      .filter((entry) => !entry.matched)
      .map((entry) => entry.skill),
    missingPreferredSkills: preferredSkills
      .filter((entry) => !entry.matched)
      .map((entry) => entry.skill),
    experienceGap,
    educationGap,
  };
}

/** Re-exported so callers can label a stored degree level without importing normalize. */
export { detectDegreeLevel };

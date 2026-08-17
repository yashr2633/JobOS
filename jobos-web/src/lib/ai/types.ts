/**
 * Sprint 5 AI Job Intelligence — shared type contracts.
 *
 * Pipeline:
 *   file/paste -> extracted text -> structured parse -> deterministic score
 *                                                    -> LLM interpretation
 *
 * The numeric match score is produced by pure rule-based scoring (see
 * `scoring.ts`). The model is used for structured extraction and for
 * human-readable interpretation only, never for the number itself.
 */

/**
 * Bump when scoring rules change so historical scores stay interpretable.
 * Persisted on every match_results row as `scoring_version`.
 */
export const SCORING_VERSION = 1;

// ---------------------------------------------------------------------------
// Stage 2 output: structured documents
// ---------------------------------------------------------------------------

export interface ParsedJD {
  title: string | null;
  company: string | null;
  /** Hard requirements. A JD parse with zero of these is treated as failed. */
  requiredSkills: string[];
  /** Nice-to-haves. */
  preferredSkills: string[];
  /** Minimum years stated by the JD, or null when unstated. */
  minYearsExperience: number | null;
  /** Raw requirement phrases, e.g. "Bachelor's degree in Computer Science". */
  educationRequirements: string[];
  responsibilities: string[];
}

export interface ResumeRole {
  title: string;
  years: number | null;
}

export interface ResumeEducation {
  degree: string;
  field: string | null;
}

export interface ParsedResume {
  skills: string[];
  totalYearsExperience: number | null;
  roles: ResumeRole[];
  education: ResumeEducation[];
}

// ---------------------------------------------------------------------------
// Stage 3 output: deterministic scoring
// ---------------------------------------------------------------------------

/** Ordered weakest to strongest so levels can be compared numerically. */
export const DEGREE_LEVELS = [
  "none",
  "associate",
  "bachelor",
  "master",
  "doctorate",
] as const;

export type DegreeLevel = (typeof DEGREE_LEVELS)[number];

export type MatchDimension =
  | "requiredSkills"
  | "preferredSkills"
  | "experience"
  | "education";

export type MatchConfidence = "low" | "medium" | "high";

export interface SkillAssessment {
  /** The skill as written in the JD. */
  skill: string;
  matched: boolean;
  /** Which resume skill satisfied it, for explainability. */
  matchedBy: string | null;
}

export interface ScoreComponent {
  dimension: MatchDimension;
  /** Effective weight after redistributing absent dimensions. 0..1 */
  weight: number;
  /** How well this dimension was satisfied. 0..1 */
  ratio: number;
  /** weight * ratio * 100, before final rounding. */
  points: number;
}

export interface ExperienceGap {
  requiredYears: number;
  candidateYears: number;
  /** Positive shortfall in years. 0 when the requirement is met. */
  gapYears: number;
}

export interface EducationGap {
  requiredLevel: DegreeLevel;
  candidateLevel: DegreeLevel;
  met: boolean;
}

export interface MatchScoreResult {
  /** Integer 0..100. Deterministic for a given input pair. */
  score: number;
  scoringVersion: number;
  /** Derived from which dimensions the JD actually stated. */
  confidence: MatchConfidence;
  components: ScoreComponent[];
  requiredSkills: SkillAssessment[];
  preferredSkills: SkillAssessment[];
  missingRequiredSkills: string[];
  missingPreferredSkills: string[];
  /** Null when the JD states no experience requirement. */
  experienceGap: ExperienceGap | null;
  /** Null when the JD states no education requirement. */
  educationGap: EducationGap | null;
}

// ---------------------------------------------------------------------------
// Stage 4 output: LLM interpretation
// ---------------------------------------------------------------------------

/** Advisory text only. Must not influence `MatchScoreResult.score`. */
export interface MatchInterpretation {
  summary: string;
  recommendations: string[];
}

// ---------------------------------------------------------------------------
// Persistence-facing types
// ---------------------------------------------------------------------------

export type StageStatus = "pending" | "complete" | "failed";

export type AnalysisStatus = "pending" | "processing" | "complete" | "failed";

export type ResumeSource = "paste" | "upload";

export interface Resume {
  id: string;
  label: string;
  source: ResumeSource;
  fileName: string | null;
  filePath: string | null;
  extractedText: string | null;
  extractionStatus: StageStatus;
  extractionError: string | null;
  parsed: ParsedResume | null;
  parsedAt: string | null;
  parseStatus: StageStatus;
  parseError: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A single analysis run against one application/resume pair. */
export interface MatchResult {
  id: string;
  applicationId: string;
  resumeId: string | null;
  status: AnalysisStatus;
  failureReason: string | null;
  score: number | null;
  scoringVersion: number | null;
  confidence: MatchConfidence | null;
  components: ScoreComponent[] | null;
  requiredSkills: SkillAssessment[] | null;
  preferredSkills: SkillAssessment[] | null;
  missingRequiredSkills: string[] | null;
  missingPreferredSkills: string[] | null;
  experienceGap: ExperienceGap | null;
  educationGap: EducationGap | null;
  summary: string | null;
  recommendations: string[] | null;
  model: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

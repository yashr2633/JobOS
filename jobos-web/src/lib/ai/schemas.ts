/**
 * Runtime validation for model output.
 *
 * Model responses are untrusted input. A JD pasted from a job board can contain
 * prompt-injection text, and even a well-behaved model can return a 0-1 float
 * where an integer was asked for. Nothing reaches the database without passing
 * through here, so a hijacked or malformed response fails closed instead of
 * writing a misleading result into a user's row.
 *
 * Hand-written guards rather than a schema library: the shapes are few and
 * fixed, and this keeps the dependency count at zero.
 */

import { dedupeSkills } from "./normalize.ts";
import type {
  MatchInterpretation,
  ParsedJD,
  ParsedResume,
  ResumeEducation,
  ResumeRole,
} from "./types.ts";

/** Bounds that keep token cost and stored payloads predictable. */
export const LIMITS = {
  /** Characters of raw JD or resume text accepted per request. */
  inputTextMax: 20_000,
  /** Minimum text length worth sending to a model. */
  inputTextMin: 50,
  skillMax: 80,
  skillsPerList: 60,
  phraseMax: 300,
  phrasesPerList: 40,
  summaryMax: 2_000,
  recommendationMax: 500,
  recommendationsMax: 10,
  /** Sanity ceiling on years, guards against a model returning a year like 2019. */
  yearsMax: 60,
} as const;

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function fail<T>(error: string): ValidationResult<T> {
  return { ok: false, error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Trimmed non-empty string within `max`, or null. */
function optionalString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > max) return null;
  return trimmed;
}

/**
 * Clean a string array: drop non-strings, empties, and over-length entries,
 * then cap the list. Silently filtering junk entries is deliberate — one odd
 * skill string should not fail an otherwise usable parse.
 */
function stringList(value: unknown, maxItem: number, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];

  const cleaned: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (trimmed === "" || trimmed.length > maxItem) continue;
    cleaned.push(trimmed);
    if (cleaned.length >= maxItems) break;
  }

  return cleaned;
}

/** Finite, non-negative, within `LIMITS.yearsMax`, or null. Accepts halves. */
function optionalYears(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0 || value > LIMITS.yearsMax) return null;
  return Math.round(value * 2) / 2;
}

// ---------------------------------------------------------------------------
// Raw input text
// ---------------------------------------------------------------------------

export function validateInputText(
  value: unknown,
  label: string
): ValidationResult<string> {
  if (typeof value !== "string") {
    return fail(`${label} must be a string.`);
  }

  const trimmed = value.trim();

  if (trimmed.length < LIMITS.inputTextMin) {
    return fail(
      `${label} is too short to analyze (minimum ${LIMITS.inputTextMin} characters).`
    );
  }
  if (trimmed.length > LIMITS.inputTextMax) {
    return fail(
      `${label} exceeds the ${LIMITS.inputTextMax} character limit. Trim it and retry.`
    );
  }

  return { ok: true, value: trimmed };
}

// ---------------------------------------------------------------------------
// ParsedJD
// ---------------------------------------------------------------------------

export function validateParsedJD(value: unknown): ValidationResult<ParsedJD> {
  if (!isRecord(value)) {
    return fail("Job description parse did not return an object.");
  }

  const requiredSkills = dedupeSkills(
    stringList(value.requiredSkills, LIMITS.skillMax, LIMITS.skillsPerList)
  );

  // Required skills carry the majority of the score. Without at least one, the
  // parse is unusable and retrying is better than storing a meaningless score.
  if (requiredSkills.length === 0) {
    return fail(
      "Job description parse produced no required skills. The text may not be a job description."
    );
  }

  const preferredSkills = dedupeSkills(
    stringList(value.preferredSkills, LIMITS.skillMax, LIMITS.skillsPerList)
  );

  return {
    ok: true,
    value: {
      title: optionalString(value.title, LIMITS.phraseMax),
      company: optionalString(value.company, LIMITS.phraseMax),
      requiredSkills,
      preferredSkills,
      minYearsExperience: optionalYears(value.minYearsExperience),
      educationRequirements: stringList(
        value.educationRequirements,
        LIMITS.phraseMax,
        LIMITS.phrasesPerList
      ),
      responsibilities: stringList(
        value.responsibilities,
        LIMITS.phraseMax,
        LIMITS.phrasesPerList
      ),
    },
  };
}

// ---------------------------------------------------------------------------
// ParsedResume
// ---------------------------------------------------------------------------

function roleList(value: unknown): ResumeRole[] {
  if (!Array.isArray(value)) return [];

  const roles: ResumeRole[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const title = optionalString(entry.title, LIMITS.phraseMax);
    if (title === null) continue;
    roles.push({ title, years: optionalYears(entry.years) });
    if (roles.length >= LIMITS.phrasesPerList) break;
  }

  return roles;
}

function educationList(value: unknown): ResumeEducation[] {
  if (!Array.isArray(value)) return [];

  const education: ResumeEducation[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const degree = optionalString(entry.degree, LIMITS.phraseMax);
    if (degree === null) continue;
    education.push({
      degree,
      field: optionalString(entry.field, LIMITS.phraseMax),
    });
    if (education.length >= LIMITS.phrasesPerList) break;
  }

  return education;
}

export function validateParsedResume(
  value: unknown
): ValidationResult<ParsedResume> {
  if (!isRecord(value)) {
    return fail("Resume parse did not return an object.");
  }

  const skills = dedupeSkills(
    stringList(value.skills, LIMITS.skillMax, LIMITS.skillsPerList)
  );

  if (skills.length === 0) {
    return fail(
      "Resume parse produced no skills. The extracted text may be empty or image-only."
    );
  }

  return {
    ok: true,
    value: {
      skills,
      totalYearsExperience: optionalYears(value.totalYearsExperience),
      roles: roleList(value.roles),
      education: educationList(value.education),
    },
  };
}

// ---------------------------------------------------------------------------
// MatchInterpretation
// ---------------------------------------------------------------------------

/**
 * Validates the advisory text. Note there is no score field to validate here:
 * the model is never asked for the number, so it cannot corrupt it. A model
 * that ignores instructions and returns a score simply has that field dropped.
 */
export function validateMatchInterpretation(
  value: unknown
): ValidationResult<MatchInterpretation> {
  if (!isRecord(value)) {
    return fail("Interpretation did not return an object.");
  }

  const summary = optionalString(value.summary, LIMITS.summaryMax);
  if (summary === null) {
    return fail("Interpretation is missing a usable summary.");
  }

  return {
    ok: true,
    value: {
      summary,
      recommendations: stringList(
        value.recommendations,
        LIMITS.recommendationMax,
        LIMITS.recommendationsMax
      ),
    },
  };
}

// ---------------------------------------------------------------------------
// Gmail email classification (Sprint 7 — Track My Jobs)
// ---------------------------------------------------------------------------

/**
 * Valid categories. Mirrors EMAIL_CATEGORIES in lib/gmail/heuristics.ts.
 *
 * `Ghosted` is intentionally not a category: it is derived from the absence of
 * activity and can never be asserted by a single email.
 */
const EMAIL_CATEGORY_VALUES = new Set([
  "APPLICATION_CONFIRMATION",
  "APPLICATION_RECEIVED",
  "APPLICATION_UPDATE",
  "INTERVIEW_INVITATION",
  "INTERVIEW_UPDATE",
  "RECRUITER_CONTACT",
  "REJECTION",
  "OFFER",
  "WITHDRAWAL",
  "FOLLOW_UP",
  "OTHER_JOB_RELATED",
  "NOT_JOB_RELATED",
]);

/** Bounds on model-supplied strings, so a hostile reply cannot bloat a row. */
const MAX_FIELD_CHARS = 200;
const MAX_URL_CHARS = 2048;
const MAX_RESULTS = 50;

export interface EmailClassificationResult {
  id: string;
  category: string;
  company: string | null;
  jobTitle: string | null;
  location: string | null;
  jobUrl: string | null;
  confidence: number;
}

export interface EmailClassificationBatch {
  results: EmailClassificationResult[];
}

/**
 * Accept only http(s) URLs.
 *
 * A model-supplied `javascript:` or `data:` URL would otherwise be persisted
 * and later rendered as a link. Reuses the existing `optionalString` helper
 * above rather than duplicating trimming/bounding logic.
 */
function optionalHttpUrl(value: unknown): string | null {
  const candidate = optionalString(value, MAX_URL_CHARS);
  if (!candidate) return null;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return candidate;
  } catch {
    return null;
  }
}

/**
 * Strictly validate a classification batch.
 *
 * Anything unrecognised is rejected rather than coerced, and any field the
 * model was not asked for is silently dropped — a reply cannot smuggle in an
 * application status, a score, or an id of its own choosing. This mirrors the
 * discipline already applied to JD/resume parses.
 */
export function validateEmailClassification(
  value: unknown
): ValidationResult<EmailClassificationBatch> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "Classification must be a JSON object." };
  }

  const rawResults = (value as { results?: unknown }).results;
  if (!Array.isArray(rawResults)) {
    return { ok: false, error: "Classification must include a results array." };
  }
  if (rawResults.length === 0) {
    return { ok: false, error: "Classification returned no results." };
  }
  if (rawResults.length > MAX_RESULTS) {
    return { ok: false, error: "Classification returned too many results." };
  }

  const results: EmailClassificationResult[] = [];

  for (const entry of rawResults) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return { ok: false, error: "Each classification result must be an object." };
    }

    const record = entry as Record<string, unknown>;

    const id = optionalString(record.id, 64);
    if (!id) {
      return { ok: false, error: "Each classification result needs an id." };
    }

    const category = optionalString(record.category, 64);
    if (!category || !EMAIL_CATEGORY_VALUES.has(category)) {
      return { ok: false, error: `Unknown classification category.` };
    }

    // Confidence must be a real number in range; NaN/strings/out-of-range are
    // rejected rather than clamped, so a nonsense reply cannot look certain.
    const confidenceRaw = record.confidence;
    if (typeof confidenceRaw !== "number" || !Number.isFinite(confidenceRaw)) {
      return { ok: false, error: "Classification confidence must be a number." };
    }
    if (confidenceRaw < 0 || confidenceRaw > 1) {
      return { ok: false, error: "Classification confidence must be between 0 and 1." };
    }

    results.push({
      id,
      category,
      company: optionalString(record.company, MAX_FIELD_CHARS),
      jobTitle: optionalString(record.job_title ?? record.jobTitle, MAX_FIELD_CHARS),
      location: optionalString(record.location, MAX_FIELD_CHARS),
      jobUrl: optionalHttpUrl(record.job_url ?? record.jobUrl),
      confidence: confidenceRaw,
    });
  }

  return { ok: true, value: { results } };
}

/**
 * Deterministic text normalization for skill and degree comparison.
 *
 * Every function here is pure and free of I/O, randomness, and locale
 * dependence, so the scoring layer built on top is reproducible.
 */

import { DEGREE_LEVELS, type DegreeLevel } from "./types.ts";

/**
 * Canonical forms for skills that are commonly written several ways.
 * Keys and values must already be in normalized form (lowercase, punctuation
 * collapsed to single spaces).
 */
const SKILL_ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  "node": "nodejs",
  "node js": "nodejs",
  "react js": "react",
  "reactjs": "react",
  "next js": "nextjs",
  "vue js": "vue",
  "postgres": "postgresql",
  "post gres": "postgresql",
  "golang": "go",
  "c sharp": "csharp",
  "c#": "csharp",
  "dot net": "dotnet",
  ".net": "dotnet",
  "k8s": "kubernetes",
  "gcp": "google cloud platform",
  "ci cd": "cicd",
  "rest api": "rest",
  "restful": "rest",
  "tailwind css": "tailwindcss",
  "html5": "html",
  "css3": "css",
};

/**
 * Lowercase, replace every non-alphanumeric run with a single space, trim.
 *
 * "React.js" -> "react js", "CI/CD" -> "ci cd", "  Node  " -> "node"
 */
export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function tokenize(value: string): string[] {
  const normalized = normalizeText(value);
  return normalized === "" ? [] : normalized.split(" ");
}

/**
 * Normalize, then resolve through the alias table.
 * Aliases are applied to the whole normalized string, not per token, so
 * "node js" resolves as a unit rather than mangling "js" inside it.
 */
export function canonicalSkill(value: string): string {
  const normalized = normalizeText(value);
  return SKILL_ALIASES[normalized] ?? normalized;
}

/** Deduplicate a skill list by canonical form, preserving first-seen wording. */
export function dedupeSkills(skills: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const skill of skills) {
    const canonical = canonicalSkill(skill);
    if (canonical === "" || seen.has(canonical)) continue;
    seen.add(canonical);
    result.push(skill.trim());
  }

  return result;
}

/** True when `needle` appears as a contiguous run of tokens inside `haystack`. */
function containsTokenRun(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;

  for (let start = 0; start <= haystack.length - needle.length; start += 1) {
    let matched = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[start + offset] !== needle[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }

  return false;
}

/**
 * Find the candidate skill that satisfies `required`, or null.
 *
 * Matching is intentionally directional: a candidate satisfies a requirement
 * when the candidate contains the requirement, not the reverse.
 *
 *   required "aws"        + candidate "aws lambda"  -> match
 *   required "aws lambda" + candidate "aws"         -> no match
 *
 * Token-run comparison also prevents substring false positives that plain
 * `includes` would produce, e.g. "java" never matches "javascript" because
 * those are different single tokens.
 *
 * Returns the candidate as originally written, for display.
 */
export function findSatisfyingSkill(
  required: string,
  candidates: string[]
): string | null {
  const requiredTokens = tokenize(canonicalSkill(required));
  if (requiredTokens.length === 0) return null;

  // Exact canonical equality first, so the most precise match wins.
  for (const candidate of candidates) {
    if (canonicalSkill(candidate) === canonicalSkill(required)) {
      return candidate;
    }
  }

  for (const candidate of candidates) {
    const candidateTokens = tokenize(canonicalSkill(candidate));
    if (containsTokenRun(candidateTokens, requiredTokens)) {
      return candidate;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Degree levels
// ---------------------------------------------------------------------------

/**
 * Normalized keyword -> level. Order of evaluation is highest level first so
 * "Master's or Bachelor's degree" resolves to the higher requirement.
 *
 * Ambiguous bare abbreviations ("ba", "bs", "be", "ma") are deliberately
 * excluded: they collide with ordinary words and would misfire on free text.
 */
const DEGREE_KEYWORDS: ReadonlyArray<readonly [DegreeLevel, string[]]> = [
  ["doctorate", ["phd", "ph d", "doctorate", "doctoral", "dphil", "d phil"]],
  ["master", ["master", "masters", "msc", "m sc", "mtech", "m tech", "mba", "meng", "m eng"]],
  [
    "bachelor",
    [
      "bachelor",
      "bachelors",
      "bsc",
      "b sc",
      "btech",
      "b tech",
      "beng",
      "b eng",
      "undergraduate degree",
    ],
  ],
  ["associate", ["associate", "associates", "diploma"]],
];

export function degreeLevelRank(level: DegreeLevel): number {
  return DEGREE_LEVELS.indexOf(level);
}

/**
 * Highest degree level mentioned in a free-text phrase.
 * Returns "none" when no recognized degree keyword is present.
 */
export function detectDegreeLevel(value: string): DegreeLevel {
  const tokens = tokenize(value);
  if (tokens.length === 0) return "none";

  for (const [level, keywords] of DEGREE_KEYWORDS) {
    for (const keyword of keywords) {
      if (containsTokenRun(tokens, keyword.split(" "))) {
        return level;
      }
    }
  }

  return "none";
}

/** Highest level across several phrases. */
export function highestDegreeLevel(values: string[]): DegreeLevel {
  let highest: DegreeLevel = "none";

  for (const value of values) {
    const level = detectDegreeLevel(value);
    if (degreeLevelRank(level) > degreeLevelRank(highest)) {
      highest = level;
    }
  }

  return highest;
}

/**
 * Match Gmail-discovered activity to an existing application.
 *
 * Pure decision logic: callers supply candidate applications and prior thread
 * links already read under RLS, so this module never queries and never sees
 * another user's data.
 *
 * Ambiguity is never auto-merged. A weak match is surfaced for user
 * confirmation instead, because silently merging two different applications is
 * far worse than asking once.
 */

import { normalizeText } from "../ai/normalize.ts";

/** Window either side of an application's applied date for a plausible match. */
export const MATCH_WINDOW_DAYS = 45;

/** Company/legal suffixes that carry no identifying information. */
const COMPANY_NOISE = new Set([
  "inc", "inc.", "llc", "ltd", "ltd.", "limited", "corp", "corp.",
  "corporation", "co", "co.", "company", "gmbh", "bv", "nv", "ag",
  "plc", "sa", "srl", "pty", "pvt", "private", "group", "holdings",
  "technologies", "technology", "labs", "software", "solutions",
]);

/**
 * Canonical company key for comparison.
 *
 * Reuses `normalizeText` from the AI layer for consistent casing/whitespace
 * handling, then drops legal suffixes so "Stripe, Inc." and "Stripe" agree.
 */
export function canonicalCompany(value: string | null): string | null {
  if (!value) return null;

  const normalized = normalizeText(value).replace(/[^a-z0-9\s]/g, " ");
  const tokens = normalized
    .split(/\s+/)
    .filter((token) => token.length > 0 && !COMPANY_NOISE.has(token));

  const key = tokens.join(" ").trim();
  return key === "" ? null : key;
}

/** Canonical job-title key. Titles vary far more than companies, so keep it loose. */
export function canonicalTitle(value: string | null): string | null {
  if (!value) return null;

  const normalized = normalizeText(value)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(senior|sr|junior|jr|staff|principal|lead|i{1,3}|iv|v)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalized === "" ? null : normalized;
}

/** Compare two job URLs ignoring query strings and trailing slashes. */
export function sameJobUrl(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;

  const canonical = (url: string): string | null => {
    try {
      const parsed = new URL(url);
      return `${parsed.host}${parsed.pathname}`.replace(/\/+$/, "").toLowerCase();
    } catch {
      return null;
    }
  };

  const left = canonical(a);
  const right = canonical(b);
  return left !== null && left === right;
}

/** An existing application, as read for the acting user only. */
export interface ApplicationCandidate {
  id: string;
  company: string;
  role: string;
  appliedDate: string;
  /** Job URL previously captured from Gmail evidence, when known. */
  jobUrl?: string | null;
}

/** What Gmail evidence tells us about a discovered application. */
export interface DiscoveredApplication {
  company: string | null;
  jobTitle: string | null;
  jobUrl: string | null;
  emailDate: string | null;
  gmailThreadId: string | null;
}

export type MatchTier =
  /** An earlier message in this thread is already linked. Strongest signal. */
  | "thread"
  /** Same canonical job URL. */
  | "job_url"
  /** Company + title agree within the date window. */
  | "company_title"
  /** Company agrees but the title does not — needs the user to confirm. */
  | "company_only"
  /** Nothing matched; propose a new application. */
  | "none";

export interface MatchOutcome {
  tier: MatchTier;
  applicationId: string | null;
  /** False for weak matches, which must be confirmed before linking. */
  autoLink: boolean;
  confidence: number;
}

/** Absolute day distance between two dates; Infinity when either is unusable. */
function dayDistance(a: string | null, b: string | null): number {
  if (!a || !b) return Number.POSITIVE_INFINITY;

  const left = Date.parse(a);
  const right = Date.parse(b);
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.abs(left - right) / 86_400_000;
}

/**
 * Resolve the best match for one discovered application.
 *
 * Tiers are evaluated strongest-first and the first hit wins. Only `thread`,
 * `job_url`, and `company_title` auto-link; `company_only` is returned for
 * review so an unrelated role at the same employer is never merged silently.
 *
 * @param threadApplicationId application already linked to this Gmail thread
 * @param candidates the acting user's existing applications
 */
export function matchApplication(
  discovered: DiscoveredApplication,
  candidates: ApplicationCandidate[],
  threadApplicationId: string | null = null
): MatchOutcome {
  // Tier 1: thread continuity. Carries the whole follow-up chain for free.
  if (threadApplicationId) {
    return {
      tier: "thread",
      applicationId: threadApplicationId,
      autoLink: true,
      confidence: 0.99,
    };
  }

  // Tier 2: exact job URL.
  if (discovered.jobUrl) {
    const urlMatch = candidates.find((candidate) =>
      sameJobUrl(candidate.jobUrl ?? null, discovered.jobUrl)
    );
    if (urlMatch) {
      return {
        tier: "job_url",
        applicationId: urlMatch.id,
        autoLink: true,
        confidence: 0.95,
      };
    }
  }

  const discoveredCompany = canonicalCompany(discovered.company);
  if (!discoveredCompany) {
    return { tier: "none", applicationId: null, autoLink: false, confidence: 0 };
  }

  const sameCompany = candidates.filter(
    (candidate) => canonicalCompany(candidate.company) === discoveredCompany
  );

  if (sameCompany.length === 0) {
    return { tier: "none", applicationId: null, autoLink: false, confidence: 0 };
  }

  // Tier 3: company + title, within the date window.
  const discoveredTitle = canonicalTitle(discovered.jobTitle);
  if (discoveredTitle) {
    const titleMatch = sameCompany.find((candidate) => {
      const candidateTitle = canonicalTitle(candidate.role);
      if (!candidateTitle) return false;
      if (candidateTitle !== discoveredTitle) return false;

      // An undated email still matches on company+title; a dated one must fall
      // inside the window.
      const distance = dayDistance(candidate.appliedDate, discovered.emailDate);
      return !Number.isFinite(distance) || distance <= MATCH_WINDOW_DAYS;
    });

    if (titleMatch) {
      return {
        tier: "company_title",
        applicationId: titleMatch.id,
        autoLink: true,
        confidence: 0.9,
      };
    }
  }

  // Tier 4: company only — plausible but ambiguous. Requires confirmation.
  const nearest = [...sameCompany].sort(
    (a, b) =>
      dayDistance(a.appliedDate, discovered.emailDate) -
      dayDistance(b.appliedDate, discovered.emailDate)
  )[0];

  return {
    tier: "company_only",
    applicationId: nearest.id,
    autoLink: false,
    confidence: 0.5,
  };
}

/**
 * Dedup key for grouping messages into one proposed application.
 *
 * Thread id is preferred: every message in a thread belongs to the same
 * application. Otherwise fall back to canonical company + title so separate
 * confirmation and rejection emails collapse into a single proposal.
 */
export function proposalKey(discovered: DiscoveredApplication): string {
  if (discovered.gmailThreadId) return `thread:${discovered.gmailThreadId}`;

  const company = canonicalCompany(discovered.company) ?? "unknown";
  const title = canonicalTitle(discovered.jobTitle) ?? "unknown";
  return `ct:${company}|${title}`;
}

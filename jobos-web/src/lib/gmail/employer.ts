/**
 * Deterministic EMPLOYER extraction from message content.
 *
 * THE DEFECT THIS CLOSES — the cause of "285 application-related, 84 unknown
 * employer, 0 applications created".
 *
 * Until now the employer was only ever derived from the SENDER DOMAIN, via
 * `companyFromDomain`. That function deliberately returns null for any ATS or
 * job-board domain, because a portal is not an employer — which is correct, and is
 * not the bug. The bug is that it was the ONLY source. Real application
 * confirmations are almost always relayed BY a portal:
 *
 *   from: jobs-noreply@linkedin.com
 *   subject: Your application was sent to Acme Corp
 *
 * so `companyFromDomain("linkedin.com")` returns null, `decideProposal` reaches
 * its step-4 `employer === null` branch, and returns `hold_unknown_employer`. The
 * evidence was strong, the lifecycle category was right, the row was read — and it
 * still could not become an application, for every portal-relayed confirmation the
 * user had. That is the whole of the 84, and the reason `created` was 0.
 *
 * The employer name is right there in the text. This module reads it, from the
 * subject and body, using the fixed phrasings portals and ATS systems actually
 * use. Nothing is invented: a pattern either matches and yields a captured name,
 * or it does not and the result is null. There is no guessing, no model, and no
 * fallback to the portal's own name — `sanitizeCompanyName` still has the final
 * say, so "LinkedIn" can never be returned as an employer.
 *
 * Pure: no network, no AI, no database, no clock.
 */

import { sanitizeCompanyName } from "./heuristics.ts";
import type { ParsedEmail } from "./parse.ts";

/**
 * Longest employer name we will accept.
 *
 * Real company names are short. A long capture almost always means the pattern
 * ran past the name into the rest of the sentence, so it is rejected rather than
 * stored — a wrong employer is worse than an unresolved one.
 */
const MAX_EMPLOYER_LENGTH = 60;

/** Shortest plausible name, so a stray initial is not treated as an employer. */
const MIN_EMPLOYER_LENGTH = 2;

/**
 * Words that mean the capture ran into sentence structure rather than a name.
 *
 * Checked as whole leading/trailing words. "Acme Corp has received" would be
 * trimmed to "Acme Corp"; a capture that is ONLY such a word is rejected.
 */
const STOP_WORDS: readonly string[] = [
  "the",
  "a",
  "an",
  "this",
  "that",
  "your",
  "our",
  "their",
  "us",
  "them",
  "it",
  "job",
  "jobs",
  "role",
  "roles",
  "position",
  "positions",
  "opening",
  "openings",
  "company",
  "team",
  "recruiter",
  "recruiting",
  "talent",
  "careers",
  "career",
  "hiring",
  "application",
  "applications",
];

/**
 * Employer-capturing patterns, in descending order of reliability.
 *
 * Every one anchors on lifecycle phrasing that only appears once an application
 * exists, so a job ALERT ("apply now at Acme") cannot reach this module in the
 * first place — the Evidence Gate rejects those long before employer resolution.
 *
 * The capture is deliberately conservative: it stops at sentence punctuation, at
 * a line break, or at a connective like "for" / "regarding", so it grabs the name
 * and not the remainder of the clause.
 */
const EMPLOYER_PATTERNS: readonly RegExp[] = [
  // Portal relay, the highest-volume real case.
  /\byour application (?:was|has been) (?:successfully )?sent to\s+([^\n.!?;,]{2,80})/i,
  /\byour application (?:was|has been) submitted to\s+([^\n.!?;,]{2,80})/i,
  // Direct confirmations.
  /\bthank(?:s| you) for (?:your interest in|applying to|applying at)\s+([^\n.!?;,]{2,80})/i,
  /\byou (?:have )?applied (?:to|for a position at|at)\s+([^\n.!?;,]{2,80})/i,
  /\byour application (?:to|with|at)\s+([^\n.!?;,]{2,80})/i,
  // "<Employer> has received your application"
  /^([^\n.!?;,]{2,80}?)\s+has received your application/im,
  // "We have received your application for X at <Employer>"
  /\breceived your application[^\n]{0,60}?\bat\s+([^\n.!?;,]{2,80})/i,
  // "Application for Backend Engineer at <Employer>"
  /\bapplication for\b[^\n]{0,60}?\bat\s+([^\n.!?;,]{2,80})/i,
  // Interview / offer stages naming the employer. The optional noun must not be
  // allowed to consume the connective, or "invitation with Acme" captures
  // "with Acme".
  /\binterview\s+(?:invitation|invite)?\s*(?:with|at|from)\s+([^\n.!?;,]{2,80})/i,
  /\boffer (?:of employment )?(?:from|at)\s+([^\n.!?;,]{2,80})/i,
  // Rejections frequently name the employer explicitly.
  /\byour (?:candidacy|application) (?:at|with)\s+([^\n.!?;,]{2,80})/i,
];

/**
 * Trailing clauses that belong to the sentence, not the employer name.
 *
 * Portal subjects run the name straight into a connective, e.g.
 * "sent to Acme Corp for Backend Engineer". Cutting at these keeps "Acme Corp".
 */
const TRAILING_CLAUSES: readonly RegExp[] = [
  /\s+\bfor\b.*$/i,
  /\s+\bregarding\b.*$/i,
  /\s+\bvia\b.*$/i,
  /\s+\bthrough\b.*$/i,
  /\s+\bon\b\s+\w+day.*$/i,
  /\s+\bhas\b.*$/i,
  /\s+\bhave\b.*$/i,
  /\s+\bis\b.*$/i,
  /\s+\bwas\b.*$/i,
  /\s+\bwe\b.*$/i,
  /\s+[-–—|(].*$/,
];

/**
 * Reduce a raw capture to a storable employer name, or null.
 *
 * Every rejection here is a deliberate choice to store nothing rather than
 * something wrong.
 */
export function normalizeEmployerName(raw: string): string | null {
  let name = raw.trim();

  for (const clause of TRAILING_CLAUSES) name = name.replace(clause, "").trim();

  // Common wrappers and trailing punctuation left by the cut.
  name = name
    .replace(/^["'“”‘’(<\[]+/, "")
    .replace(/["'“”‘’)>\]]+$/, "")
    .replace(/[\s.,;:!-]+$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  // Drop a leading/trailing stop word rather than the whole capture.
  const words = name.split(/\s+/).filter(Boolean);
  while (words.length > 1 && STOP_WORDS.includes(words[0].toLowerCase())) {
    words.shift();
  }
  while (
    words.length > 1 &&
    STOP_WORDS.includes(words[words.length - 1].toLowerCase())
  ) {
    words.pop();
  }
  name = words.join(" ");

  if (name.length < MIN_EMPLOYER_LENGTH) return null;
  if (name.length > MAX_EMPLOYER_LENGTH) return null;
  // A capture that is nothing but a stop word is sentence structure, not a name.
  if (STOP_WORDS.includes(name.toLowerCase())) return null;
  // Must contain a letter: a number or symbol run is not an employer.
  if (!/[A-Za-z]/.test(name)) return null;
  // An email address or URL is routing information, not an employer.
  if (/[@]/.test(name) || /https?:\/\//i.test(name)) return null;

  return name;
}

/**
 * The employer this message names, or null when it names none.
 *
 * Subject first: a portal puts the employer in the subject and the body then
 * repeats it inside boilerplate, so the subject capture is the cleaner one.
 *
 * `sanitizeCompanyName` is applied last and is the final authority, so a capture
 * that resolves to the sending platform itself — "LinkedIn", "Naukri",
 * "Greenhouse" — is rejected exactly as it would be anywhere else in the
 * pipeline. That is what keeps "do not invent an employer" true even though this
 * module reads free text.
 */
export function employerFromContent(
  email: Pick<ParsedEmail, "subject" | "snippet" | "bodyText" | "senderRootDomain">
): string | null {
  const surfaces = [email.subject, email.snippet, email.bodyText];

  for (const surface of surfaces) {
    if (!surface || surface.trim() === "") continue;

    for (const pattern of EMPLOYER_PATTERNS) {
      const match = surface.match(pattern);
      if (!match?.[1]) continue;

      const normalized = normalizeEmployerName(match[1]);
      if (normalized === null) continue;

      // The portal/platform guard, unchanged and final.
      const sanitized = sanitizeCompanyName(normalized, email.senderRootDomain);
      if (sanitized !== null) return sanitized;
    }
  }

  return null;
}

/**
 * The employer to store for a message: read from content, else from the sender.
 *
 * Content wins because it names the actual employer, while the sender domain only
 * names whoever relayed the mail. The domain remains the fallback for direct
 * employer mail (`careers@acme.com`), where there may be no naming phrase at all.
 *
 * `domainEmployer` is injected rather than imported so this stays a pure
 * composition of two decisions that are each already tested on their own.
 */
export function resolveEmployer(
  email: Pick<ParsedEmail, "subject" | "snippet" | "bodyText" | "senderRootDomain">,
  domainEmployer: string | null
): string | null {
  return employerFromContent(email) ?? domainEmployer;
}

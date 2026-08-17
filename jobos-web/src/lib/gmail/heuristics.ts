/**
 * Pre-AI verdict for one parsed Gmail message, plus the company/portal naming
 * primitives that the rest of the pipeline depends on.
 *
 * Pure functions: no network, no AI, no database.
 *
 * This module no longer owns any classification patterns. The Evidence Gate
 * (`applicationEvidence.ts`) is the single authority on whether a message
 * evidences a stage of an application THIS USER actually made, and
 * `evaluateEmail` is now a thin, total mapping from a gate verdict onto the
 * legacy `HeuristicVerdict` shape.
 *
 * What was deleted, and why:
 *
 *  - The `weakSignal` keyword regex
 *    (`/\b(application|applied|candidate|candidacy|position|role|hiring|recruit)/i`).
 *    Those words appear in essentially every job-board notification, so the
 *    regex escalated job alerts, feed notifications, course promotions and loan
 *    mail alike. A bare listed keyword now escalates nothing.
 *  - The bare `fromAts` escalation. A sender domain is a routing fact about who
 *    relayed the mail, never evidence. An ATS sender with no candidate-facing
 *    language now resolves to "not job related" instead of costing a model call.
 *
 * `looksLikeBulkMail` and `detectCategory` remain exported with the same
 * signatures, re-implemented as delegations to the gate's exclusion and
 * lifecycle stages so that each pattern set exists in exactly one place.
 */

import {
  detectLifecycleEvidence,
  evaluateApplicationEvidence,
  findHardExclusion,
  type EvidenceVerdict,
} from "./applicationEvidence.ts";
import { ATS_DOMAINS } from "./query.ts";
import type { ParsedEmail } from "./parse.ts";

/** The classification vocabulary, shared with the AI schema. */
export const EMAIL_CATEGORIES = [
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
  // A job the user MIGHT apply to (alert, recommendation), NOT an application.
  // Deliberately absent from LIFECYCLE_CATEGORIES, so it can never create,
  // update, or count toward an application.
  "JOB_OPPORTUNITY",
  "OTHER_JOB_RELATED",
  "NOT_JOB_RELATED",
] as const;

export type EmailCategory = (typeof EMAIL_CATEGORIES)[number];

const ATS_DOMAIN_SET: ReadonlySet<string> = new Set(ATS_DOMAINS);

export interface HeuristicVerdict {
  /** Worth any further processing at all. */
  candidate: boolean;
  /** Set only when a pattern matched decisively; null means "ask the model". */
  category: EmailCategory | null;
  /** True when the category could not be decided deterministically. */
  needsAI: boolean;
  /** Deterministic confidence for a resolved category. */
  confidence: number;
  /** Short, non-content reason code. Safe to log. */
  reason: string;
}

/** True when the sender is a known ATS/job-board domain. */
export function isAtsDomain(rootDomainValue: string | null): boolean {
  if (!rootDomainValue) return false;
  return ATS_DOMAIN_SET.has(rootDomainValue);
}

/**
 * Bulk / marketing / non-application mail detection.
 *
 * Delegates to the gate's hard-exclusion stage, which covers job alerts and
 * digests, social-network notifications, financial applications, marketing and
 * course mail, "posted a job" announcements, and the `CATEGORY_PROMOTIONS` /
 * `SPAM` / `TRASH` labels — matched against subject + snippet only, never body
 * footers, so an unsubscribe link under a real interview invitation cannot
 * reject it.
 */
export function looksLikeBulkMail(email: ParsedEmail): boolean {
  return findHardExclusion(email) !== null;
}

/**
 * Strongest deterministic lifecycle category for a message, or null.
 *
 * Delegates to the gate's lifecycle stage: ordered furthest-along-first so an
 * email mentioning both an offer and an earlier confirmation resolves to
 * `OFFER`, with confidence 0.95 for a subject hit and 0.8 for a body-only hit.
 *
 * Note this reports the category in isolation, exactly as it always did — it
 * does not apply hard exclusions. `evaluateEmail` is the function that orders
 * the two stages correctly.
 */
export function detectCategory(email: ParsedEmail): {
  category: EmailCategory;
  confidence: number;
} | null {
  const lifecycle = detectLifecycleEvidence(email);
  if (lifecycle === null) return null;
  return { category: lifecycle.category, confidence: lifecycle.confidence };
}

/**
 * Decide what to do with one message before any AI spend.
 *
 * A total mapping over the gate verdict — no independent sender-domain rule and
 * no independent keyword rule survives here:
 *
 * | gate strength | gate reason                          | candidate | category      | needsAI | confidence | reason                |
 * | ------------- | ------------------------------------ | --------- | ------------- | ------- | ---------- | --------------------- |
 * | `none`        | any `excluded_*`                     | false     | NOT_JOB_RELATED | false | 0.9        | bulk_or_marketing     |
 * | `none`        | keyword_only / no_application_evidence | false   | NOT_JOB_RELATED | false | 0.6        | no_job_signal         |
 * | `strong`      | lifecycle_subject_match / _body_match | true     | gate category | false   | gate       | pattern_match         |
 * | `weak`        | ats_sender_with_candidate_language   | true      | null          | true    | 0          | ats_sender_ambiguous  |
 * | `weak`        | application_url_*                    | true      | null          | true    | 0          | job_url               |
 */
function mapEvidenceToVerdict(evidence: EvidenceVerdict): HeuristicVerdict {
  switch (evidence.strength) {
    case "strong":
      return {
        candidate: true,
        category: evidence.category,
        needsAI: false,
        confidence: evidence.confidence,
        reason: "pattern_match",
      };

    case "weak":
      return {
        candidate: true,
        category: null,
        needsAI: true,
        confidence: evidence.confidence,
        reason:
          evidence.reason === "ats_sender_with_candidate_language"
            ? "ats_sender_ambiguous"
            : "job_url",
      };

    case "none":
      return {
        candidate: false,
        category: "NOT_JOB_RELATED",
        needsAI: false,
        confidence: evidence.confidence,
        reason: evidence.reason.startsWith("excluded_")
          ? "bulk_or_marketing"
          : "no_job_signal",
      };
  }
}

export function evaluateEmail(email: ParsedEmail): HeuristicVerdict {
  return mapEvidenceToVerdict(evaluateApplicationEvidence(email));
}

/**
 * The gate verdict AND its `HeuristicVerdict` mapping, from ONE gate evaluation.
 *
 * `HeuristicVerdict` deliberately carries neither `strength` nor the gate's
 * reason code — it is the legacy pre-AI decision shape, and widening it would
 * change a contract several callers and tests depend on. But the ledger has to
 * store the gate's verdict verbatim (`evidence_strength` / `evidence_reason`),
 * so the pipeline needs both halves for the same message.
 *
 * This is that single entry point: the gate runs once, and the caller gets the
 * decision it acts on plus the verdict it must persist. The alternative —
 * calling `evaluateEmail` and then `evaluateApplicationEvidence` — would run
 * every exclusion, lifecycle and candidate-language pattern twice per message.
 */
export function evaluateEmailWithEvidence(email: ParsedEmail): {
  evidence: EvidenceVerdict;
  verdict: HeuristicVerdict;
} {
  const evidence = evaluateApplicationEvidence(email);
  return { evidence, verdict: mapEvidenceToVerdict(evidence) };
}

/**
 * Company name inferred from the sender domain, when it is trustworthy.
 *
 * Returns null for ATS/job-board and freemail domains: `greenhouse.io` and
 * `naukri.com` are the vendor/portal, not the employer, and `gmail.com` says
 * nothing at all. This is the exact guard that prevents a job portal's own
 * name from ever being stored as the company — the bug this function exists
 * to close depends entirely on `isAtsDomain` covering every portal a user's
 * mailbox actually sees, which is why ATS_DOMAINS was audited and extended.
 */
export function companyFromDomain(
  rootDomainValue: string | null
): string | null {
  if (!rootDomainValue) return null;
  if (isAtsDomain(rootDomainValue)) return null;

  const freemail = new Set([
    "gmail.com", "googlemail.com", "outlook.com", "hotmail.com",
    "yahoo.com", "icloud.com", "proton.me", "protonmail.com", "aol.com",
  ]);
  if (freemail.has(rootDomainValue)) return null;

  const label = rootDomainValue.split(".")[0];
  if (!label || label.length < 2) return null;

  // Title-case the domain label as a readable default, e.g. stripe -> Stripe.
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Friendly display name for a known ATS/job-board domain.
 *
 * This is the counterpart to `companyFromDomain`: that function refuses to
 * treat these domains as an employer, this one supplies the correct label for
 * the SEPARATE `job_portal` field so the platform is still shown — just never
 * where the company belongs.
 */
const PORTAL_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  "linkedin.com": "LinkedIn",
  "indeed.com": "Indeed",
  "naukri.com": "Naukri",
  "foundit.in": "Foundit",
  "shine.com": "Shine",
  "instahyre.com": "Instahyre",
  "glassdoor.com": "Glassdoor",
  "wellfound.com": "Wellfound",
  "angel.co": "Wellfound",
  "ziprecruiter.com": "ZipRecruiter",
  "monster.com": "Monster",
  "dice.com": "Dice",
  "simplyhired.com": "SimplyHired",
  "greenhouse.io": "Greenhouse",
  "lever.co": "Lever",
  "myworkday.com": "Workday",
  "ashbyhq.com": "Ashby",
  "smartrecruiters.com": "SmartRecruiters",
  "icims.com": "iCIMS",
  "taleo.net": "Taleo",
  "successfactors.com": "SuccessFactors",
  "workable.com": "Workable",
  "jobvite.com": "Jobvite",
  "bamboohr.com": "BambooHR",
};

/** The known-portal display names, for detecting a stale portal-as-company value. */
export const PORTAL_DISPLAY_NAME_SET: ReadonlySet<string> = new Set(
  Object.values(PORTAL_DISPLAY_NAMES).map((name) => name.toLowerCase())
);

/**
 * The job portal / ATS name for a sender domain, or null when the sender looks
 * like the employer's own mail (a direct application, not a third-party portal).
 */
export function portalNameFromDomain(
  rootDomainValue: string | null
): string | null {
  if (!rootDomainValue) return null;
  return PORTAL_DISPLAY_NAMES[rootDomainValue] ?? null;
}

/** True when `value` is literally one of the known portal display names. */
export function isPortalDisplayName(value: string | null): boolean {
  if (!value) return false;
  return PORTAL_DISPLAY_NAME_SET.has(value.trim().toLowerCase());
}

/**
 * Final guard applied to ANY company value before it is stored, regardless of
 * whether it came from a deterministic rule or from the AI classifier.
 *
 * `companyFromDomain` already refuses to name a portal as the employer, but
 * the AI extraction path has no equivalent protection: a weaker fallback
 * provider can ignore the system prompt and echo the platform name (e.g.
 * return "LinkedIn" as company for a LinkedIn-relayed application email) even
 * though the prompt explicitly instructs it not to. This function is the
 * deterministic backstop — it runs on every candidate company string,
 * independent of source, and rejects it if it resolves to a known portal.
 */
export function sanitizeCompanyName(
  candidate: string | null,
  senderRootDomain: string | null = null
): string | null {
  if (!candidate) return null;
  const trimmed = candidate.trim();
  if (trimmed === "") return null;

  if (isPortalDisplayName(trimmed)) return null;

  // Guards "Naukri.com" / "Naukri Careers" style variants that are not an
  // exact display-name match but still clearly name the sending platform.
  if (senderRootDomain) {
    const portalName = portalNameFromDomain(senderRootDomain);
    if (portalName && trimmed.toLowerCase().includes(portalName.toLowerCase())) {
      return null;
    }
  }

  return trimmed;
}

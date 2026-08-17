/**
 * Turn raw Gmail activity rows into reviewable application proposals.
 *
 * Pure: callers supply rows and candidate applications already read under RLS,
 * so this module never queries and never sees another user's data.
 *
 * Grouping is what makes the review screen usable — a confirmation, two
 * interview emails, and a rejection collapse into ONE proposal with a timeline,
 * not four rows.
 */

import { matchApplication, proposalKey, type ApplicationCandidate } from "./matching.ts";
import { isGhosted, resolveStatus, type ApplicationStatusValue } from "./statusInference.ts";
import { portalNameFromDomain, sanitizeCompanyName } from "./heuristics.ts";
import { LIFECYCLE_CATEGORIES, type EvidenceStrength } from "./applicationEvidence.ts";
import type { EmailCategory } from "./heuristics.ts";

/**
 * The two strengths the ledger stores. The gate's third verdict, `none`, is
 * stored as NULL, which every pre-Sprint-9 row also carries.
 */
export type ProposalEvidenceStrength = Exclude<EvidenceStrength, "none">;

/** Shape of a gmail_activity row as read from the database. */
export interface ActivityRowLike {
  id: string;
  gmail_message_id: string;
  gmail_thread_id: string | null;
  application_id: string | null;
  category: EmailCategory;
  company: string | null;
  job_title: string | null;
  job_url: string | null;
  location: string | null;
  email_date: string | null;
  sender: string | null;
  /** Already stored as the ROOT domain by the sync pipeline, e.g. "linkedin.com". */
  sender_domain: string | null;
  confidence: number | null;
  /**
   * Gate strength stored with the row. Absent or NULL on rows written before
   * Sprint 9, and absent on rows a caller assembled without it; both read as
   * NOT strong, so a legacy queue row is never auto-imported retroactively.
   */
  evidence_strength?: ProposalEvidenceStrength | null;
}

export interface ProposalEvidence {
  activityId: string;
  gmailMessageId: string;
  category: EmailCategory;
  emailDate: string | null;
  sender: string | null;
}

export interface ApplicationProposal {
  key: string;
  /** Every activity row backing this proposal. */
  activityIds: string[];
  /**
   * The EMPLOYER. Null when no trustworthy employer name could be determined —
   * deliberately null rather than falling back to the portal/platform name.
   */
  company: string | null;
  jobTitle: string | null;
  /**
   * Where the application came from (LinkedIn, Naukri, Greenhouse, ...).
   * A separate concept from `company`; null for direct employer mail.
   */
  jobPortal: string | null;
  jobUrl: string | null;
  location: string | null;
  /** Earliest evidence date — the best available proxy for when they applied. */
  appliedDate: string | null;
  /** Most recent evidence of any kind. */
  lastActivityAt: string | null;
  /** Status implied by the evidence, ordered by email_date. */
  status: ApplicationStatusValue;
  /** True when the status came from real evidence rather than the default. */
  statusFromEvidence: boolean;
  /** Lowest confidence across contributing evidence. */
  confidence: number | null;
  evidence: ProposalEvidence[];
  /** Suggested existing application, when one plausibly matches. */
  suggestedApplicationId: string | null;
  matchTier: string;
  /** True only for high-confidence matches; weak ones need confirmation. */
  autoLink: boolean;
  /**
   * Strongest stored strength among contributing rows: `"strong"` when any row
   * carries it, otherwise `"weak"` when any does, otherwise null.
   */
  evidenceStrength: ProposalEvidenceStrength | null;
  /**
   * The auto-create precondition: at least one contributing row carries BOTH
   * `evidence_strength = "strong"` and a Lifecycle_Category.
   *
   * A NULL stored strength counts as not strong. That is deliberately
   * conservative — pre-Sprint-9 rows keep requiring review instead of becoming
   * retroactively auto-importable.
   */
  hasStrongEvidence: boolean;
  /** True when at least one contributing row carries a Lifecycle_Category. */
  isLifecycleEvent: boolean;
}

/** Pick the most frequent non-null value, preferring longer strings on ties. */
function consensus(values: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  if (counts.size === 0) return null;

  return [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || b[0].length - a[0].length
  )[0][0];
}

function earliest(dates: (string | null)[]): string | null {
  const times = dates
    .map((date) => (date ? Date.parse(date) : Number.NaN))
    .filter((time) => Number.isFinite(time));
  return times.length === 0 ? null : new Date(Math.min(...times)).toISOString();
}

function latest(dates: (string | null)[]): string | null {
  const times = dates
    .map((date) => (date ? Date.parse(date) : Number.NaN))
    .filter((time) => Number.isFinite(time));
  return times.length === 0 ? null : new Date(Math.max(...times)).toISOString();
}

/** Categories that prove the employer engaged, so ghosting cannot apply. */
const OUTCOME_CATEGORIES: ReadonlySet<EmailCategory> = new Set([
  "INTERVIEW_INVITATION",
  "INTERVIEW_UPDATE",
  "OFFER",
  "REJECTION",
]);

/**
 * Build proposals from unlinked activity.
 *
 * @param rows unlinked, job-related activity for ONE user
 * @param candidates that user's existing applications
 * @param threadLinks thread id -> already-linked application id
 */
export function buildProposals(
  rows: ActivityRowLike[],
  candidates: ApplicationCandidate[],
  threadLinks: Map<string, string> = new Map(),
  now: number = Date.now()
): ApplicationProposal[] {
  const groups = new Map<string, ActivityRowLike[]>();

  for (const row of rows) {
    if (row.category === "NOT_JOB_RELATED") continue;

    const key = proposalKey({
      company: row.company,
      jobTitle: row.job_title,
      jobUrl: row.job_url,
      emailDate: row.email_date,
      gmailThreadId: row.gmail_thread_id,
    });

    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  const proposals: ApplicationProposal[] = [];

  for (const [key, group] of groups) {
    const senderDomain = consensus(group.map((row) => row.sender_domain));

    // The portal is derived from the sending domain, entirely separately from
    // the employer name. Null when the sender is not a known platform, which
    // means the mail came from the employer directly.
    const jobPortal = portalNameFromDomain(senderDomain);

    // Company is sanitized here as well as at write time. Re-checking on read
    // deterministically repairs rows already stored by an earlier build that
    // let a platform name through as the employer (e.g. company="LinkedIn"),
    // so those do not need a re-scan to be corrected. Resolves to null rather
    // than to the portal name when no real employer is known.
    const company = sanitizeCompanyName(
      consensus(group.map((row) => row.company)),
      senderDomain
    );

    const jobTitle = consensus(group.map((row) => row.job_title));
    const jobUrl = consensus(group.map((row) => row.job_url));
    const location = consensus(group.map((row) => row.location));

    const appliedDate = earliest(group.map((row) => row.email_date));
    const lastActivityAt = latest(group.map((row) => row.email_date));

    const resolved = resolveStatus(
      group.map((row) => ({ category: row.category, emailDate: row.email_date }))
    );

    const hasOutcomeEvidence = group.some((row) =>
      OUTCOME_CATEGORIES.has(row.category)
    );

    // Default to Applied: the evidence is job-related, so the user applied at
    // some point even when no single email states a status.
    let status: ApplicationStatusValue = resolved ?? "Applied";

    // Ghosted is DERIVED here, never taken from a category or the model.
    if (
      isGhosted(
        { status, lastActivityAt, hasOutcomeEvidence },
        now
      )
    ) {
      status = "Ghosted";
    }

    const threadId = group.find((row) => row.gmail_thread_id)?.gmail_thread_id ?? null;
    const threadApplicationId = threadId ? threadLinks.get(threadId) ?? null : null;

    const match = matchApplication(
      { company, jobTitle, jobUrl, emailDate: appliedDate, gmailThreadId: threadId },
      candidates,
      threadApplicationId
    );

    const confidences = group
      .map((row) => row.confidence)
      .filter((value): value is number => typeof value === "number");

    // Evidence strength is carried through, never re-derived from text: the
    // gate already decided, and the ledger already recorded that decision.
    const isLifecycleEvent = group.some((row) =>
      LIFECYCLE_CATEGORIES.has(row.category)
    );
    const hasStrongEvidence = group.some(
      (row) =>
        row.evidence_strength === "strong" && LIFECYCLE_CATEGORIES.has(row.category)
    );
    const evidenceStrength: ProposalEvidenceStrength | null = group.some(
      (row) => row.evidence_strength === "strong"
    )
      ? "strong"
      : group.some((row) => row.evidence_strength === "weak")
        ? "weak"
        : null;

    proposals.push({
      key,
      activityIds: group.map((row) => row.id),
      company,
      jobTitle,
      jobPortal,
      jobUrl,
      location,
      appliedDate,
      lastActivityAt,
      status,
      statusFromEvidence: resolved !== null,
      confidence: confidences.length > 0 ? Math.min(...confidences) : null,
      evidence: group
        .map((row) => ({
          activityId: row.id,
          gmailMessageId: row.gmail_message_id,
          category: row.category,
          emailDate: row.email_date,
          sender: row.sender,
        }))
        .sort((a, b) => {
          const left = a.emailDate ? Date.parse(a.emailDate) : 0;
          const right = b.emailDate ? Date.parse(b.emailDate) : 0;
          return left - right;
        }),
      suggestedApplicationId: match.applicationId,
      matchTier: match.tier,
      autoLink: match.autoLink,
      evidenceStrength,
      hasStrongEvidence,
      isLifecycleEvent,
    });
  }

  // Most recent activity first — the most relevant to review.
  return proposals.sort((a, b) => {
    const left = a.lastActivityAt ? Date.parse(a.lastActivityAt) : 0;
    const right = b.lastActivityAt ? Date.parse(b.lastActivityAt) : 0;
    return right - left;
  });
}

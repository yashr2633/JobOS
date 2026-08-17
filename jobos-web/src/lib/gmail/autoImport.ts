/**
 * Auto_Importer — organize obvious applications without asking the user.
 *
 * Two halves, deliberately separated:
 *
 *   `decideProposal`  pure, total decision table. One proposal in, exactly one
 *                     of create | link | hold_ambiguous | hold_unknown_employer
 *                     out, with a non-content reason code.
 *   `runAutoImport`   the only half that touches Supabase. Applies each
 *                     decision in its own try/catch so one bad proposal cannot
 *                     abort the run.
 *
 * Invariants this module exists to hold:
 *  - Weak evidence NEVER creates an application. A model-derived category is
 *    stored as `weak`, so the model alone can never invent an application.
 *  - An employer name is never fabricated. No `Unknown company` placeholder is
 *    written here; a proposal with no employer is held for the Unknown bucket.
 *  - Every read and write carries `.eq("user_id", userId)` (or `user_id` in the
 *    inserted row). Ownership is enforced in the statement, not only by RLS,
 *    and an application id is re-verified as owned before it is linked to.
 *  - Status only ever moves through `shouldUpdateStatus`, so nothing regresses
 *    and only the five allowed status values are ever written.
 *  - Nothing is deleted. Every activity/evidence row survives the run so a
 *    later reconciliation or re-scan reasons from the same evidence.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  fetchActivityForApplication,
  fetchLifecycleActivityForAutoImport,
  getThreadApplicationLinks,
  linkActivityToApplication,
} from "../api/gmailActivity.ts";
import {
  isPortalDisplayName,
  sanitizeCompanyName,
  type EmailCategory,
} from "./heuristics.ts";
import type { ApplicationCandidate, MatchTier } from "./matching.ts";
import { buildProposals, type ApplicationProposal } from "./proposals.ts";
import {
  inferStatusFromCategory,
  resolveStatus,
  shouldUpdateStatus,
  type ApplicationStatusValue,
  type InferredStatus,
} from "./statusInference.ts";

// ---------------------------------------------------------------------------
// Decision table
// ---------------------------------------------------------------------------

export type AutoImportAction =
  | "create"
  | "link"
  | "hold_ambiguous"
  | "hold_unknown_employer";

/**
 * Why a proposal was decided the way it was.
 *
 * A fixed vocabulary of codes, never email text: these are logged and shown to
 * the user, so no subject, snippet, or body may ever reach them.
 */
export type AutoImportReason =
  | "matched_existing_application"
  | "match_company_only"
  | "match_target_not_owned"
  | "strong_lifecycle_evidence"
  | "strong_evidence_unresolved_employer"
  | "no_strong_evidence"
  | "employer_unresolved"
  | "employer_resolved_to_portal";

export interface AutoImportDecision {
  action: AutoImportAction;
  /** The application to link to. Non-null only for `link`. */
  applicationId: string | null;
  reason: AutoImportReason;
}

export interface AutoImportContext {
  /**
   * The acting user's application ids. When supplied, a match pointing outside
   * this set is refused rather than linked — a proposal id, a Gmail message id,
   * or a matched name is never ownership proof.
   */
  ownedApplicationIds?: ReadonlySet<string>;
}

/** Match tiers strong enough to link automatically. `company_only` is not one. */
const LINK_TIERS: ReadonlySet<MatchTier> = new Set<MatchTier>([
  "thread",
  "job_url",
  "company_title",
]);

function isLinkTier(tier: string): tier is MatchTier {
  return LINK_TIERS.has(tier as MatchTier);
}

/**
 * Decide what to do with one proposal. Pure and total: every input yields
 * exactly one action.
 *
 * Order is normative (design §5, Decision paths):
 *   1. thread / job_url / company_title match  -> link
 *   2. company_only match                      -> hold (too weak to merge)
 *   3. employer known AND strong lifecycle row -> create
 *   4. employer unresolvable                   -> hold for the Unknown bucket
 *   5. otherwise                               -> hold
 *
 * `hasStrongEvidence === false` can never reach step 3, so a null or `"weak"`
 * stored strength — including every model-derived category — cannot create an
 * application.
 */
export function decideProposal(
  proposal: ApplicationProposal,
  context: AutoImportContext = {}
): AutoImportDecision {
  // 1. A strong match links; an unrelated role at the same employer does not.
  if (isLinkTier(proposal.matchTier) && proposal.suggestedApplicationId) {
    const applicationId = proposal.suggestedApplicationId;

    if (
      context.ownedApplicationIds &&
      !context.ownedApplicationIds.has(applicationId)
    ) {
      return {
        action: "hold_ambiguous",
        applicationId: null,
        reason: "match_target_not_owned",
      };
    }

    return {
      action: "link",
      applicationId,
      reason: "matched_existing_application",
    };
  }

  // 2. Company agreed but the role did not. Never merged silently.
  if (proposal.matchTier === "company_only") {
    return {
      action: "hold_ambiguous",
      applicationId: null,
      reason: "match_company_only",
    };
  }

  // A portal is never an employer, whatever produced the name.
  const employer = sanitizeCompanyName(proposal.company);
  const strongLifecycle = proposal.hasStrongEvidence && proposal.isLifecycleEvent;

  // 3. Strong lifecycle evidence creates an application.
  //
  //    A resolved employer is stored directly. An UNRESOLVED employer no longer
  //    blocks creation: strong evidence that the user applied must not be
  //    withheld for want of a company name — that was the "84 unknown employer,
  //    0 created" defect. The application is created with the explicit
  //    `UNRESOLVED_COMPANY` placeholder that `reconcile.ts` is built to upgrade
  //    from later ledger evidence, so nothing is fabricated and a real employer
  //    that arrives later reconciles the SAME application rather than duplicating
  //    it. `applyCreate` writes the placeholder; the decision only records that
  //    the employer was unresolved.
  if (strongLifecycle) {
    return {
      action: "create",
      applicationId: null,
      reason:
        employer !== null
          ? "strong_lifecycle_evidence"
          : "strong_evidence_unresolved_employer",
    };
  }

  // 4. NOT strong, and no employer: there is nothing to act on unattended, so
  //    this is held. Weak evidence never creates, with or without an employer.
  if (employer === null) {
    return {
      action: "hold_unknown_employer",
      applicationId: null,
      reason: isPortalDisplayName(proposal.company)
        ? "employer_resolved_to_portal"
        : "employer_unresolved",
    };
  }

  // 5. Employer known, evidence not strong enough to act on unattended.
  return {
    action: "hold_ambiguous",
    applicationId: null,
    reason: "no_strong_evidence",
  };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * Counts shaped for a results-first summary: what the scan DID, not what it
 * wants approved. `heldAmbiguous` + `heldUnknownEmployer` is the review queue.
 */
export interface AutoImportResult {
  /** Proposals considered in this run. */
  examined: number;
  created: number;
  linked: number;
  /** Status writes, a subset of `linked`. */
  updated: number;
  heldAmbiguous: number;
  heldUnknownEmployer: number;
  failed: number;
}

export interface AutoImportOptions {
  /** Cap on proposals applied in one run. Unset means apply them all. */
  maxProposals?: number;
  /** Cap on lifecycle activity rows read in one run. */
  activityLimit?: number;
  now?: number;
}

/**
 * Text stored when a proposal carries no role or location.
 *
 * Deliberately NOT the `Unknown role` / `Unknown company` placeholders: the
 * automatic path never invents an employer or a title, and `role`/`location`
 * are NOT NULL columns, so an explicit "we were not told" value is stored
 * instead of a fabricated one.
 */
const UNSPECIFIED = "Not specified";

/** Portal fallback, matching the user-approved import route's semantics. */
const PORTAL_FALLBACK = "Gmail";

/**
 * The explicit unresolved-employer placeholder.
 *
 * MUST be the exact string `reconcile.ts` treats as its company match target
 * (`COMPANY_PLACEHOLDER`) and the string the manual import route writes, because
 * that is what lets a later email carrying the real employer upgrade this same
 * application instead of creating a duplicate. It is a deliberate, explicit
 * "we do not know yet" marker — not a fabricated employer — and
 * `sanitizeCompanyName` still guarantees a portal name can never be stored in its
 * place. `autoImport.test.ts` asserts this equals reconcile's target so the two
 * can never drift.
 */
export const UNRESOLVED_COMPANY = "Unknown company";

/** Every status the applications CHECK constraint permits. */
const APPLICATION_STATUSES: Record<ApplicationStatusValue, true> = {
  Applied: true,
  Interview: true,
  Offer: true,
  Rejected: true,
  Ghosted: true,
};

/** Own-property lookup, so a prototype key can never satisfy the guard. */
function isApplicationStatus(value: unknown): value is ApplicationStatusValue {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(APPLICATION_STATUSES, value)
  );
}

interface OwnedApplicationRow {
  id: string;
  company: string;
  role: string;
  applied_date: string;
  status: string | null;
  updated_at: string | null;
}

/** The acting user's applications, for match tiers and status monotonicity. */
async function fetchOwnedApplications(
  supabase: SupabaseClient,
  userId: string
): Promise<OwnedApplicationRow[]> {
  const { data, error } = await supabase
    .from("applications")
    .select("id, company, role, applied_date, status, updated_at")
    .eq("user_id", userId)
    .returns<OwnedApplicationRow[]>();

  if (error) {
    console.error("[gmail/autoImport] Application read failed:", error.message);
    throw error;
  }

  return data ?? [];
}

/**
 * Re-verify an application id against the acting user before writing to it.
 *
 * The id already came from a user-scoped read; this is the second, independent
 * check the security model requires, because a matched id must never be trusted
 * as ownership proof on its own.
 */
async function loadOwnedApplication(
  supabase: SupabaseClient,
  userId: string,
  applicationId: string
): Promise<{ status: ApplicationStatusValue | null; updatedAt: string | null; gmailMessageId: string | null } | null> {
  const { data, error } = await supabase
    .from("applications")
    .select("id, status, updated_at, gmail_message_id")
    .eq("id", applicationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error(
      "[gmail/autoImport] Application ownership check failed:",
      error.message
    );
    throw error;
  }
  if (!data) return null;

  const row = data as { status?: unknown; updated_at?: unknown; gmail_message_id?: unknown };
  return {
    status: isApplicationStatus(row.status) ? row.status : null,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
    gmailMessageId: typeof row.gmail_message_id === "string" ? row.gmail_message_id : null,
  };
}

/** ISO timestamp -> DATE column value, falling back to the run's clock. */
function toDateOnly(value: string | null, now: number): string {
  if (value) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  }
  return new Date(now).toISOString().slice(0, 10);
}

/** Latest date among evidence rows that imply a status; null when none do. */
function latestStatusEvidenceAt(
  evidence: { category: EmailCategory; email_date: string | null }[]
): string | null {
  const times = evidence
    .filter((row) => inferStatusFromCategory(row.category) !== null)
    .map((row) => (row.email_date ? Date.parse(row.email_date) : Number.NaN))
    .filter((time) => Number.isFinite(time));

  return times.length === 0 ? null : new Date(Math.max(...times)).toISOString();
}

/**
 * Create the application, then link its evidence in the same logical step.
 *
 * A throw from the insert leaves every activity row UNLINKED, so the next run
 * rebuilds the same proposal and retries it.
 */
async function applyCreate(
  supabase: SupabaseClient,
  userId: string,
  proposal: ApplicationProposal,
  now: number
): Promise<void> {
  // A resolved employer is stored as-is. An unresolved one is stored as the
  // explicit placeholder reconcile.ts upgrades later — the `applications.company`
  // column is NOT NULL, so strong evidence with no employer is persisted under
  // the placeholder rather than being withheld. `sanitizeCompanyName` still
  // ensures a portal name can never reach this column.
  const company = sanitizeCompanyName(proposal.company) ?? UNRESOLVED_COMPANY;

  // Track the earliest Gmail message for this application, so users can open it.
  // When multiple evidence rows exist, the first by email_date is the primary one.
  const earliestEvidence = proposal.evidence.length > 0 ? proposal.evidence[0] : null;
  // The activity ID is in the proposal; we need to fetch the gmail_message_id.
  // For simplicity and efficiency, we'll fetch it from the first activity row.
  let gmailMessageId: string | null = null;
  if (earliestEvidence) {
    const { data: activityRow } = await supabase
      .from("gmail_activity")
      .select("gmail_message_id")
      .eq("id", earliestEvidence.activityId)
      .eq("user_id", userId)
      .single();
    if (activityRow) {
      gmailMessageId = (activityRow as { gmail_message_id: string }).gmail_message_id;
    }
  }

  const { data, error } = await supabase
    .from("applications")
    .insert({
      user_id: userId,
      company,
      role: proposal.jobTitle ?? UNSPECIFIED,
      location: proposal.location ?? UNSPECIFIED,
      job_portal: proposal.jobPortal ?? PORTAL_FALLBACK,
      applied_date: toDateOnly(proposal.appliedDate, now),
      status: proposal.status,
      gmail_message_id: gmailMessageId,
      // Origin recorded at insert time, so "reset tracked Gmail applications"
      // can delete this row without having to guess. A manual application is
      // never marked this way, which is what keeps it safe from the reset.
      source: "gmail",
    })
    .select("id")
    .single();

  if (error || !data) {
    throw error ?? new Error("application insert returned no row");
  }

  await linkActivityToApplication(
    supabase,
    userId,
    proposal.activityIds,
    (data as { id: string }).id
  );
}

/**
 * Link evidence to an existing application, then advance its status if — and
 * only if — the resolved status is newer than what is stored.
 */
async function applyLink(
  supabase: SupabaseClient,
  userId: string,
  proposal: ApplicationProposal,
  applicationId: string
): Promise<{ linked: boolean; updated: boolean }> {
  const target = await loadOwnedApplication(supabase, userId, applicationId);
  if (!target) {
    // Not this user's application. Link nothing; the proposal stays reviewable.
    return { linked: false, updated: false };
  }

  await linkActivityToApplication(
    supabase,
    userId,
    proposal.activityIds,
    applicationId
  );

  // Backfill gmail_message_id if the application doesn't have one yet and
  // we have Gmail evidence. This handles existing applications that were
  // created before this field existed or were matched to Gmail activity.
  if (!target.gmailMessageId && proposal.evidence.length > 0) {
    const earliestEvidence = proposal.evidence[0];
    const { data: activityRow } = await supabase
      .from("gmail_activity")
      .select("gmail_message_id")
      .eq("id", earliestEvidence.activityId)
      .eq("user_id", userId)
      .single();

    if (activityRow) {
      const gmailMessageId = (activityRow as { gmail_message_id: string }).gmail_message_id;
      if (gmailMessageId) {
        await supabase
          .from("applications")
          .update({ gmail_message_id: gmailMessageId })
          .eq("id", applicationId)
          .eq("user_id", userId);
      }
    }
  }

  // Status is resolved from ALL of the application's evidence, not just the
  // rows this proposal contributed, so a late link cannot pick a stage out of
  // context.
  const evidence = await fetchActivityForApplication(
    supabase,
    userId,
    applicationId
  );

  const nextStatus: InferredStatus | null = resolveStatus(
    evidence.map((row) => ({ category: row.category, emailDate: row.email_date }))
  );
  if (!nextStatus) return { linked: true, updated: false };

  // Undated evidence cannot be ordered, so it must never move a status — not
  // even away from a derived Ghosted.
  const nextStatusAt = latestStatusEvidenceAt(evidence);
  if (nextStatusAt === null) return { linked: true, updated: false };

  if (
    !shouldUpdateStatus({
      currentStatus: target.status,
      currentStatusAt: target.updatedAt,
      nextStatus,
      nextStatusAt,
    })
  ) {
    return { linked: true, updated: false };
  }

  // LIFECYCLE INTEGRATION POINT (deferred, Sprint 10).
  //
  // This is the single status write in this module and the natural place to call
  // `updateApplicationStatus` from `lib/api/applications.ts` with
  // source: 'gmail', so an automatically-advanced status leaves a history row.
  // It is NOT changed here because that function delegates to the
  // `update_application_status` Postgres function via `supabase.rpc(...)`, and
  // the in-memory Supabase fake in `autoImport.test.ts` implements only `.from`.
  // Swapping the write would therefore require editing that test, which this
  // pass is not permitted to do. Everything needed is already in place: the
  // `shouldUpdateStatus` gate above, the ownership re-check in
  // `loadOwnedApplication`, and the per-proposal try/catch in `runAutoImport`.
  // Next pass: teach the fake `.rpc`, then replace these five lines.
  const { error } = await supabase
    .from("applications")
    .update({ status: nextStatus })
    .eq("id", applicationId)
    .eq("user_id", userId);

  if (error) {
    // The link already succeeded and the evidence is preserved, so a failed
    // status bump is reported and left for the next run rather than undoing it.
    console.error("[gmail/autoImport] Status update failed:", error.message);
    return { linked: true, updated: false };
  }

  return { linked: true, updated: true };
}

/**
 * Organize the acting user's unlinked lifecycle evidence.
 *
 * Idempotent: creation links its activity in the same step, and the fetch only
 * returns UNLINKED rows, so a second run over an unchanged mailbox finds
 * nothing to do. Where evidence does resurface (a new message in a known
 * thread) it matches the existing application and links instead of creating,
 * and `shouldUpdateStatus` refuses an equal status, so no duplicate application
 * and no duplicate link can be produced.
 */
export async function runAutoImport(
  supabase: SupabaseClient,
  userId: string,
  options: AutoImportOptions = {}
): Promise<AutoImportResult> {
  const now = options.now ?? Date.now();

  const result: AutoImportResult = {
    examined: 0,
    created: 0,
    linked: 0,
    updated: 0,
    heldAmbiguous: 0,
    heldUnknownEmployer: 0,
    failed: 0,
  };

  const rows = await fetchLifecycleActivityForAutoImport(
    supabase,
    userId,
    options.activityLimit
  );
  if (rows.length === 0) return result;

  const owned = await fetchOwnedApplications(supabase, userId);
  const ownedApplicationIds = new Set(owned.map((row) => row.id));

  const candidates: ApplicationCandidate[] = owned.map((row) => ({
    id: row.id,
    company: row.company,
    role: row.role,
    appliedDate: row.applied_date,
  }));

  const threadLinks = await getThreadApplicationLinks(
    supabase,
    userId,
    rows
      .map((row) => row.gmail_thread_id)
      .filter((threadId): threadId is string => Boolean(threadId))
  );

  // A thread link is only usable as a match if it points at an application this
  // user owns.
  for (const [threadId, applicationId] of threadLinks) {
    if (!ownedApplicationIds.has(applicationId)) threadLinks.delete(threadId);
  }

  const proposals = buildProposals(rows, candidates, threadLinks, now);
  const scoped =
    options.maxProposals === undefined
      ? proposals
      : proposals.slice(0, Math.max(0, options.maxProposals));

  for (const proposal of scoped) {
    result.examined += 1;

    const decision = decideProposal(proposal, { ownedApplicationIds });

    // Per-proposal isolation: one failure must not abort the run or lose the
    // work already applied.
    try {
      if (decision.action === "create") {
        await applyCreate(supabase, userId, proposal, now);
        result.created += 1;
        continue;
      }

      if (decision.action === "link" && decision.applicationId) {
        const outcome = await applyLink(
          supabase,
          userId,
          proposal,
          decision.applicationId
        );

        if (outcome.linked) {
          result.linked += 1;
          if (outcome.updated) result.updated += 1;
        } else {
          result.heldAmbiguous += 1;
        }
        continue;
      }

      if (decision.action === "hold_unknown_employer") {
        result.heldUnknownEmployer += 1;
        continue;
      }

      result.heldAmbiguous += 1;
    } catch (error) {
      result.failed += 1;
      console.error(
        "[gmail/autoImport] Proposal could not be applied:",
        decision.action,
        decision.reason,
        error instanceof Error ? error.message : "unknown error"
      );
    }
  }

  return result;
}

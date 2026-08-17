/**
 * Reconciliation — deterministic repair of already-imported applications.
 *
 * Rows imported before this sprint can carry `job_portal = "Gmail"`, the
 * `Unknown company` / `Unknown role` placeholders the manual import route
 * writes as a fallback, or a status that never moved because the merge path did
 * not apply one. The evidence to fix them is already in the ledger, linked to
 * those applications, so no re-scan and no AI call is needed.
 *
 * Two halves, deliberately separated, mirroring `autoImport.ts`:
 *
 *   `planReconciliation`  pure. Applications plus their linked evidence in, a
 *                         list of patches out. Emits no empty patch.
 *   `runReconciliation`   the only half that touches Supabase. Applies each
 *                         patch in its own try/catch, re-verifying ownership
 *                         immediately before the write.
 *
 * Invariants this module exists to hold:
 *  - Rewriting history is unacceptable, so a field is replaced ONLY when it
 *    holds an exact placeholder this codebase wrote itself. A manually-created
 *    application, or any field the user typed, is left completely untouched.
 *  - No field is ever cleared, and no placeholder is ever WRITTEN. The
 *    placeholder strings appear here only as match targets.
 *  - A portal is never stored as an employer: an evidence-derived company must
 *    survive `sanitizeCompanyName` before it can land in `company`.
 *  - Status moves only through `shouldUpdateStatus`, and only on DATED
 *    evidence, so nothing regresses and undated evidence moves nothing.
 *  - Every read and write carries `.eq("user_id", userId)`. Ownership is
 *    enforced in the statement, not only by RLS, and an application id read
 *    earlier in the run is re-verified as owned before it is patched.
 *  - Nothing is deleted and nothing is unlinked. Reconciliation never writes to
 *    `gmail_activity` at all, so the evidence trail survives every run.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchActivityForApplication } from "../api/gmailActivity.ts";
import {
  portalNameFromDomain,
  sanitizeCompanyName,
  type EmailCategory,
} from "./heuristics.ts";
import {
  inferStatusFromCategory,
  resolveStatus,
  shouldUpdateStatus,
  type ApplicationStatusValue,
} from "./statusInference.ts";

// ---------------------------------------------------------------------------
// Placeholders — MATCH TARGETS ONLY
// ---------------------------------------------------------------------------

/**
 * The exact fallback values the manual import route writes when a proposal
 * carried no employer, no role, or no portal.
 *
 * These are the only values reconciliation is willing to overwrite, and it
 * never writes one: a replacement that would reproduce a placeholder is
 * discarded instead.
 */
const COMPANY_PLACEHOLDER = "Unknown company";
const ROLE_PLACEHOLDER = "Unknown role";
const PORTAL_PLACEHOLDER = "Gmail";

const PLACEHOLDERS: ReadonlySet<string> = new Set([
  COMPANY_PLACEHOLDER,
  ROLE_PLACEHOLDER,
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Non-content reason codes, safe to log and to show. Never email text. */
export type ReconciliationReason =
  | "job_portal_placeholder_replaced"
  | "company_placeholder_resolved"
  | "role_placeholder_resolved"
  | "status_advanced_by_dated_evidence";

export interface ReconciliationPatch {
  applicationId: string;
  jobPortal?: string;
  company?: string;
  role?: string;
  status?: ApplicationStatusValue;
  /** Why each field is in this patch, in the order the rules were applied. */
  reasons: ReconciliationReason[];
}

/** One of the acting user's applications, as reconciliation needs to see it. */
export interface ApplicationRecord {
  id: string;
  company: string;
  role: string;
  jobPortal: string | null;
  status: ApplicationStatusValue | null;
  /** When the stored status was last written, for monotonicity. */
  statusUpdatedAt: string | null;
}

/**
 * The evidence fields reconciliation reads. A structural subset of
 * `GmailActivityRow`, so a row read from the ledger is assignable as-is and no
 * body or snippet column can reach this module.
 */
export interface ReconciliationEvidenceRow {
  category: EmailCategory;
  company: string | null;
  job_title: string | null;
  sender_domain: string | null;
  email_date: string | null;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Most frequent non-empty value, longer strings winning a tie. */
function consensus(values: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed === "") continue;
    counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
  }
  if (counts.size === 0) return null;

  return [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || b[0].length - a[0].length
  )[0][0];
}

/** Latest date among evidence rows that imply a status; null when none do. */
function latestStatusEvidenceAt(
  evidence: readonly ReconciliationEvidenceRow[]
): string | null {
  const times = evidence
    .filter((row) => inferStatusFromCategory(row.category) !== null)
    .map((row) => (row.email_date ? Date.parse(row.email_date) : Number.NaN))
    .filter((time) => Number.isFinite(time));

  return times.length === 0 ? null : new Date(Math.max(...times)).toISOString();
}

/** Every status the applications CHECK constraint permits. */
const APPLICATION_STATUSES: Record<ApplicationStatusValue, true> = {
  Applied: true,
  Interview: true,
  Offer: true,
  Rejected: true,
  Ghosted: true,
};

/** Own-property lookup, so a prototype key can never satisfy the guard. */
export function isApplicationStatus(
  value: unknown
): value is ApplicationStatusValue {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(APPLICATION_STATUSES, value)
  );
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

/**
 * Plan the repairs for a set of applications, given only their LINKED evidence.
 *
 * Pure and deterministic: the same applications and evidence always produce the
 * same patches, in application order.
 *
 * Rules, all conservative:
 *  1. Only an application with at least one linked `gmail_activity` row is
 *     considered. A manually-created application with no Gmail evidence is
 *     never examined, so it can never be patched.
 *  2. `job_portal` is replaced only when the stored value is exactly `"Gmail"`
 *     and the evidence yields a real portal via `portalNameFromDomain`. Direct
 *     employer mail yields no portal, and then the stored value is LEFT ALONE
 *     rather than blanked.
 *  3. `company` is replaced only when the stored value is exactly
 *     `"Unknown company"` and the evidence-derived name survives
 *     `sanitizeCompanyName`, so a portal name can never land in `company`.
 *  4. `role` follows the same rule against the exact `"Unknown role"`.
 *  5. `status` moves only through `shouldUpdateStatus`, and only with dated
 *     evidence. Undated evidence never moves a status.
 *  6. No field is ever cleared, and a patch with no changes is not emitted.
 */
export function planReconciliation(input: {
  applications: readonly ApplicationRecord[];
  /** Linked evidence ONLY, keyed by application id. */
  activityByApplication: ReadonlyMap<string, readonly ReconciliationEvidenceRow[]>;
}): ReconciliationPatch[] {
  const patches: ReconciliationPatch[] = [];

  for (const application of input.applications) {
    const evidence = input.activityByApplication.get(application.id) ?? [];

    // Rule 1: no linked evidence, nothing to reason from.
    if (evidence.length === 0) continue;

    const patch: ReconciliationPatch = {
      applicationId: application.id,
      reasons: [],
    };

    const senderDomain = consensus(evidence.map((row) => row.sender_domain));

    // Rule 2: the portal placeholder, and only when evidence names a portal.
    if (application.jobPortal === PORTAL_PLACEHOLDER) {
      const portal = portalNameFromDomain(senderDomain);
      if (portal !== null && portal !== PORTAL_PLACEHOLDER) {
        patch.jobPortal = portal;
        patch.reasons.push("job_portal_placeholder_replaced");
      }
    }

    // Rule 3: the company placeholder, and only a sanitized employer name.
    if (application.company === COMPANY_PLACEHOLDER) {
      const company = sanitizeCompanyName(
        consensus(evidence.map((row) => row.company)),
        senderDomain
      );
      if (company !== null && !PLACEHOLDERS.has(company)) {
        patch.company = company;
        patch.reasons.push("company_placeholder_resolved");
      }
    }

    // Rule 4: the role placeholder.
    if (application.role === ROLE_PLACEHOLDER) {
      const role = consensus(evidence.map((row) => row.job_title));
      if (role !== null && !PLACEHOLDERS.has(role)) {
        patch.role = role;
        patch.reasons.push("role_placeholder_resolved");
      }
    }

    // Rule 5: status, through the same monotonicity gate as everywhere else.
    const nextStatus = resolveStatus(
      evidence.map((row) => ({
        category: row.category,
        emailDate: row.email_date,
      }))
    );
    // Undated evidence cannot be ordered, so it must never move a status.
    const nextStatusAt = latestStatusEvidenceAt(evidence);

    if (
      nextStatus !== null &&
      nextStatusAt !== null &&
      shouldUpdateStatus({
        currentStatus: application.status,
        currentStatusAt: application.statusUpdatedAt,
        nextStatus,
        nextStatusAt,
      })
    ) {
      patch.status = nextStatus;
      patch.reasons.push("status_advanced_by_dated_evidence");
    }

    // Rule 6: no empty patch.
    if (patch.reasons.length > 0) patches.push(patch);
  }

  return patches;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export interface ReconciliationResult {
  /** Applications considered in this run. */
  examined: number;
  patched: number;
  /** Applications whose repair threw and was skipped. */
  failed: number;
}

export interface ReconciliationOptions {
  /** Cap on applications considered in one run. */
  limit?: number;
}

/** Columns the run reads. Named explicitly so no later column joins by accident. */
const APPLICATION_COLUMNS = "id, company, role, job_portal, status, updated_at";

interface ApplicationRow {
  id: string;
  company: string;
  role: string;
  job_portal: string | null;
  status: string | null;
  updated_at: string | null;
}

function toRecord(row: ApplicationRow): ApplicationRecord {
  return {
    id: row.id,
    company: row.company,
    role: row.role,
    jobPortal: row.job_portal,
    status: isApplicationStatus(row.status) ? row.status : null,
    statusUpdatedAt:
      typeof row.updated_at === "string" ? row.updated_at : null,
  };
}

/**
 * Re-verify an application against the acting user and read its CURRENT values.
 *
 * The id already came from a user-scoped read; this is the second, independent
 * check the security model requires, because a known id is never ownership
 * proof. Reading the current values at the same time also means a field the
 * user edited between the plan and the write is re-examined against the rules
 * rather than overwritten from a stale plan.
 */
async function loadOwnedApplication(
  supabase: SupabaseClient,
  userId: string,
  applicationId: string
): Promise<ApplicationRecord | null> {
  const { data, error } = await supabase
    .from("applications")
    .select(APPLICATION_COLUMNS)
    .eq("id", applicationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error(
      "[gmail/reconcile] Application ownership check failed:",
      error.message
    );
    throw error;
  }
  if (!data) return null;

  return toRecord(data as ApplicationRow);
}

/** The acting user's applications, oldest first so a run is deterministic. */
async function fetchOwnedApplications(
  supabase: SupabaseClient,
  userId: string,
  limit?: number
): Promise<ApplicationRecord[]> {
  let query = supabase
    .from("applications")
    .select(APPLICATION_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (limit !== undefined) query = query.limit(Math.max(0, limit));

  const { data, error } = await query.returns<ApplicationRow[]>();

  if (error) {
    console.error("[gmail/reconcile] Application read failed:", error.message);
    throw error;
  }

  return (data ?? []).map(toRecord);
}

/**
 * Repair the acting user's Gmail-imported applications.
 *
 * Explicit repair only: this is never invoked on a timer and never as part of a
 * scan.
 *
 * Idempotent by construction. Every rule matches an exact placeholder or
 * requires strictly newer dated evidence, so a successful patch removes its own
 * precondition: the replaced `job_portal` is no longer `"Gmail"`, the replaced
 * `company` / `role` no longer equal their placeholders, and the written status
 * is now equal to the resolved one, which `shouldUpdateStatus` refuses. A
 * second run therefore plans nothing and patches 0.
 *
 * Per-application isolation: one failure is counted and the run continues, and
 * because nothing is written outside the failing application's own update, a
 * retry picks it up unchanged.
 */
export async function runReconciliation(
  supabase: SupabaseClient,
  userId: string,
  options: ReconciliationOptions = {}
): Promise<ReconciliationResult> {
  const result: ReconciliationResult = { examined: 0, patched: 0, failed: 0 };

  const applications = await fetchOwnedApplications(
    supabase,
    userId,
    options.limit
  );
  if (applications.length === 0) return result;

  // Evidence is read per application, each read scoped to the acting user AND
  // to that application, and each isolated so one unreadable application cannot
  // abort the run.
  const activityByApplication = new Map<string, ReconciliationEvidenceRow[]>();
  const considered: ApplicationRecord[] = [];

  for (const application of applications) {
    result.examined += 1;

    try {
      const evidence = await fetchActivityForApplication(
        supabase,
        userId,
        application.id
      );
      if (evidence.length === 0) continue;

      activityByApplication.set(application.id, evidence);
      considered.push(application);
    } catch (error) {
      result.failed += 1;
      console.error(
        "[gmail/reconcile] Evidence could not be read:",
        error instanceof Error ? error.message : "unknown error"
      );
    }
  }

  const planned = planReconciliation({
    applications: considered,
    activityByApplication,
  });

  for (const patch of planned) {
    try {
      // Ownership is re-verified here, immediately before the write.
      const owned = await loadOwnedApplication(
        supabase,
        userId,
        patch.applicationId
      );
      if (owned === null) continue;

      const evidence = activityByApplication.get(patch.applicationId) ?? [];

      // Re-plan from the freshly read row, so the write reflects the rules as
      // they apply NOW rather than what was planned a few statements ago.
      const [fresh] = planReconciliation({
        applications: [owned],
        activityByApplication: new Map([[owned.id, evidence]]),
      });
      if (!fresh) continue;

      // Only fields the plan actually resolved are written, so nothing is ever
      // cleared and no untouched column is rewritten.
      // LIFECYCLE INTEGRATION POINT (deferred, Sprint 10).
      //
      // `update.status` below is this module's single status write, and routing it
      // through `updateApplicationStatus` (source: 'gmail') would record it in
      // `application_status_history`. It is NOT changed here for two reasons, and
      // either alone is disqualifying under this pass's constraints: the status
      // travels in the SAME single-statement patch as job_portal/company/role, so
      // extracting it splits one write into two and changes this runner's
      // per-application semantics; and the centralized function issues
      // `supabase.rpc(...)`, which the in-memory fake in `reconcile.test.ts` does
      // not implement, so the swap would require editing that test.
      // Next pass: teach the fake `.rpc`, then apply the field patch first and the
      // status through the lifecycle call, keeping both inside this try/catch.
      const update: Record<string, string> = {};
      if (fresh.jobPortal !== undefined) update.job_portal = fresh.jobPortal;
      if (fresh.company !== undefined) update.company = fresh.company;
      if (fresh.role !== undefined) update.role = fresh.role;
      if (fresh.status !== undefined) update.status = fresh.status;
      if (Object.keys(update).length === 0) continue;

      const { error } = await supabase
        .from("applications")
        .update(update)
        .eq("id", fresh.applicationId)
        .eq("user_id", userId);

      if (error) throw error;

      result.patched += 1;
    } catch (error) {
      result.failed += 1;
      console.error(
        "[gmail/reconcile] Application could not be patched:",
        patch.reasons.join(","),
        error instanceof Error ? error.message : "unknown error"
      );
    }
  }

  return result;
}

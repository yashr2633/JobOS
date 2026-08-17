/**
 * Reset tracked Gmail applications — "start fresh".
 *
 * WHAT IT DELETES, AND WHAT IT DELIBERATELY DOES NOT
 *
 *   deleted   applications whose `source` is 'gmail' (created by an import path)
 *   deleted   the Gmail activity ledger for this user
 *   reset     the incremental sync anchor and any open/finished sync jobs
 *
 *   PRESERVED applications whose `source` is 'manual'
 *   PRESERVED the Gmail connection and its tokens — a reset is not a disconnect
 *   PRESERVED the user's account, profile, and every resume
 *   PRESERVED every other user's data, by construction (see below)
 *
 * ORDERING IS THE FAILURE-SAFETY STRATEGY
 *
 * The Supabase client has no transaction, so this cannot be atomic. Instead the
 * steps are ordered so that an interruption at ANY point leaves a state that is
 * consistent and that a re-run repairs:
 *
 *   1. delete gmail_activity      — evidence rows referencing applications
 *   2. delete gmail_sync_jobs     — scan state
 *   3. clear the history anchor    — so the next scan is a full scan
 *   4. delete source='gmail' applications
 *
 * Evidence is removed BEFORE the applications it points at, so there is never a
 * moment where a surviving activity row references a deleted application. If the
 * run dies after step 1, the user has applications with no evidence — which is
 * exactly the state a manual application is always in, so nothing is broken — and
 * running the reset again completes the job. Every step is idempotent, so a
 * re-run after any partial failure converges.
 *
 * OWNERSHIP
 *
 * Every statement carries `.eq("user_id", userId)`. Ownership is enforced in the
 * statement, not only by RLS, and `userId` is resolved from the session by the
 * route — never accepted from the request body. There is no code path here that
 * can widen the scope beyond one user.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** How an application came to exist. Mirrors the CHECK constraint. */
export type ApplicationSource = "manual" | "gmail";

export const APPLICATION_SOURCES: readonly ApplicationSource[] = [
  "manual",
  "gmail",
];

/** The origin recorded for rows the Gmail import paths create. */
export const GMAIL_SOURCE: ApplicationSource = "gmail";

/** The origin recorded for rows a person creates, and the safe default. */
export const MANUAL_SOURCE: ApplicationSource = "manual";

export function isApplicationSource(value: unknown): value is ApplicationSource {
  return (
    typeof value === "string" &&
    (APPLICATION_SOURCES as readonly string[]).includes(value)
  );
}

/** What a reset would remove, for the confirmation dialog. */
export interface ResetPreview {
  /** Applications that would be deleted (source = 'gmail'). */
  gmailApplications: number;
  /** Applications that would be kept (source = 'manual'). */
  manualApplications: number;
  /** Gmail evidence rows that would be deleted. */
  activityRows: number;
}

/** What a reset actually removed. */
export interface ResetResult {
  deletedApplications: number;
  deletedActivityRows: number;
  deletedSyncJobs: number;
  /** True when the incremental anchor was cleared, so the next scan is full. */
  syncStateReset: boolean;
}

/**
 * Count what a reset would affect, without changing anything.
 *
 * Read-only and user-scoped. Powers the confirmation dialog, so the user sees the
 * real number of records before agreeing — which is what "never silently delete
 * data" requires, and what mitigates the historical-backfill ambiguity documented
 * in the Sprint 12 migration.
 */
export async function previewGmailApplicationReset(
  supabase: SupabaseClient,
  userId: string
): Promise<ResetPreview> {
  const countBySource = async (source: ApplicationSource): Promise<number> => {
    const { count, error } = await supabase
      .from("applications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("source", source);

    if (error) {
      console.error("[reset] Application count failed:", error.message);
      throw error;
    }
    return count ?? 0;
  };

  const { count: activityCount, error: activityError } = await supabase
    .from("gmail_activity")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  if (activityError) {
    console.error("[reset] Activity count failed:", activityError.message);
    throw activityError;
  }

  const [gmailApplications, manualApplications] = await Promise.all([
    countBySource(GMAIL_SOURCE),
    countBySource(MANUAL_SOURCE),
  ]);

  return {
    gmailApplications,
    manualApplications,
    activityRows: activityCount ?? 0,
  };
}

/**
 * Perform the reset.
 *
 * Steps run in the order documented at the top of this module. A failure throws,
 * leaving a consistent partial state that a re-run completes.
 */
export async function resetGmailApplications(
  supabase: SupabaseClient,
  userId: string
): Promise<ResetResult> {
  // ---- 1. Gmail evidence -------------------------------------------------
  // Deleted first, so no surviving evidence row can reference an application
  // that step 4 removes.
  const { data: deletedActivity, error: activityError } = await supabase
    .from("gmail_activity")
    .delete()
    .eq("user_id", userId)
    .select("id");

  if (activityError) {
    console.error("[reset] Activity delete failed:", activityError.message);
    throw activityError;
  }

  // ---- 2. Scan jobs ------------------------------------------------------
  // Removes any open job, so the next scan cannot be "continued" from a cursor
  // that points into a mailbox window whose results have just been discarded.
  const { data: deletedJobs, error: jobsError } = await supabase
    .from("gmail_sync_jobs")
    .delete()
    .eq("user_id", userId)
    .select("id");

  if (jobsError) {
    console.error("[reset] Sync job delete failed:", jobsError.message);
    throw jobsError;
  }

  // ---- 3. Incremental anchor --------------------------------------------
  // Clearing `history_id` is what makes the NEXT scan a genuine full scan
  // rather than a diff against a mailbox state whose ledger no longer exists.
  // The tokens and `is_active` are untouched: this is a reset, not a disconnect.
  const { error: connectionError } = await supabase
    .from("gmail_connections")
    .update({
      history_id: null,
      last_full_sync_at: null,
      last_sync_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  if (connectionError) {
    console.error("[reset] Sync state reset failed:", connectionError.message);
    throw connectionError;
  }

  // ---- 4. Gmail-created applications ------------------------------------
  // Scoped by BOTH user_id and source. A manual application is unreachable by
  // this statement, which is the property the whole feature rests on.
  const { data: deletedApplications, error: applicationsError } = await supabase
    .from("applications")
    .delete()
    .eq("user_id", userId)
    .eq("source", GMAIL_SOURCE)
    .select("id");

  if (applicationsError) {
    console.error(
      "[reset] Application delete failed:",
      applicationsError.message
    );
    throw applicationsError;
  }

  return {
    deletedApplications: deletedApplications?.length ?? 0,
    deletedActivityRows: deletedActivity?.length ?? 0,
    deletedSyncJobs: deletedJobs?.length ?? 0,
    syncStateReset: true,
  };
}

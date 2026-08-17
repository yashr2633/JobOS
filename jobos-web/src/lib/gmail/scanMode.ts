/**
 * Which Gmail listing API a scan uses, and whether an open job may be continued.
 *
 * THE CONTRACT THIS MODULE EXISTS TO ENFORCE
 *
 * Pressing "Scan Gmail" for 7 / 30 / 60 / 90 days means: traverse the COMPLETE
 * Gmail window for that period, every single time. It is not a "only what
 * arrived since last time" feature.
 *
 * That contract was being broken, and it is the whole reason a mailbox that had
 * previously produced thousands of messages started reporting
 * `0 processed / 0 application-related / 0 created`. The route used to decide:
 *
 *     canGoIncremental = lastFullSyncAt !== null
 *                     && historyId    !== null
 *                     && !widensCoverage
 *
 * After one successful 30-day scan all three held for the NEXT 30-day scan, so
 * the job was created with `sync_mode = 'incremental'`. `runSyncBatch` then took
 * the `listHistory` branch — `buildGmailQuery` was never called, `messages.list`
 * was never issued, and the date window was never used at all. `history.list` is
 * ANCHORED, not date-ranged: it can only ever report mail newer than the stored
 * anchor. Nothing new since the last scan therefore listed nothing, and every
 * downstream count was a truthful zero for work that was never attempted.
 *
 * Deduplication was never the problem, and is not weakened here. Dedup is a
 * WRITE concern: it stops the same message becoming a second row. Mode selection
 * is a READ concern: it decides whether the mailbox is traversed at all. The bug
 * was letting a read decision be made from write history.
 *
 * So: an explicit window scan is ALWAYS full. `history.list` and the anchor
 * machinery are untouched and still reachable, but only for a caller that asks
 * for them by name — never as a silent downgrade of what the user requested.
 *
 * Pure: no Supabase, no Gmail, no React, no clock. Every rule below is decided
 * from its arguments alone, which is what lets the contract be pinned by tests
 * instead of by a comment.
 */

import type { ScanWindow } from "./query.ts";
import type { SyncMode } from "../api/gmailActivity.ts";

/**
 * What a caller is asking for.
 *
 * `full_window` — traverse the complete requested date window. What the Scan
 * Gmail button means, and the default for any request that does not say
 * otherwise, so the contract holds even for a caller that has never heard of
 * this field.
 *
 * `incremental` — diff against the stored anchor. Cheap, and correct only for a
 * background top-up that is explicitly allowed to see nothing. Must be asked for
 * by name.
 */
export const SCAN_INTENTS = ["full_window", "incremental"] as const;

export type ScanIntent = (typeof SCAN_INTENTS)[number];

/**
 * The intent an unspecified request gets.
 *
 * Deliberately the expensive, complete one. A request that forgets to declare
 * itself must fall back to reading everything it asked for, never to reading
 * nothing: the failure mode of the default has to be "did more work than
 * needed", not "silently reported zero".
 */
export const DEFAULT_SCAN_INTENT: ScanIntent = "full_window";

export function isScanIntent(value: unknown): value is ScanIntent {
  return (
    typeof value === "string" && (SCAN_INTENTS as readonly string[]).includes(value)
  );
}

/** Narrow an untrusted request body field to an intent. */
export function coerceScanIntent(value: unknown): ScanIntent {
  return isScanIntent(value) ? value : DEFAULT_SCAN_INTENT;
}

/**
 * Why a mode was chosen. Stable codes for logs and tests, never user-facing
 * text, and never anything derived from mail content.
 */
export type ScanModeReason =
  | "explicit_full_window"
  | "incremental_requested"
  | "no_anchor"
  | "no_completed_full_sync";

export interface ScanModeDecision {
  syncMode: SyncMode;
  reason: ScanModeReason;
}

/**
 * Decide which Gmail listing API this scan uses.
 *
 * The first rule is absolute and has no escape hatch: a `full_window` intent
 * resolves to `full`, whatever the connection's history says. No anchor, no
 * completed sync, and no previous coverage can downgrade it. That single line is
 * the fix for the zero-message regression, and `resolveScanMode` is where it can
 * be proven rather than asserted in prose.
 *
 * An `incremental` intent still has to be earned: without a completed full sync
 * there is no baseline, and without an anchor there is nothing to diff from, so
 * either gap falls back to a full scan rather than listing nothing.
 */
export function resolveScanMode(args: {
  intent: ScanIntent;
  hasAnchor: boolean;
  hasCompletedFullSync: boolean;
}): ScanModeDecision {
  // An explicitly requested window is always traversed in full. This branch must
  // never gain a condition.
  if (args.intent === "full_window") {
    return { syncMode: "full", reason: "explicit_full_window" };
  }

  if (!args.hasCompletedFullSync) {
    return { syncMode: "full", reason: "no_completed_full_sync" };
  }

  if (!args.hasAnchor) {
    return { syncMode: "full", reason: "no_anchor" };
  }

  return { syncMode: "incremental", reason: "incremental_requested" };
}

/**
 * What to do about a job that is already open for this user.
 *
 * `resume` — same window, same mode: this is ordinary pagination through the
 * scan already in progress, and its page cursor belongs to the query the next
 * batch will issue.
 *
 * `supersede` — the open job cannot serve this request. Close it and start a
 * fresh one for what was actually asked for.
 *
 * `start_fresh` — nothing was open.
 */
export type JobReuseAction = "resume" | "supersede" | "start_fresh";

export type JobReuseReason =
  | "no_open_job"
  | "same_window_pagination"
  | "window_mismatch"
  | "mode_mismatch"
  | "unrecoverable_window";

export interface JobReuseDecision {
  action: JobReuseAction;
  reason: JobReuseReason;
}

/** The open job, reduced to the two facts this decision needs. */
export interface OpenJobFacts {
  /**
   * The job's window recovered from its stored bounds, or null when those bounds
   * match no selectable window (a legacy `6m` job, an epoch fallback, unreadable
   * dates).
   */
  window: ScanWindow | null;
  syncMode: SyncMode;
}

/**
 * Decide whether an open job may serve this request.
 *
 * This is the second half of the regression, and the cause of the state where
 * the URL said `?window=7d` while the scan panel reported "scanned the last 60
 * days". The route used to keep a reused job's window and run the batch under
 * it, so a stale open job silently redefined what the user had just selected.
 * Worse, a lingering OPEN INCREMENTAL job made every subsequent press keep
 * listing nothing, because the request's own intent never got a chance to apply.
 *
 * Superseding is what makes the selection deterministic: a mismatched job is
 * closed rather than continued, so the requested window is the window that runs.
 * Cursor safety is preserved by discarding that job's page token along with the
 * job — a token is never carried across to a query it was not minted against,
 * which is the actual invariant the old override was protecting.
 */
export function resolveJobReuse(args: {
  openJob: OpenJobFacts | null;
  requestedWindow: ScanWindow;
  resolvedMode: SyncMode;
}): JobReuseDecision {
  if (args.openJob === null) {
    return { action: "start_fresh", reason: "no_open_job" };
  }

  // Bounds that name no selectable window cannot be shown to be this request's
  // window, so the job is not reused. Guessing here is what produced a scan
  // running under a period the user never chose.
  if (args.openJob.window === null) {
    return { action: "supersede", reason: "unrecoverable_window" };
  }

  // A full-window request must never be served by an open incremental job.
  if (args.openJob.syncMode !== args.resolvedMode) {
    return { action: "supersede", reason: "mode_mismatch" };
  }

  if (args.openJob.window !== args.requestedWindow) {
    return { action: "supersede", reason: "window_mismatch" };
  }

  return { action: "resume", reason: "same_window_pagination" };
}

/**
 * Whether a batch of this mode traverses the mailbox window.
 *
 * True exactly when `runSyncBatch` will build a date-ranged query and call
 * `messages.list`. Used by the route for its per-batch log line so the three
 * outcomes stay distinguishable in production, and by tests as the readable name
 * for the property that matters: an explicit window scan traverses.
 */
export function traversesWindow(syncMode: SyncMode): boolean {
  return syncMode === "full";
}

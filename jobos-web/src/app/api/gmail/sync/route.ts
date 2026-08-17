/**
 * POST /api/gmail/sync
 *
 * Processes ONE bounded batch of the historical Gmail scan and returns progress.
 * The client calls this repeatedly until `done` is true.
 *
 * Bounded per request so it cannot approach maxDuration; resumable because the
 * Gmail page cursor is persisted on the job row; idempotent because
 * gmail_activity is unique per (user, message).
 */

export const runtime = "nodejs";
export const maxDuration = 60;

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  clearGmailHistoryAnchor,
  getGmailTokensForServer,
  saveGmailHistoryAnchor,
  touchGmailLastSync,
} from "@/lib/api/gmail";
import {
  countJobOpportunities,
  countJobRelatedActivityInWindow,
  countLegacyActivityForRegate,
  getCompletedFullScanWindowStart,
  getOpenSyncJob,
  startSyncJob,
  updateSyncJobProgress,
} from "@/lib/api/gmailActivity";
import { runSyncBatch, BATCH_TIME_BUDGET_MS } from "@/lib/gmail/sync";
import { runLegacyRegate } from "@/lib/gmail/regate";
import {
  resolveApplicationRelatedCount,
  resolveLegacyRepairPlan,
} from "@/lib/gmail/scanRepair";
import {
  coerceScanWindow,
  resolveWindow,
  scanWindowFromBounds,
  type ScanWindow,
} from "@/lib/gmail/query";
import {
  coerceScanIntent,
  resolveJobReuse,
  resolveScanMode,
  traversesWindow,
  type ScanIntent,
} from "@/lib/gmail/scanMode";
import { scanWindowDays } from "@/lib/gmail/scanWindowOptions";
import {
  GmailNotConnectedError,
  GmailReconnectRequiredError,
} from "@/lib/gmail/tokens";
import {
  GmailApiError,
  GmailHistoryExpiredError,
  getProfile,
} from "@/lib/gmail/client";

function err(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/**
 * Resolve the requested scan window from an untrusted body.
 *
 * `window` is the current field; `range` is the legacy one and is still
 * honoured when it names a selectable window. Anything else — a legacy `6m`, an
 * unknown string, a non-string — falls back to the 30-day window rather than
 * failing the request (Requirement 9.6). Validation happens here, before a job
 * exists, so no job is ever created with an unvalidated window.
 */
function resolveRequestedWindow(body: unknown): ScanWindow {
  const { window, range } = (body ?? {}) as {
    window?: unknown;
    range?: unknown;
  };
  return coerceScanWindow(window ?? range);
}

/**
 * What the caller is asking for: a complete traversal of the window, or an
 * anchored diff.
 *
 * Absent or unrecognised resolves to `full_window`, so the Scan Gmail button —
 * which sends only `{ window }` — gets the full-window contract without having
 * to know this field exists. An anchored diff must be requested by name.
 */
function resolveRequestedIntent(body: unknown): ScanIntent {
  const { intent } = (body ?? {}) as { intent?: unknown };
  return coerceScanIntent(intent);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // One clock for the whole request, so the repair pass below is budgeted against
  // the same wall clock the scan batch spends rather than a private one.
  const requestStartedAt = Date.now();
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return err("You must be logged in to sync Gmail.", 401);
  }

  // A disconnected or token-blanked connection must abort immediately rather
  // than starting work that cannot succeed.
  const tokens = await getGmailTokensForServer(supabase, user.id);
  if (!tokens) {
    return err("Gmail is not connected.", 409, { reconnectRequired: true });
  }

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // Body is optional; defaults apply.
  }
  const scanWindow = resolveRequestedWindow(body);
  const scanIntent = resolveRequestedIntent(body);

  /**
   * Coverage question: have we already completed a full scan that reaches back
   * as far as or further than the requested window?
   *
   * When the requested window is narrower than or equal to what has already been
   * scanned in a completed full sync, and an anchor exists, incremental mode is
   * valid. When the requested window is wider, a full scan is required to fill
   * the gap.
   */
  const coveredStart = await getCompletedFullScanWindowStart(supabase, user.id);
  const { start: requestedStart } = resolveWindow(scanWindow);

  /**
   * The mode, decided from the REQUEST and coverage.
   *
   * A `full_window` intent always resolves to `full`, whatever the coverage or
   * history says. An `incremental` intent still requires an anchor and must be
   * earned: without coverage (`coveredStart === null`) or when the requested
   * window is wider (`requestedStart < coveredStart`), a full scan is required.
   * A narrower or equal window with a valid anchor stays incremental.
   */
  const windowCoverageOk =
    coveredStart !== null &&
    (requestedStart === null || requestedStart >= new Date(coveredStart));

  const modeDecision = resolveScanMode({
    intent: scanIntent,
    hasAnchor: tokens.historyId !== null,
    hasCompletedFullSync: windowCoverageOk,
  });

  /**
   * Whether an already-open job can serve this request.
   *
   * The partial unique index allows at most one open job per user, which is what
   * stops two loops racing one page cursor. Reusing it is correct ONLY while it
   * is the same scan: same window, same mode. Anything else is closed instead of
   * continued, so the window the user selected is the window that runs.
   */
  const openJob = await getOpenSyncJob(supabase, user.id);
  const reuse = resolveJobReuse({
    openJob: openJob
      ? {
          window: scanWindowFromBounds(openJob.windowStart, openJob.windowEnd),
          syncMode: openJob.syncMode,
        }
      : null,
    requestedWindow: scanWindow,
    resolvedMode: modeDecision.syncMode,
  });

  if (openJob && reuse.action === "supersede") {
    // Closed as NOT complete, deliberately. Marking a partial job complete would
    // fabricate coverage it never read and would corrupt both the reporting
    // window recovered from completed jobs and any future coverage question. Its
    // page token dies with the job, so no cursor is ever carried into a query it
    // was not minted against — the invariant the old window override protected,
    // now kept without letting a stale job redefine the user's selection.
    await updateSyncJobProgress(supabase, user.id, openJob.id, {
      status: "failed",
      error: `superseded_${reuse.reason}`,
    }).catch(() => {
      // Best effort: a fresh job is still the right thing to start.
    });
  }

  let job = reuse.action === "resume" && openJob ? openJob : null;

  if (!job) {
    const { start, end } = resolveWindow(scanWindow);
    // Every selectable window has a lower bound; the epoch fallback keeps the
    // column NOT NULL for any legacy unbounded range.
    const requestedStart = (start ?? new Date(0)).toISOString().slice(0, 10);

    let startHistoryId: string | null = null;

    if (modeDecision.syncMode === "incremental") {
      startHistoryId = tokens.historyId;
    } else {
      // Capture the anchor BEFORE the full scan starts. Reading it afterwards
      // would silently skip anything that arrived while the scan was running.
      try {
        const profile = await getProfile(tokens.accessToken);
        startHistoryId = profile.historyId ?? null;
      } catch (error: unknown) {
        // Not fatal: the scan still works, it just cannot hand off to
        // incremental afterwards and the next sync will be full again.
        console.error(
          "[gmail/sync] Could not capture history anchor:",
          error instanceof Error ? error.message : "unknown error"
        );
      }
    }

    job = await startSyncJob(supabase, user.id, {
      connectionId: tokens.connectionId,
      syncMode: modeDecision.syncMode,
      startHistoryId,
      windowStart: requestedStart,
      windowEnd: end.toISOString().slice(0, 10),
    });
  }

  // Read the job's window back off its own stored bounds, because a RESUMED
  // job's Gmail page cursor was minted against the query those bounds produce.
  // A resumed job matched the request by construction and a fresh job was
  // created from it, so this equals `scanWindow` except in one narrow race:
  // `startSyncJob` returns a job another concurrent request created first.
  const jobWindow = scanWindowFromBounds(job.windowStart, job.windowEnd);
  const effectiveWindow = jobWindow ?? scanWindow;

  const resumeNotice =
    effectiveWindow !== scanWindow
      ? `A scan of the last ${scanWindowDays(effectiveWindow)} days was already running, so this batch continued it. ` +
        `Scan again once it finishes to cover the last ${scanWindowDays(scanWindow)} days.`
      : null;

  /**
   * Whether this finished scan actually left a usable sync point behind.
   *
   * Null while the scan is still running, because the question only has an
   * answer once it completes. Never optimistic: it is set to true only after
   * `saveGmailHistoryAnchor` has resolved, so a failed capture (`getProfile`
   * threw when the job was created) or a failed promotion both report false
   * rather than a fabricated success. Without this, a full scan that lost its
   * anchor completed silently and every future scan stayed full forever with no
   * signal anywhere.
   */
  let anchorEstablished: boolean | null = null;

  // One line per request, operational facts only — no subject, snippet, body,
  // token or any Gmail content. `traverses=true` is the fact that was silently
  // false for every repeat scan, so it is stated explicitly rather than inferred.
  console.info(
    `[gmail/sync] batch start intent=${scanIntent} mode=${modeDecision.syncMode}` +
      ` modeReason=${modeDecision.reason} traverses=${traversesWindow(modeDecision.syncMode)}` +
      ` requested=${scanWindow} effective=${effectiveWindow}` +
      ` reuse=${reuse.action}:${reuse.reason}`
  );

  try {
    const result = await runSyncBatch(supabase, user.id, job, effectiveWindow);

    /**
     * Repair legacy evidence with whatever budget is left.
     *
     * This is what makes the automatic path actually automatic. Rows ledgered
     * before the gate persisted its verdict carry `evidence_strength IS NULL`,
     * which `proposals.ts` reads as not-strong, so `decideProposal` can never
     * create from them and they pile up under "Needs your input" — the manual
     * approval step the product must not require. A normal scan cannot reach
     * them, because dedup removes an already-ledgered message before any fetch.
     *
     * `runLegacyRegate` re-fetches by stored message id, runs the SAME gate, and
     * writes the verdict back in place, then runs the importer over what it just
     * repaired. Matching is not widened anywhere: `weak` and `none` still never
     * create an application, and no employer is invented.
     *
     * Entirely best-effort. It runs after the scan has persisted everything and
     * written its cursor, and any failure is absorbed, so it cannot affect the
     * cursor, the ledger, or this batch's counts.
     */
    let repairedCreated = 0;
    let repairedUpdated = 0;
    let legacyRemaining: number | null = null;

    try {
      const legacyPending = await countLegacyActivityForRegate(supabase, user.id);
      legacyRemaining = legacyPending;

      const repairPlan = resolveLegacyRepairPlan({
        elapsedMs: Date.now() - requestStartedAt,
        budgetMs: BATCH_TIME_BUDGET_MS,
        legacyRemaining: legacyPending,
        // Fresh mail outranks repair work: a held-back cursor means the user is
        // still waiting on the window itself. Taken from the batch rather than
        // recomputed, so the arithmetic lives only in `summarizeListing`.
        pageFullyProcessed: result.pageFullyProcessed,
      });

      if (repairPlan.run) {
        const repaired = await runLegacyRegate(supabase, user.id, {
          limit: repairPlan.limit,
        });
        repairedCreated = repaired.applicationsCreated;
        repairedUpdated = repaired.applicationsUpdated;
        legacyRemaining = repaired.remaining;

        console.info(
          `[gmail/sync] legacy repair reclassified=${repaired.reclassified}` +
            ` created=${repaired.applicationsCreated} updated=${repaired.applicationsUpdated}` +
            ` skipped=${repaired.skipped} failed=${repaired.failed}` +
            ` remaining=${repaired.remaining}`
        );
      }
    } catch (error: unknown) {
      // Reason only. The scan's own results stand.
      console.error(
        "[gmail/sync] Legacy evidence repair skipped:",
        error instanceof Error ? error.message : "unknown error"
      );
    }

    /**
     * Application-related, counted over the WINDOW rather than over this batch.
     *
     * `result.candidates` only counts what this batch newly classified, so a
     * repeat scan reports 0 next to "528 messages read" — a false claim that none
     * of the 528 carried application evidence. The ledger already holds the
     * verdicts from when those messages were first classified, so it is the
     * honest source. A failed count leaves this null and the batch figure is used
     * instead; it never becomes a fabricated zero.
     */
    const ledgerWindowCount = await countJobRelatedActivityInWindow(
      supabase,
      user.id,
      job.windowStart,
      job.windowEnd
    ).catch(() => null);

    const applicationRelatedInWindow = resolveApplicationRelatedCount({
      ledgerWindowCount,
      batchCandidates: job.candidates + result.candidates,
    });

    // Job opportunities are counted separately and are never applications. A
    // failed count stays null rather than becoming a fabricated zero.
    const opportunitiesFound = await countJobOpportunities(
      supabase,
      user.id
    ).catch(() => null);

    if (result.done) {
      // Promote the anchor ONLY now the scan has finished. Advancing it mid-scan
      // would permanently skip every message between the old and new anchor,
      // because history.list would never be asked about them again.
      const anchor = result.historyId ?? job.startHistoryId;
      anchorEstablished = false;
      if (anchor) {
        try {
          await saveGmailHistoryAnchor(supabase, user.id, {
            historyId: anchor,
            markFullSync: job.syncMode === "full",
          });
          anchorEstablished = true;
        } catch (error: unknown) {
          console.error(
            "[gmail/sync] Could not promote history anchor:",
            error instanceof Error ? error.message : "unknown error"
          );
        }
      }

      // Only a completed pass updates the user-visible "Last synced".
      await touchGmailLastSync(supabase, user.id).catch(() => {
        // Cosmetic only; never fail a finished scan over this.
      });
    }

    /**
     * A finished scan that left no sync point behind, said plainly.
     *
     * Nothing is faked upstream — no historyId is invented and no anchor is
     * marked — but until now nothing was reported either, so the user had no way
     * to know why every scan kept re-reading the same window.
     */
    const anchorNotice =
      result.done && anchorEstablished === false
        ? "This scan finished, but JobTrackOS could not save a Gmail sync point. " +
          "The next scan will read the same window again instead of only new mail."
        : null;

    return NextResponse.json({
      jobId: job.id,
      done: result.done,
      // The window actually scanned and the mode actually used, so the client
      // never has to guess what its request was coerced to — and never claims a
      // window a resumed job is not using.
      window: effectiveWindow,
      // What was asked for, alongside what ran. Equal in every normal case; a
      // difference is the concurrent-race note above rather than a silent
      // substitution the client has to detect for itself.
      requestedWindow: scanWindow,
      syncMode: job.syncMode,
      // Whether this batch traversed the mailbox window or diffed an anchor.
      // The client needs this to know a 0 means "nothing matched in the window"
      // rather than "nothing arrived since last time".
      windowTraversed: traversesWindow(job.syncMode),
      // What this batch actually organized, straight from the batch result.
      // 0/0 when the Auto_Importer had no budget left or could not run; the
      // evidence stays in the ledger and the next batch picks it up.
      // The scan's own importer plus anything the legacy repair pass organized on
      // this request. Both are applications this request actually created or
      // advanced, so reporting them separately would understate what happened.
      created: result.applicationsCreated + repairedCreated,
      updated: result.applicationsUpdated + repairedUpdated,
      /**
       * Application-related messages IN THE SCANNED WINDOW, from the ledger.
       *
       * Not this batch's fresh classifications, which are structurally 0 for any
       * repeat scan. Null only when the count itself failed.
       */
      applicationRelated: applicationRelatedInWindow,
      /**
       * Job opportunities in the ledger — alerts/recommendations, NOT
       * applications. Reported separately so the UI can show them without
       * touching any application total.
       */
      opportunitiesFound,
      /** Legacy rows still awaiting a gate verdict, so the client can keep going. */
      legacyRemaining,
      /**
       * Why the import produced what it did.
       *
       * Counts and non-content codes only — no subject, snippet, body or token.
       * Present so a `created: 0` can be attributed rather than guessed at:
       * `examined: 0` means no unlinked lifecycle evidence was read, `held*` means
       * evidence was read and deliberately not acted on, and `proposalsFailed`
       * means writes were attempted and rejected.
       */
      importOutcome: {
        examined: result.autoImport.examined,
        created: result.autoImport.applicationsCreated,
        linked: result.autoImport.linked,
        updated: result.autoImport.applicationsUpdated,
        heldAmbiguous: result.autoImport.heldAmbiguous,
        heldUnknownEmployer: result.autoImport.heldUnknownEmployer,
        proposalsFailed: result.autoImport.proposalsFailed,
        /** Ambiguous messages re-read with their body so the gate could decide. */
        bodyEscalated: result.bodyEscalated,
        /** Of those, how many the gate resolved without a model call. */
        bodyResolved: result.bodyResolved,
      },
      // Three separate numbers because they answer three different questions,
      // and one of them cannot be derived from the others:
      //   messagesListed === 0                      -> Gmail matched nothing
      //   listed > 0, deduplicated === listed       -> all of it was already tracked
      //   messagesFresh > 0                         -> new mail was processed
      // Counts only; no subject, snippet, body, token, or Gmail content.
      messagesListed: result.messagesListed,
      messagesDeduplicated: result.messagesDeduplicated,
      messagesFresh: result.messagesFresh,
      // Whether a finished scan left a usable sync point. Null while running.
      anchorEstablished,
      progress: {
        messagesSeen: result.messagesSeen,
        // Cumulative per-job classification counter, kept as-is for the live
        // progress line. `applicationRelated` above is the window-wide figure.
        candidates: job.candidates + result.candidates,
        classified: job.classified + result.classified,
        activityInserted: result.activityInserted,
      },
      // A batch-level notice always wins: it reports something that happened to
      // this batch's own work, which matters more than explaining the resume.
      // A missing anchor comes next, because it changes what every future scan
      // will do; the resume note only explains this one.
      notice: result.notice ?? anchorNotice ?? resumeNotice,
    });
  } catch (error: unknown) {
    // The stored anchor fell outside Gmail's retention window. The documented
    // recovery is a full sync, so clear the anchor and close this job — the
    // next request starts a fresh full scan.
    if (error instanceof GmailHistoryExpiredError) {
      await clearGmailHistoryAnchor(supabase, user.id).catch(() => {});
      await updateSyncJobProgress(supabase, user.id, job.id, {
        status: "failed",
        error: "history_expired",
      }).catch(() => {});

      return err(
        "Gmail history is too old to sync incrementally. Start the scan again to run a full sync.",
        409,
        { fullSyncRequired: true }
      );
    }

    // Terminal: the Google grant is gone.
    if (error instanceof GmailReconnectRequiredError) {
      await updateSyncJobProgress(supabase, user.id, job.id, {
        status: "paused",
        error: "reconnect_required",
      }).catch(() => {});
      return err("Gmail access expired. Please reconnect Gmail.", 409, {
        reconnectRequired: true,
      });
    }

    if (error instanceof GmailNotConnectedError) {
      return err("Gmail is not connected.", 409, { reconnectRequired: true });
    }

    // Transient: pause so the same cursor can be retried.
    if (error instanceof GmailApiError) {
      const retryable = error.kind === "rate_limit" || error.kind === "unavailable";

      await updateSyncJobProgress(supabase, user.id, job.id, {
        status: retryable ? "paused" : "failed",
        error: error.kind,
      }).catch(() => {});

      // Metadata only — never the Gmail response body.
      console.error("[gmail/sync] Gmail API failure:", error.kind, error.status);

      return err(
        retryable
          ? "Gmail is rate-limiting us. Pause a moment and resume the scan."
          : "Gmail rejected the request. Please reconnect Gmail and try again.",
        retryable ? 503 : 502,
        { retryable, jobId: job.id }
      );
    }

    console.error(
      "[gmail/sync] Unexpected failure:",
      error instanceof Error ? error.message : "unknown error"
    );

    await updateSyncJobProgress(supabase, user.id, job.id, {
      status: "paused",
      error: "unexpected",
    }).catch(() => {});

    return err("The scan hit an unexpected problem. You can resume it.", 500, {
      retryable: true,
      jobId: job.id,
    });
  }
}

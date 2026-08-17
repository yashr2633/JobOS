/**
 * The Gmail scan batch loop, extracted so ONE implementation drives it.
 *
 * `TrackMyJobsWorkspace` owned this loop; the dashboard scan module needs the
 * identical behaviour, and a second copy would be a second set of cursor bugs.
 * So the loop moved here verbatim and both callers use it:
 *
 *   - batches are strictly SEQUENTIAL, because they share one server-persisted
 *     page cursor and overlapping requests would race it;
 *   - the window is captured ONCE per run, so changing a selector mid-scan can
 *     never split one scan's cursor across two different windows;
 *   - a hard batch cap means a server bug cannot spin the browser forever;
 *   - a count nobody reported stays `null` and is never accumulated into a
 *     misleading zero;
 *   - a server `notice` — which is how a missing sync point (`anchorEstablished`
 *     false) reaches the user — still wins over the locally derived headline,
 *     with that headline carried as the detail line.
 *
 * `describeScanOutcome` moved here unchanged from the workspace, so both surfaces
 * make exactly the same honest claims about what a scan did.
 */

import { isScanWindow, type ScanWindow } from "../../lib/gmail/query.ts";

/** Cumulative per-job progress the server reports between batches. */
export interface ScanProgress {
  messagesSeen: number;
  candidates: number;
}

/** The response body `POST /api/gmail/sync` returns for one batch. */
export interface ScanBatchPayload {
  done?: boolean;
  window?: unknown;
  /** The window the client asked for. Equal to `window` in every normal case. */
  requestedWindow?: unknown;
  /**
   * Whether this batch traversed the mailbox window or diffed a history anchor.
   *
   * The difference matters to the user: with traversal, `messagesListed === 0`
   * genuinely means "Gmail matched nothing in that period". Without it, a zero
   * would only have meant "nothing arrived since last time" — which is exactly
   * how the scan used to report nothing for a mailbox full of matching mail.
   */
  windowTraversed?: boolean;
  created?: number;
  updated?: number;
  messagesListed?: number;
  messagesDeduplicated?: number;
  messagesFresh?: number;
  /**
   * Application-related messages in the scanned window, counted from the ledger.
   *
   * The server's own figure, and NOT this batch's fresh classifications: those are
   * structurally 0 on a repeat scan, where dedup correctly absorbs the whole
   * listing, which is how "528 read / 0 application-related" was produced.
   */
  applicationRelated?: number | null;
  /** Job opportunities in the ledger — alerts/recommendations, not applications. */
  opportunitiesFound?: number | null;
  /** Legacy rows still awaiting an Evidence Gate verdict. */
  legacyRemaining?: number | null;
  /** Why the import produced what it did. Counts and codes only. */
  importOutcome?: {
    examined?: number;
    created?: number;
    linked?: number;
    updated?: number;
    heldAmbiguous?: number;
    heldUnknownEmployer?: number;
    proposalsFailed?: number;
    bodyEscalated?: number;
    bodyResolved?: number;
  };
  /** Whether a finished scan left a usable sync point. Null while running. */
  anchorEstablished?: boolean | null;
  progress?: ScanProgress;
  notice?: string | null;
  error?: string;
  reconnectRequired?: boolean;
  retryable?: boolean;
}

/**
 * What the scan reported across its batches.
 *
 * Every field is `null` until a batch actually reports a figure. Null means "not
 * reported" and is rendered as "—"; it is never shown as a zero, which would
 * claim the scan did nothing.
 */
export interface ScanRunTotals {
  created: number | null;
  updated: number | null;
  listed: number | null;
  deduplicated: number | null;
  fresh: number | null;
  /**
   * Application-related messages in the scanned window.
   *
   * Window-wide and reported by the server, so the newest value REPLACES the
   * previous one rather than being summed — summing a window total across batches
   * would multiply it. Falls back to the cumulative per-job classification counter
   * only when the server could not count the ledger.
   */
  candidates: number | null;
}

const EMPTY_TOTALS: ScanRunTotals = {
  created: null,
  updated: null,
  listed: null,
  deduplicated: null,
  fresh: null,
  candidates: null,
};

/** Hard stop so a server bug can never spin the browser forever. */
export const MAX_SCAN_BATCHES = 400;

export type ScanRunOutcome =
  | {
      status: "done";
      /** The window the run actually sent on every batch. */
      window: ScanWindow;
      totals: ScanRunTotals;
      /**
       * Whether the server traversed the mailbox window. False only if a batch
       * explicitly reported otherwise, so the default assumption is never used to
       * make a stronger claim than the server made.
       */
      windowTraversed: boolean;
      /** The importer's summed outcome, so a zero can be explained. */
      importOutcome: ImportOutcomeTotals;
      /** Rows still awaiting a gate verdict when the run finished. */
      legacyRemaining: number | null;
      /** The final batch's server notice, when it sent one. */
      notice: string | null;
    }
  | {
      status: "paused";
      window: ScanWindow;
      totals: ScanRunTotals;
      windowTraversed: boolean;
      importOutcome: ImportOutcomeTotals;
      legacyRemaining: number | null;
    };

/** Live updates a caller renders while the loop runs. */
export interface ScanRunHandlers {
  /** The window the SERVER says it scanned, already narrowed. */
  onWindowReported?: (window: ScanWindow) => void;
  onTotals?: (totals: ScanRunTotals) => void;
  onProgress?: (progress: ScanProgress) => void;
  onNotice?: (notice: string) => void;
  /** Called before the throw when the connection needs re-authorising. */
  onReconnectRequired?: () => void;
}

export type ScanBatchPoster = (
  window: ScanWindow
) => Promise<{ ok: boolean; data: ScanBatchPayload }>;

/** The real request. Kept behind a parameter so the loop stays testable. */
async function postScanBatch(
  window: ScanWindow
): Promise<{ ok: boolean; data: ScanBatchPayload }> {
  const response = await fetch("/api/gmail/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // `intent` is stated rather than left to the server default. Pressing Scan
    // means "read the complete window I selected", every time, and the request
    // says so out loud: the previous behaviour — where the server inferred an
    // anchored diff from earlier scans and listed nothing — is not something a
    // caller should be able to fall into by omission.
    body: JSON.stringify({ window, intent: "full_window" }),
  });

  const data = (await response.json().catch(() => ({}))) as ScanBatchPayload;
  return { ok: response.ok, data };
}

/**
 * Run batches until the server says the scan is finished.
 *
 * Throws when a batch fails, with the server's own message where it gave one.
 * The caller renders that; nothing here touches React.
 */
export async function runScanBatches(args: {
  /** Captured once by the caller, sent unchanged on every batch. */
  window: ScanWindow;
  handlers?: ScanRunHandlers;
  postBatch?: ScanBatchPoster;
}): Promise<ScanRunOutcome> {
  const { window, handlers } = args;
  const postBatch = args.postBatch ?? postScanBatch;

  const totals: ScanRunTotals = { ...EMPTY_TOTALS };
  // Assumed true, downgraded only by a batch that explicitly says otherwise, so a
  // server that omits the field is never credited with a claim it did not make in
  // the other direction either.
  let windowTraversed = true;
  // Summed across batches: each batch reports what its own importer did.
  const importOutcome: ImportOutcomeTotals = {
    examined: 0,
    created: 0,
    linked: 0,
    updated: 0,
    heldAmbiguous: 0,
    heldUnknownEmployer: 0,
    proposalsFailed: 0,
  };
  // A window-wide figure, so the newest report replaces the previous one.
  let legacyRemaining: number | null = null;

  for (let batch = 0; batch < MAX_SCAN_BATCHES; batch += 1) {
    // Sequential by design: one request in flight at a time.
    const { ok, data } = await postBatch(window);

    if (!ok) {
      if (data.reconnectRequired) handlers?.onReconnectRequired?.();
      throw new Error(data.error ?? "The scan could not continue.");
    }

    // What the server says it scanned. Narrowed rather than trusted, so an
    // unexpected value never reaches state typed as a window.
    if (isScanWindow(data.window)) handlers?.onWindowReported?.(data.window);

    if (data.windowTraversed === false) windowTraversed = false;

    // Per-batch counts accumulated into the run total. A batch that reports no
    // figure leaves the total untouched rather than adding a zero.
    if (typeof data.created === "number") {
      totals.created = (totals.created ?? 0) + data.created;
    }
    if (typeof data.updated === "number") {
      totals.updated = (totals.updated ?? 0) + data.updated;
    }
    if (typeof data.messagesListed === "number") {
      totals.listed = (totals.listed ?? 0) + data.messagesListed;
    }
    if (typeof data.messagesDeduplicated === "number") {
      totals.deduplicated = (totals.deduplicated ?? 0) + data.messagesDeduplicated;
    }
    if (typeof data.messagesFresh === "number") {
      totals.fresh = (totals.fresh ?? 0) + data.messagesFresh;
    }
    if (data.progress) {
      // Cumulative job counters, so the newest report replaces the previous one
      // instead of being summed.
      totals.candidates = data.progress.candidates;
      handlers?.onProgress?.(data.progress);
    }

    // The window-wide ledger figure outranks the per-job classification counter
    // whenever the server reports it. Replaced, never accumulated: it already
    // describes the whole window.
    if (typeof data.applicationRelated === "number") {
      totals.candidates = data.applicationRelated;
    }

    if (typeof data.legacyRemaining === "number") {
      legacyRemaining = data.legacyRemaining;
    }

    if (data.importOutcome) {
      const outcome = data.importOutcome;
      importOutcome.examined += outcome.examined ?? 0;
      importOutcome.created += outcome.created ?? 0;
      importOutcome.linked += outcome.linked ?? 0;
      importOutcome.updated += outcome.updated ?? 0;
      importOutcome.heldAmbiguous += outcome.heldAmbiguous ?? 0;
      importOutcome.heldUnknownEmployer += outcome.heldUnknownEmployer ?? 0;
      importOutcome.proposalsFailed += outcome.proposalsFailed ?? 0;
    }

    handlers?.onTotals?.({ ...totals });

    if (data.notice) handlers?.onNotice?.(data.notice);

    if (data.done) {
      return {
        status: "done",
        window,
        totals: { ...totals },
        windowTraversed,
        importOutcome: { ...importOutcome },
        legacyRemaining,
        notice: data.notice ?? null,
      };
    }
  }

  return {
    status: "paused",
    window,
    totals: { ...totals },
    windowTraversed,
    importOutcome: { ...importOutcome },
    legacyRemaining,
  };
}

/**
 * What a finished scan is allowed to claim, given the three counts the server
 * reported for it.
 *
 * Moved verbatim from `TrackMyJobsWorkspace`, where the old copy was the actual
 * bug on that screen: a scan that listed 2,272 messages and found every one of
 * them already tracked said "Scan complete", with a 0 next to "emails scanned",
 * which reads as "Gmail is empty". These are three genuinely different outcomes
 * and each gets its own sentence.
 *
 * A null count means "not reported", and stays unreported: it is never
 * substituted with a zero.
 */
export function describeScanOutcome(args: {
  listed: number | null;
  deduplicated: number | null;
  fresh: number | null;
  windowDays: number;
  /**
   * Whether the server traversed the whole window. Defaults to true because that
   * is the contract for an explicit scan; passing false is what keeps a zero from
   * being described as "Gmail matched nothing" when the window was never read.
   */
  windowTraversed?: boolean;
}): { headline: string; detail: string | null } {
  const { listed, deduplicated, fresh, windowDays } = args;
  const windowTraversed = args.windowTraversed ?? true;

  // Nothing reported at all: say only what is known.
  if (listed === null) {
    return { headline: "Scan complete. Here is what it did.", detail: null };
  }

  if (listed === 0) {
    // A zero from a batch that never traversed the window says nothing about the
    // window, and must not be reported as though it did. This is the exact claim
    // the old scan made wrongly for every repeat scan.
    if (!windowTraversed) {
      return {
        headline: "Scan complete. No new mail arrived since your last scan.",
        detail: `This pass checked only what changed since the last scan, so it does not describe the whole ${windowDays}-day period.`,
      };
    }

    return {
      headline: `Scan complete. Gmail matched no messages in the last ${windowDays} days.`,
      detail:
        "Nothing was listed to read. A longer window may reach further back, and Spam, Trash and Promotions are always skipped.",
    };
  }

  if (fresh === 0 && deduplicated === listed) {
    return {
      headline: "No new mail since your last scan.",
      detail: `${deduplicated.toLocaleString()} message${
        deduplicated === 1 ? " was" : "s were"
      } already tracked.`,
    };
  }

  if (fresh !== null && fresh > 0) {
    const already =
      deduplicated !== null && deduplicated > 0
        ? ` ${deduplicated.toLocaleString()} were already tracked.`
        : "";
    return {
      headline: "Scan complete. Here is what it did.",
      detail: `${fresh.toLocaleString()} new message${
        fresh === 1 ? "" : "s"
      } read from ${listed.toLocaleString()} listed.${already}`,
    };
  }

  // Listed something, but the fresh count itself was never reported. Report the
  // listing and nothing more.
  return {
    headline: "Scan complete. Here is what it did.",
    detail: `${listed.toLocaleString()} message${
      listed === 1 ? "" : "s"
    } listed in the last ${windowDays} days.`,
  };
}

/** The importer's outcome for a run, accumulated across batches. */
export interface ImportOutcomeTotals {
  examined: number;
  created: number;
  linked: number;
  updated: number;
  heldAmbiguous: number;
  heldUnknownEmployer: number;
  proposalsFailed: number;
}

/**
 * Why a scan that found application-related mail persisted nothing.
 *
 * Returns null when there is nothing to explain — either applications WERE
 * created/linked/updated, or no application-related mail was found in the first
 * place, in which case the outcome line already says so.
 *
 * This exists because the failure was invisible for several rounds: the UI showed
 * a successful scan with `created 0` whether the importer had read no eligible
 * evidence, deliberately held it, or attempted writes that the database rejected.
 * Those are completely different situations and the user is told which.
 *
 * Pure, so the wording is testable and cannot drift from the counters it reads.
 */
export function explainNoImports(args: {
  applicationRelated: number | null;
  outcome: ImportOutcomeTotals | null;
  /** Rows still awaiting an Evidence Gate verdict. */
  legacyRemaining: number | null;
}): string | null {
  const { applicationRelated, outcome } = args;

  // Nothing found, or nothing reported: the outcome line covers it.
  if (applicationRelated === null || applicationRelated === 0) return null;
  if (outcome === null) return null;

  const persisted = outcome.created + outcome.linked + outcome.updated;
  if (persisted > 0) return null;

  // Writes were attempted and rejected. The most serious case, and the one that
  // must never be reported as a clean scan.
  if (outcome.proposalsFailed > 0) {
    return `${outcome.proposalsFailed.toLocaleString()} application${
      outcome.proposalsFailed === 1 ? "" : "s"
    } could not be saved. This is a database error, not a scan problem — the evidence is kept and the next scan will retry.`;
  }

  if (outcome.heldUnknownEmployer > 0) {
    return `${outcome.heldUnknownEmployer.toLocaleString()} message${
      outcome.heldUnknownEmployer === 1 ? "" : "s"
    } carry real application evidence but no employer JobTrackOS is willing to name, so nothing was invented. They are listed under unknown applications.`;
  }

  if (outcome.heldAmbiguous > 0) {
    return `${outcome.heldAmbiguous.toLocaleString()} message${
      outcome.heldAmbiguous === 1 ? "" : "s"
    } were job-related but did not clearly evidence an application of yours, so no application was created from them.`;
  }

  if (outcome.examined === 0) {
    const pending =
      args.legacyRemaining !== null && args.legacyRemaining > 0
        ? ` ${args.legacyRemaining.toLocaleString()} older message${
            args.legacyRemaining === 1 ? " is" : "s are"
          } still being re-checked, so scan again to continue.`
        : "";
    return (
      "None of this mail evidenced a stage of an application — job-related is not the same as applied." +
      pending
    );
  }

  return "Nothing in this window resolved to an application.";
}

/**
 * The one-line count summary the scan module shows, e.g.
 * "243 Gmail messages processed · 18 application-related · 12 applications
 * created or updated".
 *
 * Message counts and application counts sit in the same sentence but are named
 * as what they are, so neither can be read as the other. Every segment comes
 * from a figure the scan actually reported; an unreported figure produces no
 * segment at all, and when nothing was reported the result is `null` and the
 * caller shows no summary line rather than a row of zeros.
 *
 * These numbers describe MESSAGES READ and RECORDS TOUCHED by one scan. They are
 * not, and must never be used as, the dashboard's application counts — those come
 * from `computeWindowReport` over the persisted `applications` rows.
 */
export function describeScanCounts(args: {
  messagesListed: number | null;
  applicationRelated: number | null;
  applicationsCreated: number | null;
  applicationsUpdated: number | null;
}): string | null {
  const segments: string[] = [];

  if (args.messagesListed !== null) {
    segments.push(
      `${args.messagesListed.toLocaleString()} Gmail message${
        args.messagesListed === 1 ? "" : "s"
      } processed`
    );
  }

  if (args.applicationRelated !== null) {
    segments.push(
      `${args.applicationRelated.toLocaleString()} application-related`
    );
  }

  if (args.applicationsCreated !== null || args.applicationsUpdated !== null) {
    const touched =
      (args.applicationsCreated ?? 0) + (args.applicationsUpdated ?? 0);
    segments.push(
      `${touched.toLocaleString()} application${
        touched === 1 ? "" : "s"
      } created or updated`
    );
  }

  return segments.length === 0 ? null : segments.join(" · ");
}

"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  DEFAULT_SCAN_WINDOW,
  isScanWindow,
  type ScanWindow,
} from "@/lib/gmail/query";
import {
  SCAN_WINDOW_OPTIONS,
  scanWindowDays,
} from "@/lib/gmail/scanWindowOptions";
import {
  describeScanCounts,
  describeScanOutcome,
  explainNoImports,
  runScanBatches,
  type ScanProgress,
  type ScanRunTotals,
} from "../scanRunner";

/** Persisted facts about the most recent scan job. Null fields stay unreported. */
export interface LatestScanView {
  /** `updated_at` of that job — the last moment it reported anything. */
  finishedAt: string | null;
  status: string | null;
  messagesSeen: number | null;
  /** Messages that job judged job-related. */
  candidates: number | null;
  applicationsCreated: number | null;
  applicationsUpdated: number | null;
}

/** Counts of the two exception surfaces that still live at /track-my-jobs. */
export interface ScanExceptionCounts {
  /**
   * Unknown_Bucket rows: real application evidence with no readable employer.
   *
   * The ONLY exception the primary flow surfaces. There is deliberately no
   * "needs approval" count here — see the note at `hasExceptions` below.
   */
  unknownEmployer: number;
}

interface GmailScanModuleProps {
  /** Resolved on the server, so no connection metadata reaches the browser. */
  connected: boolean;
  /** Last completed sync on the connection. */
  lastSyncAt: string | null;
  /** True when an interrupted job can be continued. */
  resumable: boolean;
  /** Progress already persisted for that open job. */
  initialProgress: ScanProgress | null;
  latestScan: LatestScanView | null;
  exceptions: ScanExceptionCounts;
  /**
   * Job opportunities in the ledger — alerts/recommendations, never
   * applications. Shown as a separate figure so it can never be read as an
   * application total.
   */
  opportunityCount: number;
}

function formatCount(value: number | null): string {
  return value === null ? "—" : value.toLocaleString();
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? "—" : new Date(parsed).toLocaleString();
}

/**
 * The Gmail scan module — the dashboard's one tracking control.
 *
 * Contains exactly the scan loop's surface: connection state, Connect Gmail,
 * window selection, Scan, live progress, the latest scan timestamp, an honest
 * completion summary, and a way back to the report. There is no manual
 * application selection and no review queue in the normal flow: the importer
 * organizes what it recognizes during the scan.
 *
 * The genuine exceptions it refuses to guess at — held proposals, unknown
 * employers, and the repair passes — still exist, at `/track-my-jobs`. That route
 * is no longer in the navigation; it is linked from here, and ONLY while its
 * counts are above zero, so an exception surface appears when there is an
 * exception and stays out of the way otherwise.
 *
 * Every number below is a figure the server reported or persisted. MESSAGE counts
 * and APPLICATION counts are rendered in separate labelled groups, and neither is
 * an input to any KPI: the dashboard's application figures are computed from the
 * `applications` table over the reporting window, independently of anything a
 * scan read.
 */
export default function GmailScanModule({
  connected,
  lastSyncAt,
  resumable,
  initialProgress,
  latestScan,
  exceptions,
  opportunityCount,
}: GmailScanModuleProps) {
  const router = useRouter();

  const [scanning, setScanning] = useState(false);
  /** How much mailbox the next scan reads. 30 days is the recommendation. */
  const [selectedWindow, setSelectedWindow] =
    useState<ScanWindow>(DEFAULT_SCAN_WINDOW);
  /** The window the SERVER reported for this session's scan. */
  const [scannedWindow, setScannedWindow] = useState<ScanWindow | null>(null);
  const [progress, setProgress] = useState<ScanProgress | null>(initialProgress);
  const [message, setMessage] = useState<string | null>(null);
  const [messageDetail, setMessageDetail] = useState<string | null>(null);
  /** The counts line for the run, e.g. "243 Gmail messages processed · …". */
  const [countsLine, setCountsLine] = useState<string | null>(null);
  /**
   * Why a scan that found application-related mail persisted nothing.
   *
   * Shown instead of letting a clean-looking "scan complete" hide the boundary
   * where the work actually stopped.
   */
  const [importNote, setImportNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [scanFinished, setScanFinished] = useState(false);
  /** What this session's scan reported. Null fields stay unreported. */
  const [liveTotals, setLiveTotals] = useState<ScanRunTotals | null>(null);

  const runScan = useCallback(async () => {
    setScanning(true);
    setError(null);
    setMessage(null);
    setMessageDetail(null);
    setCountsLine(null);
    setImportNote(null);
    setNeedsReconnect(false);
    setScanFinished(false);

    // Captured ONCE, before the first batch, so changing the selector mid-scan
    // cannot split one scan's cursor across two windows.
    const runWindow = selectedWindow;

    try {
      // Shared loop: sequential batches over one server-persisted cursor, a hard
      // batch cap, and counts that stay null until the server reports them.
      const result = await runScanBatches({
        window: runWindow,
        handlers: {
          onWindowReported: setScannedWindow,
          onTotals: setLiveTotals,
          onProgress: setProgress,
          onNotice: (notice) => {
            setMessage(notice);
            setMessageDetail(null);
          },
          onReconnectRequired: () => setNeedsReconnect(true),
        },
      });

      if (result.status === "paused") {
        setMessage("Scan paused after many batches. Scan again to continue.");
        setMessageDetail(null);
        router.refresh();
        return;
      }

      setScanFinished(true);

      const outcome = describeScanOutcome({
        listed: result.totals.listed,
        deduplicated: result.totals.deduplicated,
        fresh: result.totals.fresh,
        windowDays: scanWindowDays(runWindow),
        windowTraversed: result.windowTraversed,
      });
      // A server notice describes something that happened to the work itself (a
      // missing sync point, AI unavailable) and still wins; the derived outcome
      // line is then carried as the detail.
      const outcomeLine = outcome.detail
        ? `${outcome.headline} ${outcome.detail}`
        : outcome.headline;
      setMessage(result.notice ?? outcome.headline);
      setMessageDetail(result.notice ? outcomeLine : outcome.detail);
      setCountsLine(
        describeScanCounts({
          messagesListed: result.totals.listed,
          applicationRelated: result.totals.candidates,
          applicationsCreated: result.totals.created,
          applicationsUpdated: result.totals.updated,
        })
      );
      // If application-related mail was found and nothing was persisted, say
      // which boundary stopped it rather than showing a clean scan.
      setImportNote(
        explainNoImports({
          applicationRelated: result.totals.candidates,
          outcome: result.importOutcome,
          legacyRemaining: result.legacyRemaining,
        })
      );

      // Re-render the server component so the report above reflects whatever the
      // scan organized.
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "The scan failed.");
    } finally {
      setScanning(false);
    }
  }, [router, selectedWindow]);

  /**
   * Only genuine exceptions surface here, and the old review queue is not one.
   *
   * That queue was a manual APPROVAL step: job-related mail waiting for the user
   * to pick "Add as new / Merge / Ignore" before it could reach the dashboard.
   * The product has no such step — the importer organizes what it recognizes — so
   * linking to it from the primary flow told users their scan was incomplete
   * until they worked through a list. The route and its tooling still exist; it is
   * simply no longer presented as part of the normal workflow, and its count is
   * no longer even passed to this component.
   *
   * Unknown employer IS a genuine exception: real application evidence where no
   * employer could be determined. JobTrackOS refuses to invent one, so those are worth
   * showing — as information, not as a gate.
   */
  const hasExceptions = exceptions.unknownEmployer > 0;

  if (!connected) {
    return (
      <section className="rounded-md border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-text">Sync from Gmail</h2>
            <p className="mt-0.5 text-sm text-text-secondary">
              Connect Gmail so JobTrackOS can find and track applications you already
              made — automatically, read-only.
            </p>
          </div>
          <Link
            href="/settings/integrations"
            className="inline-flex shrink-0 items-center gap-2 rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover"
          >
            Connect Gmail
          </Link>
        </div>
      </section>
    );
  }

  // This session's figures win where they exist; otherwise the persisted ones
  // from the last scan are shown. Both stay null when neither exists.
  const messagesProcessed = liveTotals?.listed ?? latestScan?.messagesSeen ?? null;
  const applicationRelated =
    liveTotals?.candidates ?? latestScan?.candidates ?? null;
  const created = liveTotals?.created ?? latestScan?.applicationsCreated ?? null;
  const updated = liveTotals?.updated ?? latestScan?.applicationsUpdated ?? null;

  return (
    <section className="rounded-md border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-text">Sync &amp; update from Gmail</h2>
          <p className="mt-0.5 text-sm text-text-secondary">
            {lastSyncAt
              ? `Last updated ${formatDateTime(lastSyncAt)}`
              : latestScan?.finishedAt
                ? `Last updated ${formatDateTime(latestScan.finishedAt)}`
                : "Not synced yet"}
            {scannedWindow !== null &&
              ` · last ${scanWindowDays(scannedWindow)} days`}
          </p>
        </div>
        <Link
          href="/settings/integrations"
          className="text-xs font-medium text-text-muted transition-colors hover:text-text"
        >
          Manage
        </Link>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <select
          id="scan-window"
          value={selectedWindow}
          disabled={scanning}
          onChange={(event) => {
            const next = event.target.value;
            if (isScanWindow(next)) setSelectedWindow(next);
          }}
          aria-label="How far back to sync"
          className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-text disabled:cursor-not-allowed disabled:opacity-50"
        >
          {SCAN_WINDOW_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => void runScan()}
          disabled={scanning}
          className="rounded-md bg-accent px-3.5 py-1.5 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {scanning ? "Syncing..." : resumable ? "Resume sync" : "Track applications"}
        </button>

        {/* Compact, always-visible counts — the detail an interested user can
            check without a separate report. Never styled larger than the
            controls beside them. */}
        {(messagesProcessed !== null || created !== null || updated !== null) && (
          <span className="ml-auto text-xs text-text-muted">
            {formatCount(applicationRelated)} application-related ·{" "}
            {formatCount(created)} created · {formatCount(updated)} updated
            {opportunityCount > 0 && ` · ${formatCount(opportunityCount)} opportunities found`}
          </span>
        )}
      </div>

      {scanning && (
        <div className="mt-3 flex items-center gap-2.5">
          <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-border-strong border-t-accent" />
          <p className="text-xs text-text-secondary">
            Read {progress?.messagesSeen ?? 0} emails, {progress?.candidates ?? 0}{" "}
            look job-related. You can leave this page.
          </p>
        </div>
      )}

      {message && (
        <div className="mt-3 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-secondary">
          <p>{message}</p>
          {messageDetail && (
            <p className="mt-1 text-xs text-text-muted">{messageDetail}</p>
          )}
          {countsLine && (
            <p className="mt-1 text-xs text-text-muted">{countsLine}</p>
          )}
          {importNote && (
            <p className="mt-2 rounded-sm border border-warning/20 bg-warning-bg px-2 py-1.5 text-xs text-warning">
              {importNote}
            </p>
          )}
          {scanFinished && (
            <a
              href="#reporting"
              className="mt-2.5 inline-flex rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg transition-colors hover:bg-accent-hover"
            >
              View dashboard
            </a>
          )}
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-md border border-danger/20 bg-danger-bg px-3 py-2 text-sm text-danger">
          {error}
          {needsReconnect && (
            <>
              {" "}
              <Link href="/settings/integrations" className="underline">
                Reconnect Gmail
              </Link>
            </>
          )}
        </p>
      )}

      {/* The exception surface still lives at /track-my-jobs. Linked only while
          there is genuinely something waiting — never a required approval step. */}
      {hasExceptions && (
        <div className="mt-3 border-t border-border pt-3">
          <Link
            href="/track-my-jobs#unknown"
            className="text-xs font-medium text-warning underline-offset-2 hover:underline"
          >
            {exceptions.unknownEmployer} application{exceptions.unknownEmployer === 1 ? "" : "s"} need a company name
          </Link>
        </div>
      )}
    </section>
  );
}

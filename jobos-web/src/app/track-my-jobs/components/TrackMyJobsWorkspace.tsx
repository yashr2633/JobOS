"use client";

import { useCallback, useState } from "react";
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
// The batch loop and the completion wording live in one module now, shared with
// the dashboard's scan module, so the two surfaces cannot drift apart.
import {
  describeScanOutcome,
  runScanBatches,
} from "@/app/dashboard/scanRunner";
// Display-only label maps over the real reason/category vocabularies, kept in
// their own module so they are unit-testable.
import { categoryLabel, reasonLabel } from "../labels";

/**
 * Results-first scan workspace.
 *
 * Section order, top to bottom:
 *   1. Scan controls
 *   2. What this scan did          — created / updated / scanned / excluded
 *   3. Needs your input            — held proposals only
 *   4. Unknown applications (N)    — compact evidence rows, employer field each
 *   5. Recently organized automatically (collapsed) — per-row "Not mine"
 *
 * It drives the batch loop: POST /api/gmail/sync repeatedly until the server
 * reports `done`, rendering real progress between batches. Every batch persists
 * its cursor server-side, so closing this page loses nothing.
 *
 * There is no approve-everything step. Ordinary applications were already
 * organized during the scan; each row here applies its own decision immediately
 * and refreshes the server view.
 *
 * Holds no Gmail tokens, performs no Supabase queries, and renders no email
 * subject, snippet, or body.
 */

/**
 * Counts for the results panel. Null means the number is genuinely unknown and
 * is rendered as "—", never as a zero that would read as "nothing happened".
 *
 * `created` / `updated` are the LAST SCAN's own delta, read from the persisted
 * job. `scanned` / `excluded` are cumulative ledger facts, because a scan that
 * finds every listed message already processed does no work at all and would
 * otherwise report an empty window as an empty mailbox.
 */
export interface ScanSummaryView {
  created: number | null;
  updated: number | null;
  scanned: number | null;
  excluded: number | null;
}

/** A proposal the importer declined to act on. Still answerable. */
export interface HeldProposalView {
  key: string;
  activityIds: string[];
  /** The EMPLOYER. Null when none could be determined — never a portal name. */
  company: string | null;
  jobTitle: string | null;
  /** Source platform (LinkedIn, Naukri, ...). Separate from `company`. */
  jobPortal: string | null;
  location: string | null;
  appliedDate: string | null;
  lastActivityAt: string | null;
  status: string;
  confidence: number | null;
  evidenceCount: number;
  suggestedApplicationId: string | null;
  /** Fixed reason code from the decision table. Never email text. */
  reason: string;
}

/** One Unknown-bucket row. Compact evidence only — there is no text field. */
export interface UnknownEntryView {
  activityId: string;
  category: string;
  senderDomain: string | null;
  jobPortal: string | null;
  emailDate: string | null;
  reason: string | null;
  /** Status this entry's lifecycle category implies, resolved server-side. */
  status: string | null;
}

/** An application the importer created, linked, or updated. */
export interface OrganizedApplicationView {
  applicationId: string;
  company: string;
  role: string;
  status: string;
  jobPortal: string | null;
  appliedDate: string | null;
  activityIds: string[];
  lastActivityAt: string | null;
  evidenceCount: number;
}

export interface ExistingApplicationView {
  id: string;
  company: string;
  role: string;
}

interface Props {
  connected: boolean;
  lastSyncAt: string | null;
  resumable: boolean;
  initialProgress: {
    messagesSeen: number;
    candidates: number;
  } | null;
  scanSummary: ScanSummaryView;
  heldProposals: HeldProposalView[];
  unknownEntries: UnknownEntryView[];
  /** True bucket size, which can exceed the entries actually listed. */
  unknownTotal: number;
  organized: OrganizedApplicationView[];
  existingApplications: ExistingApplicationView[];
}

/** Decisions this workspace can post. Mirrors the import route's contract. */
type WorkspaceDecision =
  | {
      action: "import";
      activityIds: string[];
      company: string;
      role?: string;
      jobPortal?: string;
      location?: string;
      appliedDate?: string;
      status: string;
    }
  | {
      action: "merge";
      activityIds: string[];
      applicationId: string;
      status: string;
      lastActivityAt?: string;
    }
  | { action: "ignore"; activityIds: string[] }
  | { action: "reject"; activityIds: string[]; applicationId: string }
  | {
      action: "resolve_unknown";
      activityIds: string[];
      company: string;
      jobPortal?: string;
      appliedDate?: string;
      status?: string;
    };

function formatDate(value: string | null): string {
  if (!value) return "Unknown";
  const parsed = Date.parse(value);
  return Number.isFinite(parsed)
    ? new Date(parsed).toLocaleDateString()
    : "Unknown";
}

function formatCount(value: number | null): string {
  return value === null ? "—" : String(value);
}

/*
 * `describeScanOutcome` used to live here. It moved to
 * `@/app/dashboard/scanRunner` together with the batch loop, unchanged, so the
 * dashboard scan module and this workspace make identical claims about what a
 * scan did. Its "—" idiom for an unreported count matches `formatCount` above.
 */

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-md border border-border bg-bg p-4">
      <p className="text-2xl font-semibold text-text">{value}</p>
      <p className="mt-1 text-sm text-text-secondary">{label}</p>
      <p className="mt-1 text-xs text-text-muted">{hint}</p>
    </div>
  );
}

export default function TrackMyJobsWorkspace({
  connected,
  lastSyncAt,
  resumable,
  initialProgress,
  scanSummary,
  heldProposals,
  unknownEntries,
  unknownTotal,
  organized,
  existingApplications,
}: Props) {
  const router = useRouter();

  const [scanning, setScanning] = useState(false);
  /** How much mailbox the next scan will cover. 30 days is the recommendation. */
  const [selectedWindow, setSelectedWindow] =
    useState<ScanWindow>(DEFAULT_SCAN_WINDOW);
  /**
   * The window the server reported for the scan run in this session. Taken from
   * the response rather than from the selector, so a value the API coerced is
   * shown as what actually ran.
   */
  const [scannedWindow, setScannedWindow] = useState<ScanWindow | null>(null);
  const [progress, setProgress] = useState(initialProgress);
  const [message, setMessage] = useState<string | null>(null);
  /**
   * Second line of the same notice: the honest count behind the headline. Null
   * whenever there is no reported number to name, rather than a zero.
   */
  const [messageDetail, setMessageDetail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsReconnect, setNeedsReconnect] = useState(false);

  /**
   * What the scan run in THIS session reported. Summed from the per-batch counts
   * the server returned, never estimated from the rows on screen. Null until a
   * scan reports, so an unreported count stays unreported.
   */
  const [liveCreated, setLiveCreated] = useState<number | null>(null);
  const [liveUpdated, setLiveUpdated] = useState<number | null>(null);
  /** True once a scan run in this session reported `done`. */
  const [scanFinished, setScanFinished] = useState(false);

  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  /** Row currently applying a decision, so only its controls disable. */
  const [busyRow, setBusyRow] = useState<string | null>(null);

  const [mergeTargets, setMergeTargets] = useState<Record<string, string>>({});
  const [employerNames, setEmployerNames] = useState<Record<string, string>>({});
  const [showOrganized, setShowOrganized] = useState(false);
  /** True while the explicit repair pass is running. */
  const [repairing, setRepairing] = useState(false);
  /** True while the legacy re-gate loop is running. */
  const [regating, setRegating] = useState(false);

  /**
   * Run batches until the server says the scan is finished.
   *
   * Sequential by design: batches share one persisted cursor, so overlapping
   * requests would race it.
   */
  const runScan = useCallback(async () => {
    setScanning(true);
    setError(null);
    setMessage(null);
    setMessageDetail(null);
    setNeedsReconnect(false);
    setScanFinished(false);
    // Deliberately NOT seeded to 0: a scan that organizes nothing must keep
    // showing the server-persisted figure instead of overwriting it with a fresh
    // zero, and `0 ?? server` is 0.

    // Captured ONCE, before the first batch. Every batch of this scan sends this
    // same window, so changing the selector mid-scan cannot split one scan's
    // cursor across two different windows.
    const runWindow = selectedWindow;

    try {
      // The loop itself lives in `scanRunner`: sequential batches over one
      // persisted cursor, a hard batch cap, and null-preserving accumulation.
      const result = await runScanBatches({
        window: runWindow,
        handlers: {
          onWindowReported: setScannedWindow,
          onTotals: (totals) => {
            // Only a reported figure is written, so an unreported count keeps
            // showing the server-persisted one instead of a fresh zero.
            if (totals.created !== null) setLiveCreated(totals.created);
            if (totals.updated !== null) setLiveUpdated(totals.updated);
          },
          onProgress: setProgress,
          onNotice: (notice) => {
            setMessage(notice);
            setMessageDetail(null);
          },
          onReconnectRequired: () => setNeedsReconnect(true),
        },
      });

      if (result.status === "paused") {
        setMessage("Scan paused after many batches. Resume to continue.");
        setMessageDetail(null);
        router.refresh();
        return;
      }

      setScanFinished(true);
      // What the scan actually did, from the counts the server reported — never
      // inferred from the rows on screen, and never a zero standing in for a
      // number nobody reported.
      const outcome = describeScanOutcome({
        listed: result.totals.listed,
        deduplicated: result.totals.deduplicated,
        fresh: result.totals.fresh,
        windowDays: scanWindowDays(runWindow),
        windowTraversed: result.windowTraversed,
      });
      // A server notice describes something that happened to the work itself
      // (AI unavailable, a missing sync point) and still wins; the outcome line
      // is then carried as the detail.
      const outcomeLine = outcome.detail
        ? `${outcome.headline} ${outcome.detail}`
        : outcome.headline;
      setMessage(result.notice ?? outcome.headline);
      setMessageDetail(result.notice ? outcomeLine : outcome.detail);
      // Re-render the server component so the sections below reflect the rows
      // the scan organized.
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "The scan failed.");
    } finally {
      setScanning(false);
    }
  }, [router, selectedWindow]);

  /** Apply one decision immediately. There is no batched submit step. */
  const applyDecision = useCallback(
    async (rowKey: string, decision: WorkspaceDecision, success: string) => {
      setBusyRow(rowKey);
      setActionError(null);
      setActionNotice(null);

      try {
        const response = await fetch("/api/gmail/sync/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decisions: [decision] }),
        });

        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
        };

        if (!response.ok) {
          throw new Error(data.error ?? "That change could not be applied.");
        }

        setActionNotice(success);
        router.refresh();
      } catch (err: unknown) {
        setActionError(
          err instanceof Error ? err.message : "That change could not be applied."
        );
      } finally {
        setBusyRow(null);
      }
    },
    [router]
  );

  /**
   * Repair applications imported before JobTrackOS could read the portal, employer,
   * role, or status out of their evidence.
   *
   * Explicitly user-triggered: nothing runs this on a schedule. Safe to press
   * twice — a repaired value no longer matches a placeholder, so a second pass
   * reports nothing to do.
   */
  const runRepair = useCallback(async () => {
    setRepairing(true);
    setActionError(null);
    setActionNotice(null);

    try {
      const response = await fetch("/api/gmail/reconcile", { method: "POST" });

      const data = (await response.json().catch(() => ({}))) as {
        examined?: number;
        patched?: number;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "The repair could not be completed.");
      }

      const examined = data.examined ?? 0;
      const patched = data.patched ?? 0;
      const scope = `${examined} application${examined === 1 ? "" : "s"}`;

      setActionNotice(
        patched === 0
          ? `Checked ${scope}. Nothing needed repairing.`
          : `Repaired ${patched} of ${scope}.`
      );
      router.refresh();
    } catch (err: unknown) {
      setActionError(
        err instanceof Error ? err.message : "The repair could not be completed."
      );
    } finally {
      setRepairing(false);
    }
  }, [router]);

  /**
   * Re-check Gmail activity that was imported before the current evidence system
   * existed.
   *
   * Sequential like `runScan`, for the same reason: each batch reads the rows
   * that still need re-checking, so two overlapping requests would read and
   * write the same rows. One request in flight at a time, a hard batch cap so a
   * server bug cannot spin the browser, and a stop as soon as a batch re-checks
   * nothing — which is what happens when the only rows left are messages that no
   * longer exist in Gmail.
   */
  const runRegate = useCallback(async () => {
    setRegating(true);
    setActionError(null);
    setActionNotice(null);

    // Bounded: 100 rows per batch server-side, so this covers 5,000 rows.
    const MAX_BATCHES = 50;

    let reclassified = 0;
    let created = 0;
    let updated = 0;
    let awaitingReview = 0;
    let skipped = 0;
    let remaining = 0;

    try {
      for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
        const response = await fetch("/api/gmail/regate", { method: "POST" });

        const data = (await response.json().catch(() => ({}))) as {
          reclassified?: number;
          applicationsCreated?: number;
          applicationsUpdated?: number;
          awaitingReview?: number;
          skipped?: number;
          remaining?: number;
          error?: string;
          reconnectRequired?: boolean;
        };

        if (!response.ok) {
          throw new Error(
            data.error ?? "Older Gmail activity could not be re-checked."
          );
        }

        reclassified += data.reclassified ?? 0;
        created += data.applicationsCreated ?? 0;
        updated += data.applicationsUpdated ?? 0;
        awaitingReview += data.awaitingReview ?? 0;
        skipped += data.skipped ?? 0;
        remaining = data.remaining ?? 0;

        // Nothing left, or nothing this batch could move forward. Either way,
        // another identical request would do no more work.
        if (remaining <= 0 || (data.reclassified ?? 0) === 0) break;
      }

      const tail = [
        created > 0 ? `${created} application${created === 1 ? "" : "s"} created` : null,
        updated > 0 ? `${updated} updated` : null,
        awaitingReview > 0 ? `${awaitingReview} left for your review` : null,
        skipped > 0 ? `${skipped} skipped (no longer in Gmail)` : null,
        remaining > 0 ? `${remaining} still to check` : null,
      ]
        .filter((part): part is string => part !== null)
        .join(", ");

      setActionNotice(
        reclassified === 0
          ? "No older Gmail activity needed re-checking."
          : `Re-checked ${reclassified} older Gmail message${
              reclassified === 1 ? "" : "s"
            }${tail ? `: ${tail}` : ""}.`
      );
      // The scan's own completion CTA, reused: the dashboard owns reporting, so
      // a finished re-check points there instead of reporting here.
      setScanFinished(true);
      setMessage("Older Gmail activity re-checked. Here is what it did.");
      setMessageDetail(null);
      router.refresh();
    } catch (err: unknown) {
      setActionError(
        err instanceof Error
          ? err.message
          : "Older Gmail activity could not be re-checked."
      );
    } finally {
      setRegating(false);
    }
  }, [router]);

  if (!connected) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6">
        <h2 className="text-lg font-semibold text-text">Connect Gmail first</h2>
        <p className="mt-2 text-sm text-text-secondary">
          JobTrackOS needs read-only access to your Gmail before it can find your
          past applications.
        </p>
        <a
          href="/settings/integrations"
          className="mt-5 inline-flex rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-colors hover:bg-accent-hover"
        >
          Go to Integrations
        </a>
      </div>
    );
  }

  // A figure reported by the scan running in this session wins; otherwise the
  // persisted one from the last scan is shown. Both stay null when neither
  // exists, so nothing is invented.
  const created = liveCreated ?? scanSummary.created;
  const updated = liveUpdated ?? scanSummary.updated;
  // Day count of the current selection, read from the query module so there is
  // no second mapping of windows to days.
  const selectedWindowDays = scanWindowDays(selectedWindow);

  return (
    <div className="space-y-6">
      {/* 1. Scan controls ------------------------------------------------- */}
      <div className="rounded-lg border border-border bg-surface p-6">
        <h2 className="text-lg font-semibold text-text">
          What JobTrackOS will scan
        </h2>
        <ul className="mt-3 space-y-2 text-sm text-text-secondary">
          <li>• The last {selectedWindowDays} days of your mailbox.</li>
          <li>• Only messages that look job-related. Spam and Trash are skipped.</li>
          <li>• Read-only access. JobTrackOS never sends email as you.</li>
          <li>
            • <span className="text-text-secondary">Email bodies are not stored.</span>{" "}
            Only sender, subject-derived details, and dates are kept.
          </li>
          <li>
            • Applications JobTrackOS recognizes are organized for you. You are only
            asked about the uncertain ones.
          </li>
        </ul>

        <div className="mt-5 max-w-xs">
          <label
            htmlFor="scan-window"
            className="mb-1 block text-xs text-text-secondary"
          >
            How far back to scan
          </label>
          {/* Native select: keyboard operable by default, and the recommended
              option is marked in its own label rather than by styling alone.
              Locked while a scan runs, because that scan's window is already
              fixed. */}
          <select
            id="scan-window"
            value={selectedWindow}
            disabled={scanning}
            onChange={(event) => {
              const next = event.target.value;
              if (isScanWindow(next)) setSelectedWindow(next);
            }}
            className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-text disabled:cursor-not-allowed disabled:opacity-50"
          >
            {SCAN_WINDOW_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={runScan}
            disabled={scanning}
            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {scanning
              ? "Scanning..."
              : resumable
                ? "Resume scan"
                : "Start scan"}
          </button>

          <span className="text-xs text-text-muted">
            {lastSyncAt
              ? `Last synced ${new Date(lastSyncAt).toLocaleString()}`
              : "Not synced yet"}
            {/* The window the server reported for this session's scan, so a
                coerced request is visible as what actually ran. */}
            {scannedWindow !== null &&
              ` · scanned the last ${scanWindowDays(scannedWindow)} days`}
          </span>
        </div>

        {scanning && (
          <div className="mt-4 flex items-start gap-3">
            <div className="mt-0.5 h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-border-strong border-t-blue-500" />
            <div>
              <p className="text-sm font-medium text-text">
                Scanning your Gmail for applications…
              </p>
              <p className="mt-0.5 text-sm text-text-secondary">
                This can take a little while depending on your mailbox size. You
                can leave this page — the scan resumes where it stopped.
              </p>
              <p className="mt-1 text-xs text-text-muted">
                Scanned {progress?.messagesSeen ?? 0} emails,{" "}
                {progress?.candidates ?? 0} look job-related.
              </p>
            </div>
          </div>
        )}

        {message && (
          <div className="mt-4 rounded-md border border-accent/20 bg-accent/10 px-3 py-2 text-sm text-accent">
            <p>{message}</p>
            {/* The count behind the headline, on its own line. Shown only when
                the server actually reported it. */}
            {messageDetail && (
              <p className="mt-1 text-xs text-accent/80">{messageDetail}</p>
            )}
            {/* Track My Jobs stays tracking-focused; the dashboard owns
                reporting, so a finished scan points there rather than growing a
                reporting section of its own. */}
            {scanFinished && (
              <a
                href="/"
                className="mt-3 inline-flex rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-colors hover:bg-accent-hover"
              >
                View dashboard
              </a>
            )}
          </div>
        )}

        {error && (
          <p className="mt-4 rounded-md border border-danger/20 bg-danger-bg px-3 py-2 text-sm text-danger">
            {error}
            {needsReconnect && (
              <>
                {" "}
                <a href="/settings/integrations" className="underline">
                  Reconnect Gmail
                </a>
              </>
            )}
          </p>
        )}
      </div>

      {/* 2. What this scan did -------------------------------------------- */}
      <div className="rounded-lg border border-border bg-surface p-6">
        <h2 className="text-lg font-semibold text-text">
          What JobTrackOS has organized
        </h2>
        <p className="mt-1 text-sm text-text-muted">
          Results, not requests. The first two tiles are what the last scan did;
          the last two cover everything JobTrackOS has read for you so far.
        </p>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Applications created"
            value={formatCount(created)}
            hint="Added automatically by the last scan"
          />
          <Stat
            label="Applications updated"
            value={formatCount(updated)}
            hint="Status moved by the last scan"
          />
          <Stat
            label="Emails scanned"
            value={formatCount(scanSummary.scanned)}
            hint="Messages read in your tracked history"
          />
          <Stat
            label="Emails excluded"
            value={formatCount(scanSummary.excluded)}
            hint="Alerts, promotions, notifications, all time"
          />
        </div>

        {created === null && updated === null && (
          <p className="mt-4 text-xs text-text-muted">
            Created and updated counts come from a scan. Run one to see them.
          </p>
        )}
      </div>

      {(actionNotice || actionError) && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            actionError
              ? "border-danger/20 bg-danger-bg text-danger"
              : "border-success/20 bg-success-bg text-success"
          }`}
        >
          {actionError ?? actionNotice}
        </div>
      )}

      {/* 3. Needs your input --------------------------------------------- */}
      <div className="rounded-lg border border-border bg-surface p-6">
        <h2 className="text-lg font-semibold text-text">
          Needs your input
          {heldProposals.length > 0 && (
            <span className="ml-2 text-sm font-normal text-text-secondary">
              ({heldProposals.length})
            </span>
          )}
        </h2>
        <p className="mt-1 text-sm text-text-muted">
          Genuine exceptions only — cases JobTrackOS refused to guess at.
        </p>

        {heldProposals.length === 0 ? (
          <p className="mt-4 text-sm text-text-muted">
            Nothing needs you right now.
          </p>
        ) : (
          <div className="mt-5 space-y-3">
            {heldProposals.map((proposal) => {
              const busy = busyRow === proposal.key;
              const mergeTarget =
                mergeTargets[proposal.key] ??
                proposal.suggestedApplicationId ??
                "";

              return (
                <div
                  key={proposal.key}
                  className="rounded-md border border-border bg-bg p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      {/* Company is the employer. When it could not be
                          determined it shows as unknown rather than silently
                          displaying the source platform in its place. */}
                      <p className="font-medium text-text">
                        {proposal.company ?? "Employer not determined"}
                      </p>
                      <p className="mt-0.5 text-sm text-text-secondary">
                        {proposal.jobTitle ?? "Role not stated"}
                      </p>
                      <p className="mt-1 text-xs text-text-muted">
                        Applied {formatDate(proposal.appliedDate)} · last activity{" "}
                        {formatDate(proposal.lastActivityAt)} ·{" "}
                        {proposal.evidenceCount} email
                        {proposal.evidenceCount === 1 ? "" : "s"}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                        <span className="rounded-full border border-border-strong px-2 py-0.5 text-text-secondary">
                          {proposal.status}
                        </span>
                        {/* Source, shown as its own labelled field so it can
                            never be mistaken for the employer. */}
                        {proposal.jobPortal && (
                          <span className="text-text-muted">
                            via {proposal.jobPortal}
                          </span>
                        )}
                        <span className="text-warning">
                          {reasonLabel(proposal.reason)}
                        </span>
                        {proposal.confidence !== null && (
                          <span className="text-text-muted">
                            confidence {(proposal.confidence * 100).toFixed(0)}%
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={busy || proposal.company === null}
                        title={
                          proposal.company === null
                            ? "Name the employer in Unknown applications below"
                            : undefined
                        }
                        onClick={() => {
                          const company = proposal.company;
                          if (company === null) return;
                          void applyDecision(
                            proposal.key,
                            {
                              action: "import",
                              activityIds: proposal.activityIds,
                              company,
                              role: proposal.jobTitle ?? undefined,
                              // Sent separately from company so the source
                              // platform is recorded in job_portal.
                              jobPortal: proposal.jobPortal ?? undefined,
                              location: proposal.location ?? undefined,
                              appliedDate: proposal.appliedDate
                                ? proposal.appliedDate.slice(0, 10)
                                : undefined,
                              status: proposal.status,
                            },
                            `Added ${company}.`
                          );
                        }}
                        className="rounded-md border border-border-strong px-3 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Add as new
                      </button>

                      <button
                        type="button"
                        disabled={busy || mergeTarget === ""}
                        onClick={() =>
                          void applyDecision(
                            proposal.key,
                            {
                              action: "merge",
                              activityIds: proposal.activityIds,
                              applicationId: mergeTarget,
                              // The resolved status and the timestamp of its
                              // newest evidence: without both, the server cannot
                              // apply the status on merge.
                              status: proposal.status,
                              lastActivityAt: proposal.lastActivityAt ?? undefined,
                            },
                            "Merged into the existing application."
                          )
                        }
                        className="rounded-md border border-border-strong px-3 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Merge
                      </button>

                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void applyDecision(
                            proposal.key,
                            {
                              action: "ignore",
                              activityIds: proposal.activityIds,
                            },
                            "Ignored. It will not come back."
                          )
                        }
                        className="rounded-md border border-border-strong px-3 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Ignore
                      </button>
                    </div>
                  </div>

                  {existingApplications.length > 0 && (
                    <div className="mt-3">
                      <label
                        htmlFor={`merge-${proposal.key}`}
                        className="mb-1 block text-xs text-text-secondary"
                      >
                        Merge into
                      </label>
                      <select
                        id={`merge-${proposal.key}`}
                        value={mergeTarget}
                        onChange={(event) =>
                          setMergeTargets((current) => ({
                            ...current,
                            [proposal.key]: event.target.value,
                          }))
                        }
                        className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-text"
                      >
                        <option value="">Select an application…</option>
                        {existingApplications.map((application) => (
                          <option key={application.id} value={application.id}>
                            {application.company} — {application.role}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 4. Unknown applications ----------------------------------------- */}
      <div
        id="unknown"
        className="scroll-mt-6 rounded-lg border border-border bg-surface p-6"
      >
        <h2 className="text-lg font-semibold text-text">
          Unknown applications ({unknownTotal})
        </h2>
        <p className="mt-1 text-sm text-text-muted">
          These emails are about a real application, but the employer could not
          be read from them. Name the employer and JobTrackOS will track it.
        </p>

        {unknownEntries.length === 0 ? (
          <p className="mt-4 text-sm text-text-muted">
            No unknown applications. Everything JobTrackOS recognized had an employer.
          </p>
        ) : (
          <div className="mt-5 space-y-3">
            {unknownEntries.map((entry) => {
              const busy = busyRow === entry.activityId;
              const employer = employerNames[entry.activityId] ?? "";

              return (
                <div
                  key={entry.activityId}
                  className="rounded-md border border-border bg-bg p-4"
                >
                  {/* Compact evidence only: category, sender domain, portal,
                      date, reason code. Never a full application card, and
                      never any email text. */}
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full border border-border-strong px-2 py-0.5 text-text-secondary">
                      {categoryLabel(entry.category)}
                    </span>
                    <span className="text-text-secondary">
                      {entry.senderDomain ?? "unknown sender"}
                    </span>
                    {entry.jobPortal && (
                      <span className="text-text-muted">via {entry.jobPortal}</span>
                    )}
                    <span className="text-text-muted">
                      {formatDate(entry.emailDate)}
                    </span>
                    <span className="text-warning">
                      {reasonLabel(entry.reason)}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <div className="min-w-0 flex-1">
                      <label
                        htmlFor={`employer-${entry.activityId}`}
                        className="mb-1 block text-xs text-text-secondary"
                      >
                        Employer
                      </label>
                      <input
                        id={`employer-${entry.activityId}`}
                        type="text"
                        value={employer}
                        placeholder="Who did you apply to?"
                        onChange={(event) =>
                          setEmployerNames((current) => ({
                            ...current,
                            [entry.activityId]: event.target.value,
                          }))
                        }
                        className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted"
                      />
                    </div>

                    <button
                      type="button"
                      disabled={busy || employer.trim() === ""}
                      onClick={() =>
                        void applyDecision(
                          entry.activityId,
                          {
                            action: "resolve_unknown",
                            activityIds: [entry.activityId],
                            company: employer.trim(),
                            jobPortal: entry.jobPortal ?? undefined,
                            appliedDate: entry.emailDate
                              ? entry.emailDate.slice(0, 10)
                              : undefined,
                            status: entry.status ?? undefined,
                          },
                          `Tracking ${employer.trim()}.`
                        )
                      }
                      className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busy ? "Saving..." : "Track it"}
                    </button>
                  </div>
                </div>
              );
            })}

            {unknownTotal > unknownEntries.length && (
              <p className="text-xs text-text-muted">
                Showing the {unknownEntries.length} most recent of {unknownTotal}.
              </p>
            )}
          </div>
        )}
      </div>

      {/* 5. Recently organized automatically (collapsed) ------------------ */}
      <div className="rounded-lg border border-border bg-surface p-6">
        <button
          type="button"
          onClick={() => setShowOrganized((current) => !current)}
          aria-expanded={showOrganized}
          className="flex w-full flex-wrap items-center justify-between gap-3 text-left"
        >
          <span>
            <span className="block text-lg font-semibold text-text">
              Recently organized automatically ({organized.length})
            </span>
            <span className="mt-1 block text-sm text-text-muted">
              Already tracked. Open this only to correct a mistake.
            </span>
          </span>
          <span className="text-sm text-text-secondary">
            {showOrganized ? "Hide" : "Show"}
          </span>
        </button>

        {/* Explicit repair. Small, and deliberately here: it corrects rows that
            were already organized, which is what this section is about. It runs
            only when pressed — never on a timer. Counts are reported through the
            same notice used by every other correction on this page. */}
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <button
            type="button"
            onClick={() => void runRepair()}
            disabled={repairing}
            className="rounded-md border border-border-strong px-3 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {repairing ? "Repairing..." : "Repair Gmail-imported applications"}
          </button>
          <span className="text-xs text-text-muted">
            Fills in missing employers, roles, sources, and statuses from emails
            already tracked.
          </span>
        </div>

        {/* Legacy re-gate. Also a corrective action on already-imported rows, so
            it belongs in this section rather than in a new one. Runs only when
            pressed, updates records in place, and reports through the same
            notice every other correction here uses. */}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void runRegate()}
            disabled={regating}
            className="rounded-md border border-border-strong px-3 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {regating ? "Re-checking..." : "Re-check older Gmail activity"}
          </button>
          <span className="text-xs text-text-muted">
            Re-checks older Gmail messages that were imported before JobTrackOS&apos;s
            current evidence system. Existing records are updated in place;
            nothing is deleted.
          </span>
        </div>

        {showOrganized &&
          (organized.length === 0 ? (
            <p className="mt-4 text-sm text-text-muted">
              Nothing has been organized from Gmail yet.
            </p>
          ) : (
            <div className="mt-5 space-y-3">
              {organized.map((application) => {
                const busy = busyRow === application.applicationId;

                return (
                  <div
                    key={application.applicationId}
                    className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border bg-bg p-4"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-text">
                        {application.company}
                      </p>
                      <p className="mt-0.5 text-sm text-text-secondary">
                        {application.role}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                        <span className="rounded-full border border-border-strong px-2 py-0.5 text-text-secondary">
                          {application.status}
                        </span>
                        {application.jobPortal && (
                          <span className="text-text-muted">
                            via {application.jobPortal}
                          </span>
                        )}
                        <span className="text-text-muted">
                          applied {formatDate(application.appliedDate)}
                        </span>
                        <span className="text-text-muted">
                          {application.evidenceCount} email
                          {application.evidenceCount === 1 ? "" : "s"}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void applyDecision(
                          application.applicationId,
                          {
                            action: "reject",
                            activityIds: application.activityIds,
                            applicationId: application.applicationId,
                          },
                          "Detached. Those emails will not be organized again."
                        )
                      }
                      className="rounded-md border border-border-strong px-3 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {busy ? "Working..." : "Not mine"}
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
      </div>
    </div>
  );
}

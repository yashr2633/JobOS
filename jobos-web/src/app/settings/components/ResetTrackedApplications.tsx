"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

import ConfirmDialog from "@/app/components/ConfirmDialog";
import SettingsCard from "./SettingsCard";

/** Must match `RESET_CONFIRMATION` on the route. */
const RESET_CONFIRMATION = "reset-tracked-gmail-applications";

interface ResetPreview {
  gmailApplications: number;
  manualApplications: number;
  activityRows: number;
}

interface ResetResult {
  deletedApplications: number;
  deletedActivityRows: number;
  deletedSyncJobs: number;
}

type Phase = "idle" | "loadingPreview" | "confirming" | "resetting" | "done";

/**
 * Reset tracked Gmail applications.
 *
 * The flow is deliberately two-step: the preview is fetched from the server
 * FIRST, so the confirmation states the real number of records rather than a
 * vague warning. That matters because the historical backfill in the Sprint 12
 * migration cannot perfectly classify pre-existing rows (see that file), and a
 * real count is what lets the user judge before agreeing.
 *
 * Authorization is entirely server-side. This component's dialog is a courtesy;
 * the route re-derives the acting user from the session regardless.
 */
export default function ResetTrackedApplications() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [preview, setPreview] = useState<ResetPreview | null>(null);
  const [result, setResult] = useState<ResetResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openConfirmation = useCallback(async () => {
    setPhase("loadingPreview");
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/gmail/reset", { method: "GET" });
      const data = (await response.json().catch(() => ({}))) as
        | ResetPreview
        | { error?: string };

      if (!response.ok) {
        throw new Error(
          ("error" in data && data.error) ||
            "We could not check your tracked applications."
        );
      }

      setPreview(data as ResetPreview);
      setPhase("confirming");
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "We could not check your tracked applications."
      );
      setPhase("idle");
    }
  }, []);

  const runReset = useCallback(async () => {
    setPhase("resetting");
    setError(null);

    try {
      const response = await fetch("/api/gmail/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: RESET_CONFIRMATION }),
      });

      const data = (await response.json().catch(() => ({}))) as
        | ResetResult
        | { error?: string };

      if (!response.ok) {
        throw new Error(
          ("error" in data && data.error) || "The reset did not finish."
        );
      }

      setResult(data as ResetResult);
      setPreview(null);
      setPhase("done");

      // Re-render the server components so every count on screen is re-read from
      // the database rather than left as a stale client value.
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "The reset did not finish.");
      setPhase("confirming");
    }
  }, [router]);

  const busy = phase === "loadingPreview" || phase === "resetting";

  return (
    <>
      <SettingsCard
        title="Reset tracked applications"
        description="Removes the applications Gmail created for you and clears its scan history, so your next scan starts completely fresh."
        footer={
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void openConfirmation()}
              disabled={busy}
              className="min-h-[44px] rounded-md border border-danger/40 px-3.5 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger-bg disabled:cursor-not-allowed disabled:opacity-50"
            >
              {phase === "loadingPreview"
                ? "Checking..."
                : "Reset tracked applications"}
            </button>

            {phase === "done" && result && (
              <span role="status" className="text-sm text-success">
                Reset complete. Removed {result.deletedApplications}{" "}
                {result.deletedApplications === 1 ? "application" : "applications"}{" "}
                and {result.deletedActivityRows} tracked{" "}
                {result.deletedActivityRows === 1 ? "email" : "emails"}.
              </span>
            )}

            {error && phase === "idle" && (
              <span role="alert" className="text-sm text-danger">
                {error}
              </span>
            )}
          </div>
        }
      >
        <ul className="space-y-1.5 text-sm text-text-secondary">
          <li>
            <span className="font-medium text-text">Kept:</span> applications you
            added yourself, your resumes, your account, and your Gmail connection.
          </li>
          <li>
            <span className="font-medium text-text">Removed:</span> applications
            Gmail created, and the record of which emails it has already read.
          </li>
        </ul>
      </SettingsCard>

      <ConfirmDialog
        open={phase === "confirming" || phase === "resetting"}
        title="Reset tracked Gmail applications?"
        message="This permanently deletes the applications Gmail created for you. It cannot be undone."
        confirmLabel="Reset tracked applications"
        cancelLabel="Keep everything"
        busy={phase === "resetting"}
        onConfirm={() => void runReset()}
        onCancel={() => {
          setPhase("idle");
          setPreview(null);
          setError(null);
        }}
      >
        {/* Real counts, read from the server, so the user is agreeing to a known
            quantity rather than to an unspecified "some data". */}
        {preview && (
          <div className="space-y-3">
            <dl className="rounded-md border border-border bg-surface-2 px-3 py-2.5 text-sm">
              <div className="flex items-baseline justify-between gap-3 py-1">
                <dt className="text-danger">Applications to delete</dt>
                <dd className="font-semibold text-danger">
                  {preview.gmailApplications}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 py-1">
                <dt className="text-text-secondary">Tracked emails to clear</dt>
                <dd className="font-semibold text-text">{preview.activityRows}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 border-t border-border py-1 pt-2">
                <dt className="text-success">Your own applications, kept</dt>
                <dd className="font-semibold text-success">
                  {preview.manualApplications}
                </dd>
              </div>
            </dl>

            <p className="text-xs text-text-muted">
              Your Gmail account stays connected. Your next scan will re-read your
              mailbox from scratch.
            </p>

            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
          </div>
        )}
      </ConfirmDialog>
    </>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * Connection state as handed down from a server component.
 *
 * Intentionally a narrow, token-free shape: the server already knows whether
 * Gmail is connected, so this component never queries for it. That removes a
 * client-side data waterfall and keeps the Gmail data-access module (and its
 * token columns) out of the browser bundle entirely.
 *
 * `emailAddress` is the connected mailbox, not a credential — it is the one
 * field that lets a user with several Google accounts confirm the right inbox
 * is connected. It is nullable because capture is non-fatal, and the card then
 * shows the connection state on its own rather than inventing a placeholder.
 */
export interface GmailConnectionSummary {
  connectedAt: string;
  lastSyncAt: string | null;
  emailAddress: string | null;
}

interface GmailConnectButtonProps {
  connection: GmailConnectionSummary | null;
  /**
   * Day count of the default scan window, resolved by the server from the
   * Gmail query builder so this component never restates the number itself.
   */
  defaultWindowDays: number;
}

/**
 * Pinned locale and timezone.
 *
 * This component renders on the server and hydrates in the browser, so a
 * machine-dependent format would produce two different strings for the same
 * timestamp. Formatting in UTC keeps both passes identical.
 */
const TIMESTAMP_FORMAT = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

/** Format a stored ISO timestamp, or null when it cannot be parsed. */
function formatTimestamp(value: string | null): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return `${TIMESTAMP_FORMAT.format(new Date(parsed))} UTC`;
}

export default function GmailConnectButton({
  connection,
  defaultWindowDays,
}: GmailConnectButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<"connect" | "disconnect" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleConnect() {
    setBusy("connect");
    setError(null);

    try {
      // The server mints and stores the OAuth state, then hands back the
      // Google URL. The state itself never reaches this component.
      const response = await fetch("/api/gmail/oauth", { method: "POST" });
      const data = (await response.json().catch(() => ({}))) as {
        oauthUrl?: string;
        error?: string;
      };

      if (!response.ok || !data.oauthUrl) {
        throw new Error(data.error ?? "Could not start the Gmail connection.");
      }

      // Top-level navigation, required for an OAuth consent screen.
      window.location.assign(data.oauthUrl);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not connect Gmail.");
      setBusy(null);
    }
  }

  async function handleDisconnect() {
    setBusy("disconnect");
    setError(null);

    try {
      const response = await fetch("/api/gmail/disconnect", { method: "POST" });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error ?? "Could not disconnect Gmail.");
      }

      // Re-render the server component so the connected state comes from the
      // database rather than from optimistic local state.
      router.refresh();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Could not disconnect Gmail."
      );
    } finally {
      setBusy(null);
    }
  }

  const connectedAtLabel = formatTimestamp(connection?.connectedAt ?? null);
  const lastSyncLabel = formatTimestamp(connection?.lastSyncAt ?? null);

  return (
    <div className="space-y-4">
      {connection ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-md border border-success/20 bg-success-bg px-3 py-1.5">
            {/* A filled dot rather than an envelope glyph: the state is what
                matters here, and it reads at any size or contrast. */}
            <span
              className="h-2 w-2 shrink-0 rounded-full bg-success"
              aria-hidden="true"
            />
            <span className="text-sm font-medium text-success">Connected</span>
          </span>

          <button
            type="button"
            onClick={handleDisconnect}
            disabled={busy !== null}
            className="rounded-md border border-border-strong px-3.5 py-2 text-sm font-medium text-text transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "disconnect" ? "Disconnecting..." : "Disconnect Gmail"}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-1.5">
            <span
              className="h-2 w-2 shrink-0 rounded-full bg-text-muted"
              aria-hidden="true"
            />
            <span className="text-sm font-medium text-text-secondary">
              Not connected
            </span>
          </span>

          <button
            type="button"
            onClick={handleConnect}
            disabled={busy !== null}
            className="rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "connect" ? "Connecting..." : "Connect Gmail"}
          </button>
        </div>
      )}

      {connection && (
        <>
          <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            {connection.emailAddress && (
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-text-muted">
                  Mailbox
                </dt>
                <dd className="mt-1 break-all text-text">
                  {connection.emailAddress}
                </dd>
              </div>
            )}

            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-text-muted">
                Connected
              </dt>
              <dd className="mt-1 text-text">
                {connectedAtLabel ? (
                  <time dateTime={connection.connectedAt}>
                    {connectedAtLabel}
                  </time>
                ) : (
                  "Unknown"
                )}
              </dd>
            </div>

            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-text-muted">
                Last completed sync
              </dt>
              <dd className="mt-1 text-text">
                {lastSyncLabel && connection.lastSyncAt ? (
                  <time dateTime={connection.lastSyncAt}>{lastSyncLabel}</time>
                ) : (
                  "No sync has run yet"
                )}
              </dd>
            </div>

            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-text-muted">
                Default scan window
              </dt>
              <dd className="mt-1 text-text">
                Last {defaultWindowDays} days
              </dd>
            </div>
          </dl>

          <Link
            href="/track-my-jobs"
            className="inline-flex rounded-md text-sm font-medium text-accent underline-offset-2 hover:underline"
          >
            Run a scan
          </Link>
        </>
      )}

      {error && (
        <p className="rounded-md border border-danger/20 bg-danger-bg px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

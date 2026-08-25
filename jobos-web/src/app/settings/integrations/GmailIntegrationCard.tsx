/**
 * Client component for Gmail integration status.
 * 
 * Uses browser-local IndexedDB state instead of server connection.
 */

"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  getGmailIntegrationState,
  resetGmailScanData,
  disconnectGmailIntegration,
  type GmailIntegrationState,
} from "@/lib/gmail/browserStore";
import { requestGmailBrowserAccessToken } from "@/lib/gmail/browserOAuth";
import { DEFAULT_WINDOW_DAYS } from "@/lib/gmail/query";

export default function GmailIntegrationCard() {
  const router = useRouter();
  const [state, setState] = useState<GmailIntegrationState | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    async function loadState() {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        
        if (user) {
          const integrationState = await getGmailIntegrationState(user.id);
          setState(integrationState);
        }
      } catch (err) {
        console.error("Failed to load Gmail integration state:", err);
      } finally {
        setLoading(false);
      }
    }

    loadState();
  }, []);

  async function handleConnect() {
    setConnecting(true);
    setError(null);

    try {
      await requestGmailBrowserAccessToken();
      setError(null);
      // Redirect to dashboard to complete scan
      router.push("/#gmail-tracking");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not connect Gmail.");
    } finally {
      setConnecting(false);
    }
  }

  async function handleResetGmailData() {
    setResetting(true);
    setError(null);

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        throw new Error("Not authenticated");
      }

      // Reset scan data but preserve integration
      await resetGmailScanData(user.id);
      
      // Reload state - integration should still be active
      const newState = await getGmailIntegrationState(user.id);
      setState(newState);
      setShowResetConfirm(false);
      
      // Trigger page refresh to update UI
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("jobos:gmail-applications-changed"));
      }
      
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not reset Gmail data.");
    } finally {
      setResetting(false);
    }
  }

  async function handleDisconnectGmail() {
    setDisconnecting(true);
    setError(null);

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        throw new Error("Not authenticated");
      }

      // Fully disconnect Gmail integration
      await disconnectGmailIntegration(user.id);
      
      // Reload state - should now be disconnected
      setState(null);
      setShowDisconnectConfirm(false);
      
      // Trigger page refresh to update UI
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("jobos:gmail-applications-changed"));
      }
      
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not disconnect Gmail.");
    } finally {
      setDisconnecting(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6">
        <div className="flex items-start gap-4">
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-text">Gmail</h3>
            <p className="mt-1 text-sm text-text-secondary">
              Loading integration status...
            </p>
          </div>
        </div>
      </div>
    );
  }

  const initialized = state?.initialized ?? false;

  return (
    <div className="rounded-lg border border-border bg-surface p-6">
      <div className="flex items-start gap-4">
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-text">Gmail</h3>
          <p className="mt-1 text-sm text-text-secondary">
            Automatically track job applications from your Gmail inbox.
            JobTrackOS uses read-only access and never sends email.
          </p>

          {initialized && (
            <div className="mt-3 space-y-1">
              <p className="text-xs text-text-muted">
                <span className="font-medium">Status:</span> Connected for syncing
              </p>
              {state?.lastSuccessfulScanAt && (
                <p className="text-xs text-text-muted">
                  <span className="font-medium">Last synced:</span>{" "}
                  {new Date(state.lastSuccessfulScanAt).toLocaleString()}
                </p>
              )}
              {state?.lastScanWindow && (
                <p className="text-xs text-text-muted">
                  <span className="font-medium">Scan window:</span> Last {state.lastScanWindow}
                </p>
              )}
            </div>
          )}

          {error && (
            <p className="mt-3 text-sm text-danger">{error}</p>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {initialized ? (
          <>
            <a
              href="/#gmail-tracking"
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover"
            >
              Sync Gmail
            </a>
            <button
              type="button"
              onClick={() => setShowResetConfirm(true)}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium text-text transition-colors hover:bg-surface-hover"
            >
              Reset Scan Data
            </button>
            <button
              type="button"
              onClick={() => setShowDisconnectConfirm(true)}
              className="rounded-md border border-danger px-4 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger-bg"
            >
              Disconnect
            </button>
            <p className="w-full text-xs text-text-muted mt-1">
              Authorization happens when you sync
            </p>
          </>
        ) : (
          <button
            type="button"
            onClick={() => void handleConnect()}
            disabled={connecting}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {connecting ? "Connecting..." : "Connect Gmail"}
          </button>
        )}
      </div>

      {showResetConfirm && (
        <div className="mt-4 rounded-md border border-warning bg-warning-bg p-4">
          <h4 className="text-sm font-semibold text-warning">Reset Gmail Scan Data?</h4>
          <p className="mt-1 text-sm text-warning">
            This will clear all Gmail-discovered applications and scan history, allowing a fresh rescan.
            Manual applications will NOT be affected. Gmail integration will remain connected.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleResetGmailData()}
              disabled={resetting}
              className="rounded-md bg-warning px-3 py-1.5 text-sm font-medium text-warning-fg transition-colors hover:bg-warning-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {resetting ? "Resetting..." : "Yes, Reset Scan Data"}
            </button>
            <button
              type="button"
              onClick={() => setShowResetConfirm(false)}
              disabled={resetting}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {showDisconnectConfirm && (
        <div className="mt-4 rounded-md border border-danger bg-danger-bg p-4">
          <h4 className="text-sm font-semibold text-danger">Disconnect Gmail?</h4>
          <p className="mt-1 text-sm text-danger">
            This will completely disconnect Gmail integration and clear all Gmail data.
            You'll need to re-authorize if you want to use Gmail tracking again.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleDisconnectGmail()}
              disabled={disconnecting}
              className="rounded-md bg-danger px-3 py-1.5 text-sm font-medium text-danger-fg transition-colors hover:bg-danger-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {disconnecting ? "Disconnecting..." : "Yes, Disconnect Gmail"}
            </button>
            <button
              type="button"
              onClick={() => setShowDisconnectConfirm(false)}
              disabled={disconnecting}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <p className="mt-4 text-xs text-text-muted">
        Your Gmail data stays in your browser. No emails or tokens are sent to
        JobTrackOS servers.
      </p>
    </div>
  );
}

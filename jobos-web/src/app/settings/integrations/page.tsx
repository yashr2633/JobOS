/**
 * Settings -> Integrations
 *
 * Gmail connection management. This is the single place that renders the
 * Gmail connect/disconnect controls; the Dashboard's scan module links here
 * rather than duplicating the OAuth entry point.
 *
 * The connection is read here, on the server, and only its non-sensitive
 * fields are handed to the client card — tokens and expiry never leave this
 * process.
 *
 * The page header, section navigation, and auth guard now come from
 * `settings/layout.tsx`, so this file holds only the Gmail concern.
 */

import GmailConnectButton from "@/app/components/GmailConnectButton";
import { createClient } from "@/lib/supabase/server";
import { getGmailConnection, type GmailConnection } from "@/lib/api/gmail";
import { DEFAULT_WINDOW_DAYS } from "@/lib/gmail/query";
import SettingsCard from "../components/SettingsCard";
import ResetTrackedApplications from "../components/ResetTrackedApplications";

/** User-safe copy for each failure the Gmail callback can redirect back with. */
const GMAIL_ERROR_MESSAGES: Record<string, string> = {
  denied: "Gmail access was not granted. You can try again whenever you're ready.",
  state_expired:
    "That connection attempt expired. Please click Connect Gmail again.",
  state_invalid:
    "We could not verify that connection attempt, so it was cancelled. Please try again.",
  identity_mismatch:
    "That Google account does not match the account linked to JobTrackOS. Please use your original Google account.",
  invalid_response: "Google returned an unexpected response. Please try again.",
  exchange_failed:
    "We could not finish connecting Gmail. Please try again in a moment.",
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SettingsIntegrationsPage({
  searchParams,
}: PageProps) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The layout already redirects an anonymous visitor; this keeps the data reads
  // below unreachable without a session even if that guard is ever moved.
  if (!user) return null;

  let connection: GmailConnection | null = null;
  let loadError = false;

  try {
    // Pass the known user id so this does not trigger a second getUser().
    connection = await getGmailConnection(supabase, user.id);
  } catch (error) {
    console.error("[settings/integrations] Could not load Gmail connection:", error);
    loadError = true;
  }

  const params = await searchParams;
  const rawError = params.gmail_error;
  const errorKey = Array.isArray(rawError) ? rawError[0] : rawError;
  const errorMessage = errorKey
    ? GMAIL_ERROR_MESSAGES[errorKey] ??
      "We could not connect Gmail. Please try again."
    : null;
  const justConnected = params.gmail === "connected";

  return (
    <>
      {errorMessage && (
        <div
          role="alert"
          className="rounded-md border border-danger/20 bg-danger-bg px-4 py-3 text-sm text-danger"
        >
          {errorMessage}
        </div>
      )}

      {justConnected && !errorMessage && (
        <div
          role="status"
          className="rounded-md border border-success/20 bg-success-bg px-4 py-3 text-sm text-success"
        >
          Gmail connected. JobTrackOS can now look for your job application activity.
        </div>
      )}

      <SettingsCard
        title="Gmail"
        description="Lets JobTrackOS read job-related email so it can track applications automatically. JobTrackOS requests read-only access and never sends email on your behalf."
      >
        {loadError ? (
          <div>
            <p className="text-sm text-danger">
              We could not load your Gmail connection status.
            </p>
            <p className="mt-1 text-sm text-text-secondary">
              This is usually temporary. Refresh the page to try again.
            </p>
          </div>
        ) : (
          <GmailConnectButton
            // Only non-sensitive fields cross into the client payload: the
            // connection object read above carries no token, and this projection
            // keeps it that way explicitly.
            connection={
              connection
                ? {
                    connectedAt: connection.createdAt,
                    lastSyncAt: connection.lastSyncAt,
                    emailAddress: connection.emailAddress,
                  }
                : null
            }
            defaultWindowDays={DEFAULT_WINDOW_DAYS}
          />
        )}
      </SettingsCard>

      {/* Only offered once Gmail has been connected: with no connection there is
          no tracked data to reset, and the control would be a dead end. */}
      {connection && !loadError && <ResetTrackedApplications />}
    </>
  );
}

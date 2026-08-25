/**
 * Settings -> Integrations
 *
 * Gmail connection management using browser-local state.
 */

import SettingsCard from "../components/SettingsCard";
import GmailIntegrationCard from "./GmailIntegrationCard";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SettingsIntegrationsPage({
  searchParams,
}: PageProps) {
  const params = await searchParams;
  const justConnected = params.gmail === "connected";

  return (
    <>
      {justConnected && (
        <div
          role="status"
          className="rounded-md border border-success/20 bg-success-bg px-4 py-3 text-sm text-success"
        >
          Gmail connected. You can now sync your job application activity.
        </div>
      )}

      <GmailIntegrationCard />
    </>
  );
}

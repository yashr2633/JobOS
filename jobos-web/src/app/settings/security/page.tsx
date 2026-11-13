/**
 * Settings -> Security
 *
 * Password management and session state. Everything here delegates to the auth
 * provider's own APIs; this app implements no credential storage of its own.
 *
 */

import { createClient } from "@/lib/supabase/server";
import SettingsCard, { SettingsRow } from "../components/SettingsCard";
import PasswordForm from "../components/PasswordForm";
import SignOutButton from "../components/SignOutButton";

const TIMESTAMP_FORMAT = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

function formatTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return `${TIMESTAMP_FORMAT.format(new Date(parsed))} UTC`;
}

export default async function SettingsSecurityPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const hasVerifiedEmail = Boolean(user?.email && user.email_confirmed_at);
  const accountUpdatedAt = formatTimestamp(user?.updated_at);

  return (
    <>
      <PasswordForm email={hasVerifiedEmail ? user?.email : undefined} />

      <SettingsCard
        title="Security details"
        description="What JobTrackOS can tell you about this account's protection."
      >
        <dl className="divide-y divide-border">
          <SettingsRow
            label="Email verified"
            value={
              user?.email_confirmed_at ? (
                <span className="text-success">Yes</span>
              ) : (
                <span className="text-warning">No</span>
              )
            }
            hint={
              user?.email_confirmed_at
                ? undefined
                : "Check your inbox for the verification link sent when you signed up."
            }
          />
          <SettingsRow
            label="Account last updated"
            value={accountUpdatedAt}
            hint="Changes when your password or profile is updated."
          />
          <SettingsRow
            label="Credential storage"
            value="Managed by the authentication provider"
            hint="JobTrackOS never stores your password and cannot read it."
          />
        </dl>
      </SettingsCard>

      <SettingsCard
        title="Sign out"
        description="End this session on this device. You will need to sign in again."
        footer={<SignOutButton />}
      />
    </>
  );
}

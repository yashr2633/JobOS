/**
 * Settings -> Security
 *
 * Password management and session state. Everything here delegates to the auth
 * provider's own APIs; this app implements no credential storage of its own.
 *
 * Whether a password can be changed is decided from the account's identity
 * providers rather than assumed: an OAuth-only account has no JobTrackOS password, and
 * offering the form would be a control that cannot work.
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

  // An email identity means there is a password this app can change. Absent it,
  // credentials belong entirely to an external provider.
  const hasEmailIdentity =
    (user?.identities ?? []).some((identity) => identity.provider === "email") ||
    // A user with no identity list but an email is an email account too.
    ((user?.identities ?? []).length === 0 && Boolean(user?.email));

  const passwordChangedAt = formatTimestamp(
    // Supabase records this when a password is set or updated.
    (user as { updated_at?: string } | null)?.updated_at
  );

  return (
    <>
      <PasswordForm canChange={hasEmailIdentity} />

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
            value={passwordChangedAt}
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

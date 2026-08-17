/**
 * Settings -> Account
 *
 * Read-only account facts, owned by the auth provider. Deliberately NOT editable
 * here:
 *
 *  - The email is the account identity. Changing it is a verification flow, not a
 *    profile edit, so it is displayed with a note rather than exposed as an input
 *    that would silently do nothing.
 *  - Nothing on this page is invented. A provider that did not report a value
 *    renders "Not set" via `SettingsRow`.
 *
 * No token, provider secret, or session material is rendered.
 */

import { createClient } from "@/lib/supabase/server";
import { profileFromMetadata, greetingName } from "@/lib/account/profile";
import SettingsCard, { SettingsRow } from "../components/SettingsCard";
import SignOutButton from "../components/SignOutButton";

/** Pinned format so the server render and the hydrated render agree. */
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

/**
 * How this account signs in.
 *
 * Derived from the provider list Supabase reports on the user's identities, so
 * it reflects reality rather than assuming email/password.
 */
function signInMethods(identities: { provider?: string }[] | undefined): string {
  const providers = (identities ?? [])
    .map((identity) => identity.provider)
    .filter((provider): provider is string => typeof provider === "string" && provider !== "");

  if (providers.length === 0) return "";

  const pretty = providers.map((provider) =>
    provider === "email" ? "Email and password" : provider.charAt(0).toUpperCase() + provider.slice(1)
  );
  return [...new Set(pretty)].join(", ");
}

export default async function SettingsAccountPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const profile = profileFromMetadata(
    (user?.user_metadata ?? null) as Record<string, unknown> | null
  );
  const name = greetingName(profile);

  const createdAt = formatTimestamp(user?.created_at);
  const lastSignInAt = formatTimestamp(user?.last_sign_in_at);
  const emailConfirmed = Boolean(user?.email_confirmed_at);

  return (
    <>
      <SettingsCard
        title="Account"
        description="Your JobTrackOS identity, as held by the authentication provider."
      >
        <dl className="divide-y divide-border">
          <SettingsRow label="Name" value={name} />
          <SettingsRow
            label="Account email"
            value={user?.email ?? null}
            hint="Used to sign in. Contact support to change the address on your account."
          />
          <SettingsRow
            label="Email status"
            value={
              <span className={emailConfirmed ? "text-success" : "text-warning"}>
                {emailConfirmed ? "Verified" : "Not verified"}
              </span>
            }
          />
          <SettingsRow label="Sign-in method" value={signInMethods(user?.identities)} />
          <SettingsRow
            label="Account created"
            value={
              createdAt && user?.created_at ? (
                <time dateTime={user.created_at}>{createdAt}</time>
              ) : null
            }
          />
          <SettingsRow
            label="Last sign-in"
            value={
              lastSignInAt && user?.last_sign_in_at ? (
                <time dateTime={user.last_sign_in_at}>{lastSignInAt}</time>
              ) : null
            }
          />
        </dl>
      </SettingsCard>

      <SettingsCard
        title="Sessions"
        description="Signing out ends this session on this device."
        footer={<SignOutButton />}
      />
    </>
  );
}

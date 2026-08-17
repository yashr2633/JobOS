/**
 * Google identity resolution for the Gmail integration.
 *
 * Isolated from the route handler so the rules below are unit-testable
 * without a Next request or a Supabase session.
 */

/** The subset of a Supabase user this module needs. */
export interface IdentityBearingUser {
  id: string;
  identities?: SupabaseIdentityLike[] | null;
}

export interface SupabaseIdentityLike {
  provider: string;
  /** For OAuth providers this is the provider's own subject id. */
  id?: string;
  identity_data?: Record<string, unknown> | null;
}

/**
 * The Google `sub` of the identity this JobTrackOS account signs in with, or null
 * when the account has no linked Google identity at all.
 *
 * Only a `provider === "google"` identity is consulted.
 *
 * `user_metadata.sub` must NEVER be used here. GoTrue merges each identity's
 * `identity_data` into `user_metadata`, and for the email/password provider
 * that `sub` is the Supabase user UUID — not a Google subject id. Reading it
 * made every email/password user look like a mismatched Google identity, and
 * for multi-identity accounts its value depends on which identity was linked
 * most recently. It is not an identity primitive.
 *
 * Email address is likewise not used: users can change their Google email,
 * and an email match proves nothing about account ownership.
 */
export function getGoogleAuthSub(user: IdentityBearingUser): string | null {
  const identities = user.identities ?? [];

  for (const identity of identities) {
    if (identity.provider !== "google") continue;

    // Prefer the explicit sub claim carried in identity_data.
    const sub = identity.identity_data?.sub;
    if (typeof sub === "string" && sub.trim() !== "") {
      return sub;
    }

    // For OAuth providers Supabase sets identity.id to the provider subject.
    if (typeof identity.id === "string" && identity.id.trim() !== "") {
      return identity.id;
    }
  }

  return null;
}

export type IdentityDecision =
  | { allowed: true }
  | { allowed: false; reason: "auth_identity_mismatch" | "connection_identity_mismatch" };

/**
 * Decide whether `incomingGoogleSub` may be linked to this account.
 *
 * Rules, in order:
 *  1. An existing connection pins the identity. It cannot change silently;
 *     switching mailboxes requires an explicit disconnect.
 *  2. If the account signs in with Google, the authorized mailbox must be that
 *     same Google identity.
 *  3. Otherwise (email/password account, first connection) any Google identity
 *     may be linked, and rule 1 pins it from then on. Cross-account reuse is
 *     prevented by the unique index on google_sub, since RLS makes it
 *     undetectable in application code.
 */
export function decideIdentityBinding(args: {
  authGoogleSub: string | null;
  existingGoogleSub: string | null;
  incomingGoogleSub: string;
}): IdentityDecision {
  const { authGoogleSub, existingGoogleSub, incomingGoogleSub } = args;

  if (existingGoogleSub && existingGoogleSub !== incomingGoogleSub) {
    return { allowed: false, reason: "connection_identity_mismatch" };
  }

  if (authGoogleSub && authGoogleSub !== incomingGoogleSub) {
    return { allowed: false, reason: "auth_identity_mismatch" };
  }

  return { allowed: true };
}

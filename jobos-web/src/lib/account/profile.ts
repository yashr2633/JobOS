/**
 * Profile fields, and where they live.
 *
 * WHY user_metadata AND NOT A NEW TABLE
 *
 * There is no `profiles` table in this schema, and adding one would mean a
 * migration, RLS policies, and a second source of truth for who the user is —
 * for four optional strings. Supabase Auth already provides `user_metadata`:
 * per-user JSON, written through `auth.updateUser({ data })`, readable from the
 * session, and governed by the provider's own authorization (a user can only
 * ever write their OWN metadata). That is the right store for display
 * preferences, and it needs no schema change.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 * No password, no token, no security state. Those stay with the auth provider
 * and are changed through its API. `user_metadata` is user-writable, so it must
 * never hold anything that grants access or that the app trusts for authorization.
 *
 * The account email is NOT in this module either: it is owned by the auth
 * provider (`user.email`) and changing it is an identity operation with its own
 * verification flow, not a profile edit.
 *
 * Pure and total, so validation and normalization are testable without a network.
 */

/** The editable profile, as the UI works with it. */
export interface ProfileDetails {
  fullName: string;
  /** Optional shorter name for greetings. Falls back to `fullName`. */
  displayName: string;
  phone: string;
  location: string;
}

export const EMPTY_PROFILE: ProfileDetails = {
  fullName: "",
  displayName: "",
  phone: "",
  location: "",
};

/**
 * Per-field length caps.
 *
 * `user_metadata` is user-writable, so bounds are enforced here rather than
 * trusting the client. Generous enough for real names and addresses.
 */
export const FIELD_LIMITS: Record<keyof ProfileDetails, number> = {
  fullName: 120,
  displayName: 60,
  phone: 40,
  location: 120,
};

/**
 * The `user_metadata` keys these fields map to.
 *
 * `full_name` and `avatar_url` are conventional Supabase/OAuth metadata keys, so
 * `full_name` is reused rather than inventing a parallel `fullName` key that
 * would leave two names in the same object disagreeing.
 */
const METADATA_KEYS: Record<keyof ProfileDetails, string> = {
  fullName: "full_name",
  displayName: "display_name",
  phone: "phone",
  location: "location",
};

/** Collapse internal whitespace and trim. */
function tidy(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Read a profile out of a `user_metadata` object.
 *
 * Total: a missing, null, or wrongly-typed value reads as an empty string, never
 * as a fabricated placeholder. The UI decides how to present "not set".
 */
export function profileFromMetadata(
  metadata: Record<string, unknown> | null | undefined
): ProfileDetails {
  if (typeof metadata !== "object" || metadata === null) return { ...EMPTY_PROFILE };

  const read = (key: keyof ProfileDetails) =>
    tidy(metadata[METADATA_KEYS[key]]).slice(0, FIELD_LIMITS[key]);

  return {
    fullName: read("fullName"),
    displayName: read("displayName"),
    phone: read("phone"),
    location: read("location"),
  };
}

/**
 * Build the `data` payload for `auth.updateUser`.
 *
 * Cleared fields are written as `null` rather than omitted, so removing a phone
 * number actually removes it instead of leaving the previous value in place.
 */
export function profileToMetadata(
  profile: ProfileDetails
): Record<string, string | null> {
  const payload: Record<string, string | null> = {};

  for (const key of Object.keys(METADATA_KEYS) as (keyof ProfileDetails)[]) {
    const value = tidy(profile[key]).slice(0, FIELD_LIMITS[key]);
    payload[METADATA_KEYS[key]] = value === "" ? null : value;
  }

  return payload;
}

export type ProfileValidation =
  | { ok: true; value: ProfileDetails }
  | { ok: false; field: keyof ProfileDetails; error: string };

/**
 * Validate and normalize a submitted profile.
 *
 * Every field is optional — a user who wants to store nothing is valid. What is
 * rejected is a value that is too long, or a phone number containing characters
 * no phone number has. Nothing is invented to fill a blank.
 */
export function validateProfile(profile: ProfileDetails): ProfileValidation {
  const normalized: ProfileDetails = {
    fullName: tidy(profile.fullName),
    displayName: tidy(profile.displayName),
    phone: tidy(profile.phone),
    location: tidy(profile.location),
  };

  for (const key of Object.keys(FIELD_LIMITS) as (keyof ProfileDetails)[]) {
    if (normalized[key].length > FIELD_LIMITS[key]) {
      return {
        ok: false,
        field: key,
        error: `That value is too long (maximum ${FIELD_LIMITS[key]} characters).`,
      };
    }
  }

  // Permissive on purpose: international formats vary, so this rejects only
  // characters that cannot appear in a phone number rather than enforcing a shape.
  if (normalized.phone !== "" && !/^[\d\s()+\-.]+$/.test(normalized.phone)) {
    return {
      ok: false,
      field: "phone",
      error: "Enter a phone number using digits, spaces, and + ( ) - . only.",
    };
  }

  return { ok: true, value: normalized };
}

/**
 * The name to greet the user by, or null when they have not given one.
 *
 * Never derives a name from the email local-part: guessing "John Smith" from
 * `jsmith42@` is exactly the kind of fabricated detail this product avoids.
 */
export function greetingName(profile: ProfileDetails): string | null {
  if (profile.displayName !== "") return profile.displayName;
  if (profile.fullName !== "") return profile.fullName.split(" ")[0];
  return null;
}

// ---------------------------------------------------------------------------
// Password policy
// ---------------------------------------------------------------------------

/** Supabase's own floor is 6; this is the app's slightly stronger minimum. */
export const MIN_PASSWORD_LENGTH = 8;

export type PasswordValidation = { ok: true } | { ok: false; error: string };

/**
 * Check a proposed new password before it is sent to the auth provider.
 *
 * Local checks only, to give an immediate and specific message. The provider
 * remains authoritative — this never stores, hashes, compares, or transmits a
 * password anywhere except through `auth.updateUser`.
 */
export function validateNewPassword(
  password: string,
  confirmation: string
): PasswordValidation {
  if (typeof password !== "string" || password === "") {
    return { ok: false, error: "Enter a new password." };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return {
      ok: false,
      error: "Include at least one letter and one number.",
    };
  }
  if (password !== confirmation) {
    return { ok: false, error: "Those passwords do not match." };
  }
  return { ok: true };
}

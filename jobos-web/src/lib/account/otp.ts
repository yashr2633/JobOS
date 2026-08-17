/**
 * Email one-time-code helpers.
 *
 * WHAT THIS MODULE IS NOT
 *
 * It does not generate, store, hash, compare, or expire a code. All of that is
 * Supabase Auth's job: `signInWithOtp` issues the code and emails it,
 * `verifyOtp` validates it server-side and mints the session. There is no second
 * authentication system here and no code ever reaches our storage.
 *
 * WHAT IT IS
 *
 * The pure client-side concerns around that flow: normalizing what the user
 * typed, deciding whether a resend is allowed yet, and turning a provider error
 * into a sentence a person can act on. All total functions, so the states and
 * failure cases are testable without a network.
 */

/** Supabase issues 6-digit email codes. */
export const OTP_LENGTH = 6;

/**
 * Seconds a user must wait between resend requests.
 *
 * Client-side courtesy only — Supabase enforces its own rate limit server-side,
 * which is the actual control. This exists so the button explains the wait
 * instead of the user hitting an opaque "email rate limit exceeded".
 */
export const RESEND_COOLDOWN_SECONDS = 60;

/** Which flow a code belongs to. Maps to Supabase's `verifyOtp` type. */
export type OtpPurpose = "signup" | "signin";

/** The `type` Supabase's `verifyOtp` expects for each flow. */
export const VERIFY_OTP_TYPE: Record<OtpPurpose, "signup" | "email"> = {
  // Confirms a newly created account.
  signup: "signup",
  // Signs in an existing account with an emailed code.
  signin: "email",
};

/**
 * Keep only digits, bounded to the code length.
 *
 * Users paste codes with spaces, hyphens, or a trailing newline from an email
 * client, and a strict input would reject a correct code. Stripping non-digits is
 * safe because the code alphabet is numeric.
 */
export function normalizeOtp(input: string): string {
  if (typeof input !== "string") return "";
  return input.replace(/\D/g, "").slice(0, OTP_LENGTH);
}

export type OtpValidation = { ok: true; code: string } | { ok: false; error: string };

/** Check a typed code before spending a network round trip on it. */
export function validateOtp(input: string): OtpValidation {
  const code = normalizeOtp(input);

  if (code === "") {
    return { ok: false, error: "Enter the code from your email." };
  }
  if (code.length < OTP_LENGTH) {
    return {
      ok: false,
      error: `That code is too short — it should be ${OTP_LENGTH} digits.`,
    };
  }
  return { ok: true, code };
}

/** Basic shape check, so an obvious typo does not cost a request. */
export function isPlausibleEmail(value: string): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  // Deliberately permissive: the provider is authoritative on deliverability.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

/**
 * Seconds still to wait before another code may be requested.
 *
 * `lastSentAt === null` means none has been sent, so a request is allowed.
 */
export function resendCooldownRemaining(
  lastSentAt: number | null,
  now: number = Date.now()
): number {
  if (lastSentAt === null) return 0;

  const elapsedSeconds = Math.floor((now - lastSentAt) / 1000);
  const remaining = RESEND_COOLDOWN_SECONDS - elapsedSeconds;
  // A clock that jumped backwards must not produce a negative or absurd wait.
  return Math.min(RESEND_COOLDOWN_SECONDS, Math.max(0, remaining));
}

export function canResend(
  lastSentAt: number | null,
  now: number = Date.now()
): boolean {
  return resendCooldownRemaining(lastSentAt, now) === 0;
}

/**
 * Turn a provider error into an actionable sentence.
 *
 * Supabase's raw strings ("Token has expired or is invalid") conflate two cases
 * the user resolves differently, and its rate-limit wording is opaque. Each
 * branch below names the next action.
 */
export function describeOtpError(message: string): string {
  const normalized = (typeof message === "string" ? message : "").toLowerCase();

  if (normalized.includes("expired")) {
    return "That code has expired. Request a new one and try again.";
  }
  if (
    normalized.includes("invalid") ||
    normalized.includes("incorrect") ||
    normalized.includes("not found")
  ) {
    return "That code is not correct. Check the digits, or request a new code.";
  }
  if (normalized.includes("rate limit") || normalized.includes("too many")) {
    return "Too many attempts. Please wait a minute before requesting another code.";
  }
  if (normalized.includes("already registered") || normalized.includes("already been registered")) {
    return "An account already exists for that email. Try signing in instead.";
  }
  if (
    normalized.includes("signups not allowed") ||
    normalized.includes("otp_disabled") ||
    normalized.includes("email logins are disabled")
  ) {
    // A configuration problem, not a user mistake — say so rather than blaming
    // the code they typed.
    return "Email codes are not enabled for this project yet. Please use your password to sign in.";
  }
  if (normalized.includes("failed to fetch") || normalized.includes("network")) {
    return "We could not reach the server. Check your connection and try again.";
  }
  if (normalized.trim() === "") {
    return "We could not verify that code. Please try again.";
  }
  return message;
}

/** Mask an address for a confirmation line: `pr***@example.com`. */
export function maskEmail(email: string): string {
  const trimmed = (typeof email === "string" ? email : "").trim();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0) return trimmed;

  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at);
  if (local.length <= 2) return `${local}***${domain}`;
  return `${local.slice(0, 2)}***${domain}`;
}

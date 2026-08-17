/**
 * Email one-time-code tests.
 *
 * Code issuance, storage and expiry are Supabase Auth's; nothing here reimplements
 * them. What is tested is the client-side surface: input normalization, the
 * resend cooldown, and the failure messages — including the cases the provider
 * conflates (expired vs invalid) that a user resolves differently.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import {
  OTP_LENGTH,
  RESEND_COOLDOWN_SECONDS,
  VERIFY_OTP_TYPE,
  canResend,
  describeOtpError,
  isPlausibleEmail,
  maskEmail,
  normalizeOtp,
  resendCooldownRemaining,
  validateOtp,
} from "./otp.ts";

// ---------------------------------------------------------------------------
// Supabase verifyOtp types
// ---------------------------------------------------------------------------

test("each flow maps to the Supabase verifyOtp type it requires", () => {
  // 'signup' confirms a new account; 'email' signs an existing user in. Swapping
  // them makes verification fail with a confusing provider error.
  assert.equal(VERIFY_OTP_TYPE.signup, "signup");
  assert.equal(VERIFY_OTP_TYPE.signin, "email");
});

// ---------------------------------------------------------------------------
// Input normalization
// ---------------------------------------------------------------------------

test("a pasted code with spaces or hyphens is accepted", () => {
  assert.equal(normalizeOtp("123 456"), "123456");
  assert.equal(normalizeOtp("123-456"), "123456");
  assert.equal(normalizeOtp(" 123456\n"), "123456");
});

test("non-digits are stripped and the length is bounded", () => {
  assert.equal(normalizeOtp("abc123456def"), "123456");
  assert.equal(normalizeOtp("1234567890"), "123456", "never longer than the code");
  assert.equal(normalizeOtp(""), "");
});

test("Property: normalization always yields at most OTP_LENGTH digits", () => {
  fc.assert(
    fc.property(fc.string(), (input) => {
      const code = normalizeOtp(input);
      return code.length <= OTP_LENGTH && /^\d*$/.test(code);
    }),
    { numRuns: 400 }
  );
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test("a complete code validates and is returned normalized", () => {
  const result = validateOtp(" 123 456 ");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.code, "123456");
});

test("an empty code asks the user to enter one", () => {
  const result = validateOtp("");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /Enter the code/);
});

test("a short code is rejected before a request is spent", () => {
  const result = validateOtp("123");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, new RegExp(String(OTP_LENGTH)));
});

test("Property: validation never accepts an incomplete code", () => {
  fc.assert(
    fc.property(fc.string({ maxLength: 20 }), (input) => {
      const result = validateOtp(input);
      if (!result.ok) return true;
      return result.code.length === OTP_LENGTH;
    }),
    { numRuns: 400 }
  );
});

// ---------------------------------------------------------------------------
// Resend cooldown
// ---------------------------------------------------------------------------

test("a resend is allowed when no code has been sent", () => {
  assert.equal(canResend(null), true);
  assert.equal(resendCooldownRemaining(null), 0);
});

test("the cooldown counts down and then permits a resend", () => {
  const sentAt = 1_000_000;

  assert.equal(
    resendCooldownRemaining(sentAt, sentAt),
    RESEND_COOLDOWN_SECONDS,
    "full wait immediately after sending"
  );
  assert.equal(
    resendCooldownRemaining(sentAt, sentAt + 10_000),
    RESEND_COOLDOWN_SECONDS - 10
  );
  assert.equal(
    resendCooldownRemaining(sentAt, sentAt + RESEND_COOLDOWN_SECONDS * 1000),
    0
  );
  assert.equal(canResend(sentAt, sentAt + RESEND_COOLDOWN_SECONDS * 1000), true);
  assert.equal(canResend(sentAt, sentAt + 5_000), false);
});

test("a backwards clock jump cannot produce a negative or absurd wait", () => {
  const sentAt = 1_000_000;
  const remaining = resendCooldownRemaining(sentAt, sentAt - 500_000);
  assert.ok(remaining >= 0);
  assert.ok(remaining <= RESEND_COOLDOWN_SECONDS);
});

test("Property: the cooldown is always within its bounds", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 2_000_000_000 }),
      fc.integer({ min: 0, max: 2_000_000_000 }),
      (sentAt, now) => {
        const remaining = resendCooldownRemaining(sentAt, now);
        return remaining >= 0 && remaining <= RESEND_COOLDOWN_SECONDS;
      }
    ),
    { numRuns: 300 }
  );
});

// ---------------------------------------------------------------------------
// Failure messages
// ---------------------------------------------------------------------------

test("an expired code is distinguished from an incorrect one", () => {
  const expired = describeOtpError("Token has expired");
  assert.match(expired, /expired/i);
  assert.match(expired, /new one|new code/i, "tells the user to request another");

  const invalid = describeOtpError("Invalid token");
  assert.match(invalid, /not correct/i);
  assert.notEqual(expired, invalid, "the two cases read differently");
});

test("a rate limit explains the wait rather than blaming the code", () => {
  const message = describeOtpError("Email rate limit exceeded");
  assert.match(message, /wait/i);
  assert.doesNotMatch(message, /not correct/i);
});

test("a disabled-OTP configuration is reported as configuration, not user error", () => {
  const message = describeOtpError("Signups not allowed for otp");
  assert.match(message, /not enabled/i);
  assert.match(message, /password/i, "offers the working alternative");
});

test("an existing account is directed to sign in instead", () => {
  const message = describeOtpError("User already registered");
  assert.match(message, /already exists/i);
  assert.match(message, /sign(ing)? in/i);
});

test("a network failure is reported as such", () => {
  assert.match(describeOtpError("Failed to fetch"), /connection/i);
});

test("an unrecognised message is passed through rather than swallowed", () => {
  assert.equal(describeOtpError("Some novel provider error"), "Some novel provider error");
});

test("an empty message still produces something actionable", () => {
  assert.match(describeOtpError(""), /could not verify/i);
});

test("Property: a message is always produced, never empty", () => {
  fc.assert(
    fc.property(fc.string(), (input) => describeOtpError(input).length > 0),
    { numRuns: 300 }
  );
});

// ---------------------------------------------------------------------------
// Email helpers
// ---------------------------------------------------------------------------

test("plausible addresses pass and obvious typos do not", () => {
  for (const good of ["a@b.co", "priya.sharma@example.com", "x+y@sub.example.org"]) {
    assert.equal(isPlausibleEmail(good), true, good);
  }
  for (const bad of ["", "  ", "no-at-sign", "missing@domain", "a@b@c.com", "a b@c.com"]) {
    assert.equal(isPlausibleEmail(bad), false, JSON.stringify(bad));
  }
});

test("a masked address hides the local part but stays recognisable", () => {
  assert.equal(maskEmail("priya@example.com"), "pr***@example.com");
  assert.equal(maskEmail("ab@example.com"), "ab***@example.com");
  assert.equal(maskEmail("a@example.com"), "a***@example.com");
  // The domain is never hidden — it is what lets a user spot a typo.
  assert.match(maskEmail("someone@example.com"), /@example\.com$/);
});

test("masking never throws on malformed input", () => {
  assert.doesNotThrow(() => maskEmail(""));
  assert.doesNotThrow(() => maskEmail("no-at"));
  assert.equal(maskEmail("no-at"), "no-at");
});

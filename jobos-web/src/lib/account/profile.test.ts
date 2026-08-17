/**
 * Profile and password-policy tests.
 *
 * The load-bearing guarantees here:
 *  - nothing is ever fabricated to fill an empty profile field (§19),
 *  - a cleared field is actually cleared rather than silently retaining its old
 *    value,
 *  - the metadata mapping round-trips, so saving then reloading shows the same
 *    profile,
 *  - the password policy is enforced locally before anything reaches the auth
 *    provider.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import {
  EMPTY_PROFILE,
  FIELD_LIMITS,
  greetingName,
  MIN_PASSWORD_LENGTH,
  profileFromMetadata,
  profileToMetadata,
  validateNewPassword,
  validateProfile,
  type ProfileDetails,
} from "./profile.ts";

// ---------------------------------------------------------------------------
// Reading metadata
// ---------------------------------------------------------------------------

test("a profile is read out of conventional metadata keys", () => {
  const profile = profileFromMetadata({
    full_name: "Priya Sharma",
    display_name: "Priya",
    phone: "+91 90000 00000",
    location: "Bengaluru, India",
  });

  assert.deepEqual(profile, {
    fullName: "Priya Sharma",
    displayName: "Priya",
    phone: "+91 90000 00000",
    location: "Bengaluru, India",
  });
});

test("absent, null, and wrongly-typed metadata read as empty, never invented", () => {
  assert.deepEqual(profileFromMetadata(null), EMPTY_PROFILE);
  assert.deepEqual(profileFromMetadata(undefined), EMPTY_PROFILE);
  assert.deepEqual(profileFromMetadata({}), EMPTY_PROFILE);
  assert.deepEqual(
    profileFromMetadata({ full_name: 42, phone: null, location: {} }),
    EMPTY_PROFILE
  );
});

test("no name is ever derived from an email address", () => {
  // A metadata object carrying only an email must not yield a guessed name.
  const profile = profileFromMetadata({ email: "jsmith42@example.com" });
  assert.equal(profile.fullName, "");
  assert.equal(profile.displayName, "");
  assert.equal(greetingName(profile), null);
});

test("whitespace is collapsed and values are trimmed on read", () => {
  const profile = profileFromMetadata({ full_name: "  Priya   Sharma \n" });
  assert.equal(profile.fullName, "Priya Sharma");
});

// ---------------------------------------------------------------------------
// Writing metadata
// ---------------------------------------------------------------------------

test("a cleared field is written as null so it is actually removed", () => {
  const payload = profileToMetadata({
    fullName: "Priya Sharma",
    displayName: "",
    phone: "   ",
    location: "",
  });

  assert.equal(payload.full_name, "Priya Sharma");
  assert.equal(payload.display_name, null);
  assert.equal(payload.phone, null, "whitespace-only clears the field");
  assert.equal(payload.location, null);
});

test("the metadata payload carries no key beyond the four profile fields", () => {
  const keys = Object.keys(
    profileToMetadata({
      fullName: "A",
      displayName: "B",
      phone: "1",
      location: "C",
    })
  ).sort();

  assert.deepEqual(keys, ["display_name", "full_name", "location", "phone"]);
});

test("Property: metadata round-trips through write and read", () => {
  fc.assert(
    fc.property(
      fc.record({
        fullName: fc.string({ maxLength: 60 }),
        displayName: fc.string({ maxLength: 40 }),
        phone: fc.stringMatching(/^[\d +()-]{0,20}$/),
        location: fc.string({ maxLength: 60 }),
      }),
      (raw) => {
        const validation = validateProfile(raw as ProfileDetails);
        if (!validation.ok) return true; // rejected input is not round-tripped

        const written = profileToMetadata(validation.value);
        const readBack = profileFromMetadata(
          written as Record<string, unknown>
        );
        return (
          readBack.fullName === validation.value.fullName &&
          readBack.displayName === validation.value.displayName &&
          readBack.phone === validation.value.phone &&
          readBack.location === validation.value.location
        );
      }
    ),
    { numRuns: 300 }
  );
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test("an entirely empty profile is valid — every field is optional", () => {
  const result = validateProfile(EMPTY_PROFILE);
  assert.equal(result.ok, true);
});

test("an over-long value is rejected against its own field limit", () => {
  const result = validateProfile({
    ...EMPTY_PROFILE,
    fullName: "a".repeat(FIELD_LIMITS.fullName + 1),
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.field, "fullName");
});

test("international phone formats are accepted, prose is not", () => {
  for (const phone of ["+91 90000 00000", "(555) 010-9999", "+1-555-0100", "555.0100"]) {
    assert.equal(
      validateProfile({ ...EMPTY_PROFILE, phone }).ok,
      true,
      `${phone} is a plausible phone number`
    );
  }

  const rejected = validateProfile({ ...EMPTY_PROFILE, phone: "call me maybe" });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.ok === false && rejected.field, "phone");
});

test("Property: validation is total and never throws", () => {
  fc.assert(
    fc.property(
      fc.record({
        fullName: fc.string(),
        displayName: fc.string(),
        phone: fc.string(),
        location: fc.string(),
      }),
      (raw) => {
        validateProfile(raw as ProfileDetails);
        return true;
      }
    ),
    { numRuns: 200 }
  );
});

// ---------------------------------------------------------------------------
// Greeting name
// ---------------------------------------------------------------------------

test("the greeting prefers the display name, then the first name", () => {
  assert.equal(
    greetingName({ ...EMPTY_PROFILE, displayName: "Priya", fullName: "Priya Sharma" }),
    "Priya"
  );
  assert.equal(
    greetingName({ ...EMPTY_PROFILE, fullName: "Priya Sharma" }),
    "Priya"
  );
  assert.equal(greetingName(EMPTY_PROFILE), null);
});

// ---------------------------------------------------------------------------
// Password policy
// ---------------------------------------------------------------------------

test("a strong matching password is accepted", () => {
  assert.deepEqual(validateNewPassword("correct9horse", "correct9horse"), {
    ok: true,
  });
});

test("a short password is refused with the length stated", () => {
  const result = validateNewPassword("ab1", "ab1");
  assert.equal(result.ok, false);
  assert.match(
    result.ok === false ? result.error : "",
    new RegExp(String(MIN_PASSWORD_LENGTH))
  );
});

test("a password with no digit or no letter is refused", () => {
  assert.equal(validateNewPassword("alllettershere", "alllettershere").ok, false);
  assert.equal(validateNewPassword("1234567890", "1234567890").ok, false);
});

test("a mismatched confirmation is refused", () => {
  const result = validateNewPassword("correct9horse", "correct9horsf");
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.error : "", /do not match/);
});

test("an empty password is refused before any provider call", () => {
  assert.equal(validateNewPassword("", "").ok, false);
});

test("Property: an accepted password always meets every stated rule", () => {
  fc.assert(
    fc.property(fc.string({ maxLength: 40 }), (candidate) => {
      const result = validateNewPassword(candidate, candidate);
      if (!result.ok) return true;
      return (
        candidate.length >= MIN_PASSWORD_LENGTH &&
        /[a-zA-Z]/.test(candidate) &&
        /[0-9]/.test(candidate)
      );
    }),
    { numRuns: 400 }
  );
});

/**
 * Scan-window tests: the selectable set, the 30-day default, and the shape of
 * the Gmail query each window produces.
 *
 * Pure units — no network, no AI, no Supabase.
 *
 * Note on the selectable set: `all` is deliberately NOT selectable. Every
 * window a user can choose has a concrete lower bound, so the "unbounded
 * window" case only survives as a legacy `HISTORY_RANGES` entry, asserted
 * separately below for backward compatibility.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import {
  buildGmailQuery,
  coerceScanWindow,
  DEFAULT_SCAN_WINDOW,
  DEFAULT_WINDOW_DAYS,
  HISTORY_RANGES,
  isScanWindow,
  resolveWindow,
  scanWindowFromBounds,
  SCAN_WINDOWS,
  toGmailDate,
  type ScanWindow,
} from "./query.ts";
import {
  SCAN_WINDOW_OPTIONS,
  scanWindowDays,
  scanWindowLabel,
} from "./scanWindowOptions.ts";

const FIXED_NOW = new Date("2026-06-15T12:00:00.000Z");

/** Clauses that must never fall out of the query, whatever the window. */
const MANDATORY_EXCLUSIONS = ["-in:spam", "-in:trash", "-in:chats"] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

const scanWindow = () => fc.constantFrom(...SCAN_WINDOWS);

/** Reference instants wide enough to cross months, years, and leap days. */
const referenceInstant = () =>
  fc.date({
    min: new Date("2001-01-01T00:00:00.000Z"),
    max: new Date("2099-12-31T23:59:59.000Z"),
    noInvalidDate: true,
  });

/**
 * Values a request body might carry that are not selectable windows.
 *
 * Includes the legacy names (`6m`, `1y`, `all`) and the labels that were once
 * proposed for the UI (`90+`, `All mail`) precisely because none of them may
 * ever be accepted as a window value.
 */
const nonWindowValue = () =>
  fc
    .oneof(
      fc.constantFrom(
        "6m",
        "1y",
        "all",
        "90+",
        "All mail",
        "180d",
        "0d",
        "30D",
        " 30d",
        ""
      ),
      fc.string(),
      fc.integer(),
      fc.constant(null),
      fc.constant(undefined),
      fc.constant(true),
      fc.constant({ window: "30d" }),
      fc.constant(["30d"])
    )
    .filter(
      (value) =>
        !(
          typeof value === "string" &&
          (SCAN_WINDOWS as readonly string[]).includes(value)
        )
    );

function daysOf(window: ScanWindow): number {
  const days = HISTORY_RANGES[window];
  // Every selectable window is bounded; this is the compile-time-checked
  // invariant restated at runtime so a widened set cannot slip past.
  assert.notEqual(days, null, `window ${window} must have a day count`);
  return days as number;
}

// ===========================================================================
// Property 17
// ===========================================================================

// Feature: gmail-application-precision, Property 17: The scan query is
// well-formed for every accepted window and rejects the rest
//
// **Validates: Requirements 9.2, 9.4, 9.5, 9.6**
test("Property 17: every accepted window yields a bounded, junk-free query", () => {
  // Requirements 9.2, 9.4, 9.5: for any accepted window and any reference
  // instant, the query carries the exact `after:` bound for that window and
  // still excludes spam, trash, and chats.
  fc.assert(
    fc.property(scanWindow(), referenceInstant(), (window, now) => {
      const days = daysOf(window);
      const expectedStart = new Date(now.getTime() - days * DAY_MS);

      const bounds = resolveWindow(window, now);
      assert.notEqual(bounds.start, null);
      assert.equal(bounds.start?.getTime(), expectedStart.getTime());
      assert.equal(bounds.end.getTime(), now.getTime());

      const query = buildGmailQuery({ range: window, now });

      // A concrete lower bound, formatted as UTC YYYY/MM/DD. There is no
      // selectable window without one.
      assert.match(query, /(?:^| )after:\d{4}\/\d{2}\/\d{2}(?: |$)/);
      assert.ok(
        query.includes(`after:${toGmailDate(expectedStart)}`),
        `expected after:${toGmailDate(expectedStart)} in ${query}`
      );

      for (const clause of MANDATORY_EXCLUSIONS) {
        assert.ok(query.includes(clause), `expected ${clause} in ${query}`);
      }
    }),
    { numRuns: 100 }
  );

  // Requirement 9.4: the lower bound moves monotonically earlier as the window
  // widens, so a wider selection can never scan less mail.
  fc.assert(
    fc.property(
      scanWindow(),
      scanWindow(),
      referenceInstant(),
      (a, b, now) => {
        const [narrow, wide] = daysOf(a) <= daysOf(b) ? [a, b] : [b, a];

        const narrowStart = resolveWindow(narrow, now).start;
        const wideStart = resolveWindow(wide, now).start;
        assert.notEqual(narrowStart, null);
        assert.notEqual(wideStart, null);

        assert.ok(
          (wideStart as Date).getTime() <= (narrowStart as Date).getTime(),
          `${wide} must not start later than ${narrow}`
        );
      }
    ),
    { numRuns: 100 }
  );

  // Requirement 9.6: anything outside the accepted set resolves to the 30-day
  // window. It is never rejected, and it never reaches a job unvalidated.
  fc.assert(
    fc.property(nonWindowValue(), referenceInstant(), (value, now) => {
      assert.equal(isScanWindow(value), false);

      const coerced = coerceScanWindow(value);
      assert.equal(coerced, DEFAULT_SCAN_WINDOW);
      assert.ok((SCAN_WINDOWS as readonly string[]).includes(coerced));

      const expectedStart = new Date(
        now.getTime() - DEFAULT_WINDOW_DAYS * DAY_MS
      );
      assert.equal(
        resolveWindow(coerced, now).start?.getTime(),
        expectedStart.getTime()
      );
      assert.ok(
        buildGmailQuery({ range: coerced, now }).includes(
          `after:${toGmailDate(expectedStart)}`
        )
      );
    }),
    { numRuns: 100 }
  );

  // The selectable set is exactly these four. A widened set must be a
  // deliberate spec change, not an accident.
  fc.assert(
    fc.property(scanWindow(), (window) => {
      assert.ok(["7d", "30d", "60d", "90d"].includes(window));
    }),
    { numRuns: 100 }
  );
});

// ===========================================================================
// Concrete window examples
// ===========================================================================

// _Requirements: 9.1_
test("the default scan window is 30 days", () => {
  assert.equal(DEFAULT_SCAN_WINDOW, "30d");
  assert.equal(DEFAULT_WINDOW_DAYS, 30);
  assert.equal(HISTORY_RANGES["30d"], 30);

  // No argument at all resolves to the default, not to a wide legacy range.
  const bounds = resolveWindow(undefined, FIXED_NOW);
  assert.equal(toGmailDate(bounds.start as Date), "2026/05/16");

  const query = buildGmailQuery({ now: FIXED_NOW });
  assert.ok(query.includes("after:2026/05/16"));
  // Explicitly asking for the default produces the identical query.
  assert.equal(query, buildGmailQuery({ range: "30d", now: FIXED_NOW }));
});

// _Requirements: 9.1, 9.3_
test("every selectable window has a concrete lower bound", () => {
  assert.deepEqual([...SCAN_WINDOWS], ["7d", "30d", "60d", "90d"]);

  const expected: Record<ScanWindow, string> = {
    "7d": "2026/06/08",
    "30d": "2026/05/16",
    "60d": "2026/04/16",
    "90d": "2026/03/17",
  };

  for (const window of SCAN_WINDOWS) {
    const bounds = resolveWindow(window, FIXED_NOW);
    assert.notEqual(
      bounds.start,
      null,
      `${window} must have a lower bound`
    );
    assert.equal(toGmailDate(bounds.start as Date), expected[window]);

    const query = buildGmailQuery({ range: window, now: FIXED_NOW });
    assert.ok(query.includes(`after:${expected[window]}`));
    // The upper bound is pushed out a day so today's mail is included.
    assert.ok(query.includes("before:2026/06/16"));
  }
});

// _Requirements: 9.3_
test("the legacy unbounded range still resolves to a null lower bound", () => {
  // `all` is no longer selectable...
  assert.equal(isScanWindow("all"), false);
  assert.equal(coerceScanWindow("all"), "30d");

  // ...but stored and legacy callers still resolve it, and it still omits the
  // lower bound rather than inventing one.
  assert.equal(HISTORY_RANGES.all, null);
  assert.equal(resolveWindow("all", FIXED_NOW).start, null);

  const query = buildGmailQuery({ range: "all", now: FIXED_NOW });
  assert.ok(!query.includes("after:"));
  assert.ok(query.includes("before:2026/06/16"));
  for (const clause of MANDATORY_EXCLUSIONS) {
    assert.ok(query.includes(clause));
  }
});

// _Requirements: 9.1, 9.6_
test("legacy day-count ranges resolve but are not selectable", () => {
  assert.equal(HISTORY_RANGES["6m"], 180);
  assert.equal(HISTORY_RANGES["1y"], 365);

  assert.equal(isScanWindow("6m"), false);
  assert.equal(isScanWindow("1y"), false);
  assert.equal(coerceScanWindow("6m"), "30d");
  assert.equal(coerceScanWindow("1y"), "30d");

  // Resolution itself is unchanged for any caller that still passes them.
  assert.equal(toGmailDate(resolveWindow("6m", FIXED_NOW).start as Date), "2025/12/17");
});

// ===========================================================================
// Selector vocabulary
// ===========================================================================

// _Requirements: 9.1, 9.7_
test("the selector offers exactly the four selectable windows, in order", () => {
  assert.deepEqual(
    SCAN_WINDOW_OPTIONS.map((option) => option.value),
    ["7d", "30d", "60d", "90d"]
  );

  assert.deepEqual(
    SCAN_WINDOW_OPTIONS.map((option) => option.label),
    [
      "Last 7 days",
      "Last 30 days (recommended)",
      "Last 60 days",
      "Last 90 days",
    ]
  );

  assert.deepEqual(
    SCAN_WINDOW_OPTIONS.map((option) => option.days),
    [7, 30, 60, 90]
  );

  // Exactly one recommended option, and it is the 30-day default.
  const recommended = SCAN_WINDOW_OPTIONS.filter((option) => option.recommended);
  assert.equal(recommended.length, 1);
  assert.equal(recommended[0].value, DEFAULT_SCAN_WINDOW);
});

// _Requirements: 9.1, 9.7_
test("no wider-than-90-day window is offered to the user", () => {
  const values = SCAN_WINDOW_OPTIONS.map((option) => option.value as string);
  const labels = SCAN_WINDOW_OPTIONS.map((option) => option.label);

  for (const absent of ["90+", "all", "6m", "1y"]) {
    assert.ok(!values.includes(absent), `${absent} must not be selectable`);
  }
  for (const absent of ["90+", "All mail", "6 months", "1 year"]) {
    assert.ok(
      !labels.some((label) => label.includes(absent)),
      `no option label may mention ${absent}`
    );
  }

  // 90 days is the widest thing on offer.
  assert.equal(Math.max(...SCAN_WINDOW_OPTIONS.map((option) => option.days)), 90);
});

// _Requirements: 9.6, 9.7_
test("every offered option survives the API's coercion unchanged", () => {
  for (const option of SCAN_WINDOW_OPTIONS) {
    // What the selector sends is what the route runs: no option is silently
    // downgraded to the default.
    assert.equal(isScanWindow(option.value), true);
    assert.equal(coerceScanWindow(option.value), option.value);

    // Labels and day counts are derived from the query module, so they cannot
    // drift from the window they describe.
    assert.equal(option.days, HISTORY_RANGES[option.value]);
    assert.equal(option.days, scanWindowDays(option.value));
    assert.equal(option.label, scanWindowLabel(option.value));
  }
});

// ===========================================================================
// Resumed-job window recovery
// ===========================================================================

// _Requirements: 9.4, 9.7_
test("a stored job's window is read back off its own date bounds", () => {
  // A sync job persists the concrete bounds `resolveWindow` produced, not the
  // window's name. A resumed batch has to recover that name, because the Gmail
  // page cursor on the job was issued against the query THAT window built:
  // continuing it under a different `after:` bound would list one scan under
  // two windows.
  for (const window of SCAN_WINDOWS) {
    const { start, end } = resolveWindow(window, FIXED_NOW);
    const stored = {
      windowStart: (start as Date).toISOString().slice(0, 10),
      windowEnd: end.toISOString().slice(0, 10),
    };

    assert.equal(
      scanWindowFromBounds(stored.windowStart, stored.windowEnd),
      window
    );
  }
});

// _Requirements: 9.6_
test("bounds matching no selectable window recover nothing rather than guessing", () => {
  // Legacy jobs and the epoch fallback a legacy unbounded range stored. The
  // caller keeps the requested window in these cases; it must never be handed a
  // fabricated one.
  assert.equal(scanWindowFromBounds("2025-12-17", "2026-06-15"), null); // 6m
  assert.equal(scanWindowFromBounds("1970-01-01", "2026-06-15"), null); // all
  assert.equal(scanWindowFromBounds("2026-06-15", "2026-06-15"), null); // 0 days
  assert.equal(scanWindowFromBounds("2026-06-15", "2026-05-16"), null); // inverted
  assert.equal(scanWindowFromBounds("not-a-date", "2026-06-15"), null);
  assert.equal(scanWindowFromBounds("", ""), null);
});

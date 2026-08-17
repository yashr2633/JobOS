/**
 * Reporting-window tests: the 7 / 30 / 90 vocabulary, the param guard, and the
 * recovery of a default from a completed scan's stored bounds.
 *
 * Pure units — no network, no Supabase, no React, and no machine clock: every
 * call that needs "now" is given one.
 *
 * These tests also PIN THE DIVERGENCE between the two window vocabularies. The
 * Gmail scan selector offers 7 / 30 / 60 / 90 and `scanWindow.test.ts` asserts
 * that set exactly; the dashboard reporting control offers 7 / 30 / 90. The two
 * answer different questions — how much mail to read, versus which applications
 * to count — so the assertions below state the relationship rather than papering
 * over it.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import {
  DEFAULT_REPORTING_WINDOW,
  REPORTING_WINDOWS,
  REPORTING_WINDOW_OPTIONS,
  firstParamValue,
  isReportingWindow,
  reportingWindowDays,
  reportingWindowFromScanBounds,
  reportingWindowLabel,
  resolveReportingWindow,
} from "./reportingWindow.ts";
import {
  DEFAULT_SCAN_WINDOW,
  SCAN_WINDOWS,
  resolveWindow,
  type ScanWindow,
} from "../../lib/gmail/query.ts";

const FIXED_NOW = new Date("2026-06-15T12:00:00.000Z");

/** The bounds a sync job persists: `date` columns, so `YYYY-MM-DD`. */
function storedBounds(window: ScanWindow): {
  windowStart: string;
  windowEnd: string;
} {
  const { start, end } = resolveWindow(window, FIXED_NOW);
  return {
    windowStart: (start as Date).toISOString().slice(0, 10),
    windowEnd: end.toISOString().slice(0, 10),
  };
}

// ===========================================================================
// The vocabulary
// ===========================================================================

test("the reporting control offers exactly 7, 30 and 90 days, in order", () => {
  assert.deepEqual([...REPORTING_WINDOWS], ["7d", "30d", "90d"]);

  assert.deepEqual(
    REPORTING_WINDOW_OPTIONS.map((option) => option.value),
    ["7d", "30d", "90d"]
  );
  assert.deepEqual(
    REPORTING_WINDOW_OPTIONS.map((option) => option.days),
    [7, 30, 90]
  );
  assert.deepEqual(
    REPORTING_WINDOW_OPTIONS.map((option) => option.label),
    ["Last 7 days", "Last 30 days", "Last 90 days"]
  );

  for (const window of REPORTING_WINDOWS) {
    assert.equal(reportingWindowLabel(window), `Last ${reportingWindowDays(window)} days`);
  }
});

test("the reporting set is a strict subset of the untouched scan set", () => {
  // The scan vocabulary is unchanged and still the wider of the two: 60d remains
  // scannable and is deliberately NOT reportable.
  assert.deepEqual([...SCAN_WINDOWS], ["7d", "30d", "60d", "90d"]);

  for (const window of REPORTING_WINDOWS) {
    assert.ok(
      (SCAN_WINDOWS as readonly string[]).includes(window),
      `${window} must also be a scannable window`
    );
  }

  assert.equal(isReportingWindow("60d"), false);
  // Both vocabularies default to the same 30 days, so the first thing a user
  // sees reports the period their first scan covered.
  assert.equal(DEFAULT_REPORTING_WINDOW, "30d");
  assert.equal(DEFAULT_SCAN_WINDOW, "30d");
});

// ===========================================================================
// The param guard
// ===========================================================================

test("the window param guard rejects junk and falls back", () => {
  // Values a mangled or hand-edited URL can carry. None may be accepted, and
  // none may throw: a bad param still has to render a real dashboard.
  const junk: readonly unknown[] = [
    "60d",
    "all",
    "6m",
    "1y",
    "24h",
    "180d",
    "0d",
    "30D",
    " 30d",
    "",
    "   ",
    "7",
    "week",
    "<script>",
    7,
    30,
    null,
    undefined,
    true,
    { window: "30d" },
    ["30d"],
  ];

  for (const value of junk) {
    assert.equal(isReportingWindow(value), false, `${String(value)} must be rejected`);
    // With no completed scan to recover from, junk resolves to the default.
    assert.equal(
      resolveReportingWindow({ param: value, latestScan: null }),
      DEFAULT_REPORTING_WINDOW
    );
  }

  // A valid param is honoured exactly.
  for (const window of REPORTING_WINDOWS) {
    assert.equal(isReportingWindow(window), true);
    assert.equal(
      resolveReportingWindow({ param: window, latestScan: null }),
      window
    );
  }
});

test("any value at all resolves to a real reporting window", () => {
  fc.assert(
    fc.property(
      fc.oneof(
        fc.string(),
        fc.integer(),
        fc.double(),
        fc.boolean(),
        fc.constant(null),
        fc.constant(undefined),
        fc.array(fc.string()),
        fc.object()
      ),
      (value) => {
        const resolved = resolveReportingWindow({ param: value, latestScan: null });
        assert.ok(
          (REPORTING_WINDOWS as readonly string[]).includes(resolved),
          `${String(value)} resolved to ${resolved}`
        );
      }
    ),
    { numRuns: 200 }
  );
});

test("a repeated param resolves from its first value", () => {
  // `?window=7d&window=90d` arrives as an array.
  assert.equal(firstParamValue(["7d", "90d"]), "7d");
  assert.equal(firstParamValue("30d"), "30d");
  assert.equal(firstParamValue(undefined), undefined);
  assert.equal(firstParamValue([]), undefined);

  assert.equal(
    resolveReportingWindow({ param: firstParamValue(["7d", "90d"]), latestScan: null }),
    "7d"
  );
  // Still narrowed, not trusted: junk in the first slot falls back.
  assert.equal(
    resolveReportingWindow({ param: firstParamValue(["nope", "7d"]), latestScan: null }),
    DEFAULT_REPORTING_WINDOW
  );
});

// ===========================================================================
// Default recovered from the latest completed scan
// ===========================================================================

test("the latest scan's window is recovered from its stored bounds", () => {
  // A sync job persists concrete date bounds, never the window's name, so the
  // name has to be read back off those bounds.
  for (const window of REPORTING_WINDOWS) {
    const bounds = storedBounds(window);

    assert.equal(
      reportingWindowFromScanBounds(bounds.windowStart, bounds.windowEnd),
      window
    );
    // With no param, that recovered window IS the reported default.
    assert.equal(
      resolveReportingWindow({ param: undefined, latestScan: bounds }),
      window
    );
  }
});

test("bounds with no reporting equivalent fall back rather than being rounded", () => {
  // A 60-day scan is legitimate and has no reporting window. It must not be
  // rounded to 30 or 90 — it recovers nothing and the default is reported.
  const sixtyDay = storedBounds("60d");
  assert.equal(
    reportingWindowFromScanBounds(sixtyDay.windowStart, sixtyDay.windowEnd),
    null
  );
  assert.equal(
    resolveReportingWindow({ param: undefined, latestScan: sixtyDay }),
    DEFAULT_REPORTING_WINDOW
  );

  // Legacy wide scans, unreadable bounds, inverted bounds, missing bounds.
  const unusable: readonly { windowStart: string | null; windowEnd: string | null }[] = [
    { windowStart: "2025-12-17", windowEnd: "2026-06-15" }, // legacy 6m
    { windowStart: "1970-01-01", windowEnd: "2026-06-15" }, // legacy all-mail
    { windowStart: "2026-06-15", windowEnd: "2026-05-16" }, // inverted
    { windowStart: "not-a-date", windowEnd: "2026-06-15" },
    { windowStart: null, windowEnd: "2026-06-15" },
    { windowStart: "2026-05-16", windowEnd: null },
    { windowStart: null, windowEnd: null },
  ];

  for (const bounds of unusable) {
    assert.equal(
      reportingWindowFromScanBounds(bounds.windowStart, bounds.windowEnd),
      null
    );
    assert.equal(
      resolveReportingWindow({ param: undefined, latestScan: bounds }),
      DEFAULT_REPORTING_WINDOW
    );
  }

  // No scan has ever completed.
  assert.equal(
    resolveReportingWindow({ param: undefined, latestScan: null }),
    DEFAULT_REPORTING_WINDOW
  );
  assert.equal(resolveReportingWindow({ param: undefined }), DEFAULT_REPORTING_WINDOW);
});

test("an explicit param outranks the recovered scan window", () => {
  // The URL is the user's stated choice; the scan bounds are only a default.
  const bounds = storedBounds("90d");

  assert.equal(resolveReportingWindow({ param: "7d", latestScan: bounds }), "7d");
  // ...and junk does not outrank it: the recovered window still wins over the
  // hardcoded default.
  assert.equal(
    resolveReportingWindow({ param: "nonsense", latestScan: bounds }),
    "90d"
  );
});

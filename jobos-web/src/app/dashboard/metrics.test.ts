/**
 * Dashboard metrics tests.
 *
 * Property 18 of the gmail-application-precision design, plus the concrete
 * dashboard edge cases Requirements 11.4 and 11.5 name and the per-range
 * behaviour of `filterApplicationsByRange`.
 *
 * The module is pure, so no fake Supabase client and no network stub is needed.
 * Every call passes an explicit `now`, so a bucket boundary never depends on
 * the machine clock or the host timezone.
 *
 * The week span is recomputed here from `now` by walking back to Monday, rather
 * than by calling `resolveTrendWeeks`. Generating fixtures from the code under
 * test would make placement assertions tautological; an independent derivation
 * is what turns them into a cross-check.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import {
  computeWeeklyApplicationData,
  computeWeeklyTrend,
  filterApplicationsByRange,
  resolveTrendWeeks,
  summarizeEvidenceReasons,
  DASHBOARD_RANGES,
  WEEKS_IN_TREND,
  type DashboardRange,
} from "./metrics.ts";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

// ===========================================================================
// Independent reference derivations
// ===========================================================================

/**
 * Monday 00:00:00.000 UTC of the week containing `ms`, derived by stepping back
 * a day at a time until the UTC weekday is Monday. Deliberately naive: it
 * shares no arithmetic with the module's own `startOfUtcWeek`.
 */
function mondayOfUtcWeek(ms: number): number {
  const date = new Date(ms);
  let cursor = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  );
  while (new Date(cursor).getUTCDay() !== 1) {
    cursor -= MS_PER_DAY;
  }
  return cursor;
}

/** Inclusive bounds of the eight most recent complete weeks before `now`. */
function referenceSpan(now: Date): { startMs: number; endMs: number } {
  const currentWeekStart = mondayOfUtcWeek(now.getTime());
  return {
    startMs: currentWeekStart - WEEKS_IN_TREND * MS_PER_WEEK,
    endMs: currentWeekStart - 1,
  };
}

// ===========================================================================
// Generators
// ===========================================================================

/** Applied-date strings the strict parser must reject (Requirement 11.5). */
const UNPARSEABLE_DATES = [
  "",
  "   ",
  "not-a-date",
  "tomorrow",
  "5",
  "2026-06",
  "15/06/2026",
  "2026-13-01",
  "2026-02-30",
  "2026-06-15T99:99Z",
] as const;

/**
 * One generated application, described relative to the reported span so the
 * test knows its expected bucket by construction instead of by re-parsing.
 */
type DateSpec =
  | {
      kind: "inSpan";
      weekIndex: number;
      dayInWeek: number;
      msInDay: number;
      dateOnly: boolean;
    }
  | { kind: "beforeSpan"; daysBefore: number; msInDay: number }
  | { kind: "afterSpan"; daysAfter: number; msInDay: number }
  | { kind: "unparseable"; value: string };

const dateSpecArb: fc.Arbitrary<DateSpec> = fc.oneof(
  fc.record({
    kind: fc.constant<"inSpan">("inSpan"),
    weekIndex: fc.integer({ min: 0, max: WEEKS_IN_TREND - 1 }),
    dayInWeek: fc.integer({ min: 0, max: 6 }),
    msInDay: fc.integer({ min: 0, max: MS_PER_DAY - 1 }),
    dateOnly: fc.boolean(),
  }),
  fc.record({
    kind: fc.constant<"beforeSpan">("beforeSpan"),
    daysBefore: fc.integer({ min: 0, max: 400 }),
    msInDay: fc.integer({ min: 0, max: MS_PER_DAY - 1 }),
  }),
  fc.record({
    kind: fc.constant<"afterSpan">("afterSpan"),
    daysAfter: fc.integer({ min: 0, max: 400 }),
    msInDay: fc.integer({ min: 0, max: MS_PER_DAY - 1 }),
  }),
  fc.record({
    kind: fc.constant<"unparseable">("unparseable"),
    value: fc.constantFrom(...UNPARSEABLE_DATES),
  })
);

/** Reference instants spread over two decades, including leap years. */
const nowArb: fc.Arbitrary<Date> = fc
  .integer({ min: Date.UTC(2015, 0, 1), max: Date.UTC(2035, 0, 1) })
  .map((ms) => new Date(ms));

interface ResolvedSpec {
  appliedDate: string;
  /** Bucket the application must land in, or `null` when it must land in none. */
  expectedWeekIndex: number | null;
}

/** Turn a spec into the stored `appliedDate` string plus its expected bucket. */
function resolveSpec(spec: DateSpec, now: Date): ResolvedSpec {
  const { startMs, endMs } = referenceSpan(now);

  switch (spec.kind) {
    case "inSpan": {
      const dayMs =
        startMs + spec.weekIndex * MS_PER_WEEK + spec.dayInWeek * MS_PER_DAY;
      const instant = new Date(dayMs + spec.msInDay).toISOString();
      return {
        // A date-only value parses as midnight UTC of the same calendar day, so
        // it stays inside the same week either way.
        appliedDate: spec.dateOnly ? instant.slice(0, 10) : instant,
        expectedWeekIndex: spec.weekIndex,
      };
    }
    case "beforeSpan": {
      const ms = startMs - 1 - spec.daysBefore * MS_PER_DAY - spec.msInDay;
      return {
        appliedDate: new Date(ms).toISOString(),
        expectedWeekIndex: null,
      };
    }
    case "afterSpan": {
      const ms = endMs + 1 + spec.daysAfter * MS_PER_DAY + spec.msInDay;
      return {
        appliedDate: new Date(ms).toISOString(),
        expectedWeekIndex: null,
      };
    }
    case "unparseable":
      return { appliedDate: spec.value, expectedWeekIndex: null };
  }
}

// ===========================================================================
// Property 18
// ===========================================================================

// Feature: gmail-application-precision, Property 18: Weekly buckets are a
// complete, non-overlapping partition of the reported span
// Validates: Requirements 11.2, 11.3, 11.5, 11.6
test("Property 18: weekly buckets are a complete, non-overlapping partition of the reported span", () => {
  fc.assert(
    fc.property(
      nowArb,
      fc.array(dateSpecArb, { maxLength: 40 }),
      (now, specs) => {
        const resolved = specs.map((spec) => resolveSpec(spec, now));
        const applications = resolved.map(({ appliedDate }) => ({
          appliedDate,
        }));

        const weeks = resolveTrendWeeks(now);
        const series = computeWeeklyApplicationData(applications, now);

        // --- Requirement 11.2: exactly eight complete weeks, oldest first ---
        assert.equal(weeks.length, WEEKS_IN_TREND);
        assert.equal(series.length, WEEKS_IN_TREND);

        const { startMs, endMs } = referenceSpan(now);
        assert.equal(weeks[0].startMs, startMs);
        assert.equal(weeks[weeks.length - 1].endMs, endMs);

        for (let i = 0; i < weeks.length; i += 1) {
          // Starts exactly seven days apart, ascending.
          assert.equal(weeks[i].startMs, startMs + i * MS_PER_WEEK);
          // Contiguous and non-overlapping: each week ends 1ms before the next.
          assert.equal(weeks[i].endMs, weeks[i].startMs + MS_PER_WEEK - 1);
          if (i > 0) {
            assert.equal(weeks[i - 1].endMs + 1, weeks[i].startMs);
          }
          // The series is reported in the same oldest-to-newest order.
          assert.equal(series[i].week, weeks[i].label);
        }

        // Every reported week is complete: it ends before the current, partial
        // week begins.
        assert.ok(endMs < mondayOfUtcWeek(now.getTime()));

        // --- Requirement 11.3 / 11.5: one bucket per application, or none ---
        const expectedCounts = new Array<number>(WEEKS_IN_TREND).fill(0);
        for (const { appliedDate, expectedWeekIndex } of resolved) {
          if (expectedWeekIndex === null) continue;
          expectedCounts[expectedWeekIndex] += 1;

          // The partition covers this instant exactly once.
          const parsedMs = Date.parse(
            appliedDate.length === 10 ? `${appliedDate}T00:00:00.000Z` : appliedDate
          );
          const containing = weeks.filter(
            (week) => parsedMs >= week.startMs && parsedMs <= week.endMs
          );
          assert.equal(containing.length, 1);
          assert.equal(containing[0], weeks[expectedWeekIndex]);
        }

        assert.deepEqual(
          series.map((entry) => entry.applications),
          expectedCounts
        );

        // --- Requirement 11.6: the counts sum to the in-span population ---
        const inSpan = resolved.filter(
          ({ expectedWeekIndex }) => expectedWeekIndex !== null
        ).length;
        const total = series.reduce((sum, entry) => sum + entry.applications, 0);
        assert.equal(total, inSpan);
      }
    ),
    { numRuns: 100 }
  );
});

// ===========================================================================
// Edge cases (Requirements 11.4, 11.5)
// ===========================================================================

/** 2026-06-15 is a Monday, so the span is 2026-04-20 through 2026-06-14 UTC. */
const NOW = new Date("2026-06-15T12:00:00.000Z");

test("no applications yields eight zero-count weekly entries", () => {
  const series = computeWeeklyApplicationData([], NOW);

  assert.equal(series.length, WEEKS_IN_TREND);
  assert.deepEqual(
    series.map((entry) => entry.applications),
    [0, 0, 0, 0, 0, 0, 0, 0]
  );
  assert.deepEqual(
    series.map((entry) => entry.week),
    ["Apr 20", "Apr 27", "May 4", "May 11", "May 18", "May 25", "Jun 1", "Jun 8"]
  );
});

test("an unparseable applied date is excluded from every weekly bucket", () => {
  const series = computeWeeklyApplicationData(
    [
      { appliedDate: "not-a-date" },
      { appliedDate: "" },
      { appliedDate: "2026-02-30" },
      { appliedDate: "2026-13-01" },
      { appliedDate: "15/06/2026" },
      { appliedDate: "2026-06-10" },
    ],
    NOW
  );

  // Only the one real date is counted, in the week starting Jun 8.
  assert.deepEqual(
    series.map((entry) => entry.applications),
    [0, 0, 0, 0, 0, 0, 0, 1]
  );
  assert.equal(
    series.reduce((sum, entry) => sum + entry.applications, 0),
    1
  );
});

test("range filtering keeps the right applications for each DashboardRange", () => {
  const applications = [
    { id: "12h", appliedDate: "2026-06-15T00:00:00.000Z" },
    { id: "5d", appliedDate: "2026-06-10" },
    { id: "21d", appliedDate: "2026-05-25" },
    { id: "45d", appliedDate: "2026-05-01" },
    { id: "75d", appliedDate: "2026-04-01" },
    { id: "old", appliedDate: "2025-01-01" },
    { id: "bad", appliedDate: "not-a-date" },
  ];

  const expected: Record<DashboardRange, string[]> = {
    "24h": ["12h"],
    "7d": ["12h", "5d"],
    "30d": ["12h", "5d", "21d"],
    "60d": ["12h", "5d", "21d", "45d"],
    "90d": ["12h", "5d", "21d", "45d", "75d"],
    // An unfiltered view must not silently drop an unreadable date.
    all: ["12h", "5d", "21d", "45d", "75d", "old", "bad"],
  };

  for (const range of DASHBOARD_RANGES) {
    assert.deepEqual(
      filterApplicationsByRange(applications, range, NOW).map(({ id }) => id),
      expected[range],
      `range ${range}`
    );
  }

  // The cutoff itself is inclusive: exactly 24h before `now` still counts.
  assert.deepEqual(
    filterApplicationsByRange(
      [{ id: "cutoff", appliedDate: "2026-06-14T12:00:00.000Z" }],
      "24h",
      NOW
    ).map(({ id }) => id),
    ["cutoff"]
  );
});

// ===========================================================================
// Wiring helpers: the chart caption and the scan panel's ledger totals
// ===========================================================================

test("week-over-week trend compares the last two complete weeks", () => {
  const series = (counts: number[]) =>
    counts.map((applications, index) => ({
      week: `W${index}`,
      applications,
    }));

  assert.deepEqual(computeWeeklyTrend(series([0, 0, 0, 0, 0, 0, 4, 5])), {
    direction: "up",
    changePercent: 25,
    latest: 5,
    previous: 4,
  });

  assert.deepEqual(computeWeeklyTrend(series([0, 0, 0, 0, 0, 0, 8, 6])), {
    direction: "down",
    changePercent: -25,
    latest: 6,
    previous: 8,
  });

  assert.deepEqual(computeWeeklyTrend(series([0, 0, 0, 0, 0, 0, 3, 3])), {
    direction: "flat",
    changePercent: 0,
    latest: 3,
    previous: 3,
  });

  // No baseline to divide by: a percentage against zero would invent one.
  assert.deepEqual(computeWeeklyTrend(series([0, 0, 0, 0, 0, 0, 0, 2])), {
    direction: "up",
    changePercent: null,
    latest: 2,
    previous: 0,
  });

  // An empty series is flat with nothing to report, not a crash.
  assert.deepEqual(computeWeeklyTrend([]), {
    direction: "flat",
    changePercent: null,
    latest: 0,
    previous: 0,
  });
});

test("evidence reason totals split lifecycle from exclusions and count every row once", () => {
  const totals = summarizeEvidenceReasons({
    lifecycle_subject_match: 7,
    lifecycle_body_match: 3,
    excluded_job_alert: 20,
    excluded_marketing: 5,
    excluded_gmail_label: 2,
    application_url_only: 4,
    keyword_only: 6,
    // Rows written before the reason codes existed.
    unrecorded: 1,
  });

  assert.deepEqual(totals, { total: 48, lifecycle: 10, excluded: 27 });
  // Neither bucket may absorb a row that evidences nothing either way.
  assert.ok(totals.lifecycle + totals.excluded < totals.total);

  assert.deepEqual(summarizeEvidenceReasons({}), {
    total: 0,
    lifecycle: 0,
    excluded: 0,
  });
});

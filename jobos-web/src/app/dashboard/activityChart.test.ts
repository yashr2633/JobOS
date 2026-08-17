/**
 * Activity-series regression tests.
 *
 * These pin the chart bug: the dashboard chart used `computeWeeklyApplicationData`,
 * which always buckets into eight FIXED complete weeks and deliberately EXCLUDES
 * the current partial week. Consequences the user saw:
 *
 *   * all three range selections drew the same eight weeks, so 7/30/90 did nothing;
 *   * a 7-day selection put almost every application inside the excluded current
 *     week, so a user who had just applied saw an all-zero chart.
 *
 * `computeActivitySeries` spans exactly the selected window and its final bucket
 * includes today. The old function is unchanged and still feeds the week-over-week
 * trend figure.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import {
  computeActivitySeries,
  computeWeeklyApplicationData,
} from "./metrics.ts";
import { computeWindowReport } from "./report.ts";
import type { ApplicationStatus } from "../applications/types.ts";

const NOW = new Date("2026-08-17T12:00:00.000Z");
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * MS_PER_DAY).toISOString().slice(0, 10);
}

function app(days: number, status: ApplicationStatus = "Applied") {
  return {
    appliedDate: daysAgo(days),
    status,
    jobPortal: "LinkedIn",
  };
}

// ---------------------------------------------------------------------------
// The range selector actually changes the chart
// ---------------------------------------------------------------------------

test("7 days produces seven daily buckets", () => {
  const series = computeActivitySeries([], 7, NOW);
  assert.equal(series.granularity, "day");
  assert.equal(series.buckets.length, 7);
});

test("30 days produces thirty daily buckets", () => {
  const series = computeActivitySeries([], 30, NOW);
  assert.equal(series.granularity, "day");
  assert.equal(series.buckets.length, 30);
});

test("90 days switches to weekly buckets", () => {
  const series = computeActivitySeries([], 90, NOW);
  assert.equal(series.granularity, "week");
  // ceil(90/7) = 13 weeks.
  assert.equal(series.buckets.length, 13);
});

test("the three ranges produce genuinely different series", () => {
  const data = [app(1), app(10), app(45)];

  const seven = computeActivitySeries(data, 7, NOW);
  const thirty = computeActivitySeries(data, 30, NOW);
  const ninety = computeActivitySeries(data, 90, NOW);

  assert.equal(seven.total, 1, "only the 1-day-old application");
  assert.equal(thirty.total, 2, "adds the 10-day-old one");
  assert.equal(ninety.total, 3, "adds the 45-day-old one");

  assert.notDeepEqual(seven.buckets.length, thirty.buckets.length);
  assert.notDeepEqual(thirty.granularity, ninety.granularity);
});

// ---------------------------------------------------------------------------
// THE BUG: today's activity must be visible
// ---------------------------------------------------------------------------

test("an application from today is counted in the last bucket", () => {
  const series = computeActivitySeries([app(0)], 7, NOW);

  assert.equal(series.total, 1);
  assert.equal(
    series.buckets[series.buckets.length - 1].count,
    1,
    "today lands in the final bucket, not outside the series"
  );
});

test("recent applications are visible on a 7-day view — the regression", () => {
  // Every one of these is inside the current week, which the OLD function
  // excluded. This is the exact scenario that produced an empty chart.
  const data = [app(0), app(1), app(2), app(3)];

  const series = computeActivitySeries(data, 7, NOW);
  assert.equal(series.total, 4, "all four are counted");
  assert.ok(series.peak > 0, "the chart has something to draw");

  // Document the old behaviour precisely, so this test explains itself.
  //
  // NOW is a Monday, so the current week starts today. The eight-week series
  // excludes that partial week, which means it loses today's application while
  // keeping the three from the previous week. The loss grows as the week
  // progresses: by Sunday the fixed series omits SEVEN days of activity, which is
  // how a 7-day view ended up empty.
  const legacy = computeWeeklyApplicationData(data, NOW);
  const legacyTotal = legacy.reduce((sum, week) => sum + week.applications, 0);

  assert.ok(
    legacyTotal < series.total,
    `the fixed series undercounts recent activity (${legacyTotal} vs ${series.total})`
  );
  assert.equal(legacyTotal, 3, "it drops exactly today's application here");
});

test("a full week of activity is entirely invisible to the fixed series", () => {
  // Late in the week the fixed eight-week series omits every day of it. This is
  // the worst case of the same defect, and the reason a 7-day chart looked empty.
  const sunday = new Date("2026-08-23T12:00:00.000Z");
  const daysAgoFrom = (base: Date, days: number) =>
    new Date(base.getTime() - days * MS_PER_DAY).toISOString().slice(0, 10);

  // Six applications, all inside the week containing `sunday`.
  const data = [0, 1, 2, 3, 4, 5].map((offset) => ({
    appliedDate: daysAgoFrom(sunday, offset),
    status: "Applied" as ApplicationStatus,
    jobPortal: "LinkedIn",
  }));

  const legacy = computeWeeklyApplicationData(data, sunday);
  assert.equal(
    legacy.reduce((sum, week) => sum + week.applications, 0),
    0,
    "the fixed series shows nothing at all"
  );

  const series = computeActivitySeries(data, 7, sunday);
  assert.equal(series.total, 6, "the range-aware series shows all six");
});

// ---------------------------------------------------------------------------
// Zero activity is truthful, never a fabricated value
// ---------------------------------------------------------------------------

test("an empty period yields all-zero buckets and a zero peak", () => {
  const series = computeActivitySeries([], 30, NOW);

  assert.equal(series.total, 0);
  assert.equal(series.peak, 0, "the component renders an empty state, not bars");
  assert.ok(series.buckets.every((bucket) => bucket.count === 0));
  // Never a placeholder value — and specifically never 100.
  assert.ok(!series.buckets.some((bucket) => bucket.count === 100));
});

test("applications outside the window do not leak into the series", () => {
  const series = computeActivitySeries([app(200), app(365)], 30, NOW);
  assert.equal(series.total, 0);
  assert.equal(series.peak, 0);
});

test("an unparseable applied date is counted nowhere, never coerced to today", () => {
  const series = computeActivitySeries(
    [{ appliedDate: "not-a-date" }, { appliedDate: "" }, { appliedDate: "5" }],
    7,
    NOW
  );
  assert.equal(series.total, 0);
});

// ---------------------------------------------------------------------------
// Bucket integrity
// ---------------------------------------------------------------------------

test("buckets are contiguous, non-overlapping, and oldest first", () => {
  for (const days of [7, 30, 90]) {
    const { buckets } = computeActivitySeries([], days, NOW);

    for (let i = 1; i < buckets.length; i += 1) {
      assert.equal(
        buckets[i].startMs,
        buckets[i - 1].endMs + 1,
        `${days}d: bucket ${i} starts exactly where the previous ended`
      );
      assert.ok(buckets[i].startMs > buckets[i - 1].startMs, "oldest first");
    }
  }
});

test("every bucket carries a label and a full label", () => {
  for (const days of [7, 30, 90]) {
    for (const bucket of computeActivitySeries([], days, NOW).buckets) {
      assert.ok(bucket.label.length > 0, `${days}d: label present`);
      assert.ok(bucket.fullLabel.length > 0, `${days}d: full label present`);
    }
  }
});

test("labelEvery keeps the axis readable at every range", () => {
  // ~6 labels regardless of bucket count, so 30 daily bars do not overlap.
  for (const days of [7, 30, 90]) {
    const series = computeActivitySeries([], days, NOW);
    const shown = series.buckets.filter(
      (_, index) => index % series.labelEvery === 0
    ).length;
    assert.ok(shown <= 8, `${days}d: at most 8 labels (saw ${shown})`);
    assert.ok(shown >= 1, `${days}d: at least one label`);
  }
});

test("Property: bucket counts always sum to the reported total", () => {
  fc.assert(
    fc.property(
      fc.array(fc.integer({ min: 0, max: 400 }), { maxLength: 120 }),
      fc.constantFrom(7, 30, 90),
      (offsets, days) => {
        const series = computeActivitySeries(
          offsets.map((offset) => app(offset)),
          days,
          NOW
        );
        const sum = series.buckets.reduce((acc, b) => acc + b.count, 0);
        return sum === series.total;
      }
    ),
    { numRuns: 300 }
  );
});

test("Property: peak is the true maximum bucket count", () => {
  fc.assert(
    fc.property(
      fc.array(fc.integer({ min: 0, max: 120 }), { maxLength: 80 }),
      fc.constantFrom(7, 30, 90),
      (offsets, days) => {
        const series = computeActivitySeries(
          offsets.map((offset) => app(offset)),
          days,
          NOW
        );
        const max = series.buckets.reduce((m, b) => Math.max(m, b.count), 0);
        return series.peak === max;
      }
    ),
    { numRuns: 250 }
  );
});

test("Property: the series never invents activity", () => {
  fc.assert(
    fc.property(fc.constantFrom(7, 30, 90), (days) => {
      // No applications in, so nothing may come out.
      const series = computeActivitySeries([], days, NOW);
      return series.total === 0 && series.peak === 0;
    }),
    { numRuns: 20 }
  );
});

test("Property: computation is total and never throws", () => {
  fc.assert(
    fc.property(
      fc.array(fc.record({ appliedDate: fc.string() }), { maxLength: 40 }),
      fc.integer({ min: -5, max: 400 }),
      (rows, days) => {
        computeActivitySeries(rows, days, NOW);
        return true;
      }
    ),
    { numRuns: 200 }
  );
});

// ---------------------------------------------------------------------------
// The report wires the series to the selected window
// ---------------------------------------------------------------------------

test("the window report carries a series matching its own window", () => {
  const data = [app(1), app(2), app(40)];

  const seven = computeWindowReport(data, "7d", NOW);
  assert.equal(seven.activity.granularity, "day");
  assert.equal(seven.activity.buckets.length, 7);
  assert.equal(seven.activity.total, 2);

  const ninety = computeWindowReport(data, "90d", NOW);
  assert.equal(ninety.activity.granularity, "week");
  assert.equal(ninety.activity.total, 3);
});

test("the chart series total never exceeds the window's application count", () => {
  const data = [app(1), app(5), app(20), app(80)];

  for (const window of ["7d", "30d", "90d"] as const) {
    const report = computeWindowReport(data, window, NOW);
    assert.ok(
      report.activity.total <= report.totalApplications,
      `${window}: the chart cannot show more than the window contains`
    );
  }
});

test("the fixed eight-week trend is still produced, unchanged", () => {
  // The trend figure keeps its own series; this pass did not alter it.
  const report = computeWindowReport([app(1)], "30d", NOW);
  assert.equal(report.trend.length, 8);
  assert.ok(report.trendMovement !== undefined);
});

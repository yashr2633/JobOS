/**
 * The dashboard's reporting semantics for 7 / 30 / 90 days.
 *
 * What these tests exist to protect, in one sentence: an application KPI counts
 * rows of the `applications` table whose applied date falls in the window, and it
 * is completely independent of what any Gmail scan read.
 *
 * The concrete failure being fenced off is the one that made the old dashboard
 * lie — a second scan of the same window finds every message already tracked,
 * reports 0 fresh messages, and the page reads as though the user has no
 * applications. `computeWindowReport` cannot do that, because no message counter
 * is one of its inputs; the tests below assert both the counts and that
 * independence.
 *
 * Pure units: no network, no Supabase, no React. `now` is always injected, so a
 * window boundary never depends on the machine clock or the host timezone.
 */

import test from "node:test";
import assert from "node:assert/strict";

import type { ApplicationStatus } from "../applications/types.ts";
import { computeWindowReport, kpiHref, type ReportableApplication } from "./report.ts";
import { REPORTING_WINDOWS, type ReportingWindow } from "./reportingWindow.ts";
import { describeScanCounts, describeScanOutcome } from "./scanRunner.ts";

/** Fixed clock. 7d cuts at 2026-06-08T12:00Z, 30d at 2026-05-16T12:00Z, 90d at 2026-03-17T12:00Z. */
const NOW = new Date("2026-06-15T12:00:00.000Z");

function application(
  appliedDate: string,
  status: ApplicationStatus,
  jobPortal = "LinkedIn"
): ReportableApplication {
  return { appliedDate, status, jobPortal };
}

/**
 * One persisted set spanning all three windows, plus rows outside every window
 * and one row whose date cannot be parsed.
 */
const APPLICATIONS: readonly ReportableApplication[] = [
  // Inside 7 days.
  application("2026-06-15", "Applied", "LinkedIn"),
  application("2026-06-12", "Interview", "Naukri"),
  application("2026-06-09", "Applied", ""),
  // Inside 30 days, outside 7.
  application("2026-06-01", "Offer", "LinkedIn"),
  application("2026-05-20", "Rejected", "Indeed"),
  application("2026-05-17", "Applied", "LinkedIn"),
  // Inside 90 days, outside 30.
  application("2026-05-01", "Ghosted", "Gmail"),
  application("2026-04-02", "Applied", "Gmail"),
  application("2026-03-18", "Interview", "LinkedIn"),
  // Outside every window.
  application("2026-01-05", "Applied", "LinkedIn"),
  application("2025-11-11", "Rejected", "Indeed"),
  // Unplaceable, so counted nowhere.
  application("not-a-date", "Applied", "LinkedIn"),
];

/** What each window must report over the set above. */
const EXPECTED: Record<
  ReportingWindow,
  { total: number; statuses: Record<ApplicationStatus, number> }
> = {
  "7d": {
    total: 3,
    statuses: { Applied: 2, Interview: 1, Offer: 0, Rejected: 0, Ghosted: 0 },
  },
  "30d": {
    total: 6,
    statuses: { Applied: 3, Interview: 1, Offer: 1, Rejected: 1, Ghosted: 0 },
  },
  "90d": {
    total: 9,
    statuses: { Applied: 4, Interview: 2, Offer: 1, Rejected: 1, Ghosted: 1 },
  },
};

// ===========================================================================
// Complete-window reporting
// ===========================================================================

test("each window reports the complete set of applications inside it", () => {
  for (const window of REPORTING_WINDOWS) {
    const report = computeWindowReport(APPLICATIONS, window, NOW);
    const expected = EXPECTED[window];

    assert.equal(report.window, window);
    assert.equal(report.totalApplications, expected.total, `total for ${window}`);
    // The reported rows ARE the count: not a stored counter, not a sample.
    assert.equal(report.applications.length, expected.total);
    assert.deepEqual(report.statusCounts, expected.statuses, `statuses for ${window}`);

    // The status buckets partition the window exactly — nothing double-counted,
    // nothing dropped.
    const summed = Object.values(report.statusCounts).reduce((a, b) => a + b, 0);
    assert.equal(summed, report.totalApplications);
  }

  // A wider window can only ever report at least as much as a narrower one.
  const seven = computeWindowReport(APPLICATIONS, "7d", NOW).totalApplications;
  const thirty = computeWindowReport(APPLICATIONS, "30d", NOW).totalApplications;
  const ninety = computeWindowReport(APPLICATIONS, "90d", NOW).totalApplications;
  assert.ok(seven <= thirty && thirty <= ninety);
});

test("the trend series always covers eight weeks and never exceeds the window", () => {
  for (const window of REPORTING_WINDOWS) {
    const report = computeWindowReport(APPLICATIONS, window, NOW);

    assert.equal(report.trend.length, 8);
    const charted = report.trend.reduce((total, week) => total + week.applications, 0);
    // The chart can show fewer than the window holds (its span is eight complete
    // weeks), but never more — a bar can only come from a row in the window.
    assert.ok(
      charted <= report.totalApplications,
      `${window}: charted ${charted} exceeds ${report.totalApplications}`
    );
  }
});

// ===========================================================================
// A repeated scan still reports the whole window
// ===========================================================================

test("a repeated scan of each window still reports the complete window", () => {
  // Three runs over the same window: a first scan that read a lot of new mail, a
  // second that found everything already tracked (0 fresh), and a third that
  // reported nothing at all. What the scan read cannot enter the calculation, so
  // all three renders are identical.
  const scanRuns = [
    { listed: 243, deduplicated: 0, fresh: 243, created: 12, updated: 6 },
    { listed: 243, deduplicated: 243, fresh: 0, created: 0, updated: 0 },
    { listed: null, deduplicated: null, fresh: null, created: null, updated: null },
  ];

  for (const window of REPORTING_WINDOWS) {
    const expected = EXPECTED[window];

    for (const run of scanRuns) {
      const report = computeWindowReport(APPLICATIONS, window, NOW);

      assert.equal(
        report.totalApplications,
        expected.total,
        `${window} after a scan reporting fresh=${String(run.fresh)}`
      );
      assert.deepEqual(report.statusCounts, expected.statuses);

      // The scan's own counts are still reported honestly, and separately.
      const outcome = describeScanOutcome({
        listed: run.listed,
        deduplicated: run.deduplicated,
        fresh: run.fresh,
        windowDays: report.windowDays,
      });
      assert.ok(outcome.headline.length > 0);
    }
  }
});

test("messagesFresh is not the application count, and zero fresh hides nothing", () => {
  // 22 applications persisted inside the 30-day window.
  const persisted = Array.from({ length: 22 }, (_, index) =>
    application(
      new Date(NOW.getTime() - (index + 1) * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10),
      index % 2 === 0 ? "Applied" : "Interview"
    )
  );

  // Today's scan of the same window read no new mail at all.
  const messagesFresh = 0;
  const messagesListed = 1_984;
  const messagesDeduplicated = 1_984;

  const report = computeWindowReport(persisted, "30d", NOW);

  // The window is reported in full. Not 0, and not the fresh count.
  assert.equal(report.totalApplications, 22);
  assert.notEqual(report.totalApplications, messagesFresh);
  assert.notEqual(report.totalApplications, messagesListed);
  assert.equal(report.statusCounts.Applied, 11);
  assert.equal(report.statusCounts.Interview, 11);

  // And the scan says what actually happened rather than "nothing found".
  const outcome = describeScanOutcome({
    listed: messagesListed,
    deduplicated: messagesDeduplicated,
    fresh: messagesFresh,
    windowDays: report.windowDays,
  });
  assert.equal(outcome.headline, "No new mail since your last scan.");
  assert.ok(outcome.detail?.includes("already tracked"));
});

test("message counts and application counts are reported as different things", () => {
  const line = describeScanCounts({
    messagesListed: 243,
    applicationRelated: 18,
    applicationsCreated: 8,
    applicationsUpdated: 4,
  });

  assert.equal(
    line,
    "243 Gmail messages processed · 18 application-related · 12 applications created or updated"
  );

  // An unreported figure produces no segment, and nothing reported produces no
  // line at all — never a row of zeros standing in for unknowns.
  assert.equal(
    describeScanCounts({
      messagesListed: 243,
      applicationRelated: null,
      applicationsCreated: null,
      applicationsUpdated: null,
    }),
    "243 Gmail messages processed"
  );
  assert.equal(
    describeScanCounts({
      messagesListed: null,
      applicationRelated: null,
      applicationsCreated: null,
      applicationsUpdated: null,
    }),
    null
  );
});

// ===========================================================================
// Empty and honest-empty cases
// ===========================================================================

test("an empty window reports zeros and no fabricated breakdown", () => {
  const report = computeWindowReport(APPLICATIONS, "7d", new Date("2027-01-01T00:00:00.000Z"));

  assert.equal(report.totalApplications, 0);
  assert.deepEqual(report.statusCounts, {
    Applied: 0,
    Interview: 0,
    Offer: 0,
    Rejected: 0,
    Ghosted: 0,
  });
  assert.deepEqual(report.portals, []);
  assert.equal(report.hasPortalBreakdown, false);
  assert.equal(report.trend.length, 8);
  assert.deepEqual(
    report.trend.map((week) => week.applications),
    [0, 0, 0, 0, 0, 0, 0, 0]
  );
});

test("a portal breakdown renders only when it says something", () => {
  const ninety = computeWindowReport(APPLICATIONS, "90d", NOW);
  assert.equal(ninety.hasPortalBreakdown, true);
  // Busiest first, blank portals reported as Unknown rather than dropped.
  assert.deepEqual(ninety.portals[0], { portal: "LinkedIn", count: 4 });
  assert.equal(
    ninety.portals.reduce((total, entry) => total + entry.count, 0),
    ninety.totalApplications
  );

  // Every source blank: one "Unknown" bar states nothing, so it is suppressed.
  const sourceless = computeWindowReport(
    [application("2026-06-14", "Applied", ""), application("2026-06-13", "Applied", "  ")],
    "7d",
    NOW
  );
  assert.equal(sourceless.totalApplications, 2);
  assert.deepEqual(sourceless.portals, [{ portal: "Unknown", count: 2 }]);
  assert.equal(sourceless.hasPortalBreakdown, false);
});

// ===========================================================================
// The KPI link contract with /applications
// ===========================================================================

test("KPI links carry the status and window params the list page reads", () => {
  assert.equal(kpiHref("30d"), "/applications?window=30d");
  assert.equal(kpiHref("7d", "Applied"), "/applications?status=Applied&window=7d");
  assert.equal(kpiHref("30d", "Interview"), "/applications?status=Interview&window=30d");
  assert.equal(kpiHref("90d", "Offer"), "/applications?status=Offer&window=90d");
  assert.equal(kpiHref("90d", "Rejected"), "/applications?status=Rejected&window=90d");

  // Every reporting window is expressible in a link, and the value in the URL is
  // the window value itself — no second vocabulary in the query string.
  for (const window of REPORTING_WINDOWS) {
    assert.ok(kpiHref(window).endsWith(`window=${window}`));
  }
});

/**
 * Status-consistency regression tests.
 *
 * These exist because of a real, user-visible defect: the Dashboard could report
 * Ghosted = 0 while the Applications list was full of Ghosted applications.
 *
 * The investigation found TWO causes, and these tests pin both:
 *
 *  1. The Applications summary could not represent Ghosted or Offer at all — its
 *     shape carried only total/active/interviews/rejected. Now both surfaces use
 *     the one `StatusSummary`, so a status cannot be missing from a screen.
 *
 *  2. The two surfaces report over different SCOPES. The Dashboard filters by a
 *     reporting window (30 days by default); the Applications page defaults to
 *     all time. Ghosted is derived from prolonged silence, so a Ghosted
 *     application's applied date is old by construction and a narrow window
 *     legitimately contains none. The invariant that matters is therefore
 *     "same rows in, same counts out", which is what these tests assert.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import type { Application, ApplicationStatus } from "../applications/types.ts";
import { computeApplicationStats } from "../applications/utils.ts";
import { applyApplicationFilters } from "../applications/filters.ts";
import {
  ACTIVE_STATUSES,
  ALL_APPLICATION_STATUSES,
  CLOSED_STATUSES,
  computeStatusDistribution,
  filterApplicationsByRange,
  summarizeApplicationStatuses,
} from "./metrics.ts";
import { computeWindowReport } from "./report.ts";

const NOW = new Date("2026-08-17T12:00:00.000Z");

/** Days before NOW, as the stored YYYY-MM-DD applied_date. */
function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

function app(
  status: ApplicationStatus,
  days: number,
  overrides: Partial<Application> = {}
): Application {
  return {
    id: overrides.id ?? `${status}-${days}-${Math.random()}`,
    company: overrides.company ?? "Acme",
    role: overrides.role ?? "Engineer",
    location: overrides.location ?? "Remote",
    jobPortal: overrides.jobPortal ?? "LinkedIn",
    appliedDate: daysAgo(days),
    status,
    ...overrides,
  };
}

/**
 * A dataset that reproduces the reported symptom: Ghosted applications exist,
 * and every one of them is older than the 30-day default window.
 */
const DATASET: Application[] = [
  app("Applied", 2),
  app("Applied", 10),
  app("Interview", 5),
  app("Offer", 20),
  app("Rejected", 12),
  // Ghosted is derived from long silence, so these are necessarily old.
  app("Ghosted", 60),
  app("Ghosted", 75),
  app("Ghosted", 120),
];

// ---------------------------------------------------------------------------
// The reported bug: Ghosted must be counted, and must be representable
// ---------------------------------------------------------------------------

test("Ghosted applications are counted from the stored status", () => {
  const summary = summarizeApplicationStatuses(DATASET);
  assert.equal(summary.ghosted, 3, "all three Ghosted rows are counted");
});

test("the Applications summary can represent every status", () => {
  const stats = computeApplicationStats(DATASET);

  // The previous shape had no offer/ghosted field at all — this is the
  // regression guard for that.
  for (const key of ["total", "active", "applied", "interview", "offer", "rejected", "ghosted"]) {
    assert.ok(key in stats, `the summary carries ${key}`);
  }
  assert.equal(stats.ghosted, 3);
  assert.equal(stats.offer, 1);
});

test("Dashboard Ghosted count equals Applications Ghosted count for the same scope", () => {
  // All time, on both surfaces.
  const dashboardAllTime = computeStatusDistribution(DATASET);
  const applicationsAllTime = computeApplicationStats(DATASET);

  assert.equal(applicationsAllTime.ghosted, dashboardAllTime.Ghosted);
  assert.equal(applicationsAllTime.offer, dashboardAllTime.Offer);
  assert.equal(applicationsAllTime.interview, dashboardAllTime.Interview);
  assert.equal(applicationsAllTime.rejected, dashboardAllTime.Rejected);
  assert.equal(applicationsAllTime.applied, dashboardAllTime.Applied);
});

test("the two surfaces agree window-for-window, including the 90d case", () => {
  for (const window of ["7d", "30d", "90d"] as const) {
    // Dashboard path.
    const report = computeWindowReport(DATASET, window, NOW);

    // Applications path: the summary counts the window-filtered set.
    const scope = applyApplicationFilters(
      DATASET,
      { status: "All", window, search: "" },
      NOW
    );
    const stats = computeApplicationStats(scope);

    assert.equal(
      stats.total,
      report.totalApplications,
      `${window}: totals agree`
    );
    assert.equal(
      stats.ghosted,
      report.statusCounts.Ghosted,
      `${window}: Ghosted agrees`
    );
    assert.equal(stats.offer, report.statusCounts.Offer, `${window}: Offer agrees`);
    assert.equal(
      stats.rejected,
      report.statusCounts.Rejected,
      `${window}: Rejected agrees`
    );
  }
});

test("the scope difference is real and explains the reported symptom", () => {
  // This documents WHY a user saw 0 on one screen and many on the other. It is
  // a scope difference, not an arithmetic error — and both numbers are correct
  // for what they count.
  const thirtyDay = computeWindowReport(DATASET, "30d", NOW);
  const allTime = computeApplicationStats(DATASET);

  assert.equal(thirtyDay.statusCounts.Ghosted, 0, "no Ghosted row is that recent");
  assert.equal(allTime.ghosted, 3, "all time sees all three");
  // Which is exactly why the Applications summary now names its scope.
});

// ---------------------------------------------------------------------------
// No double counting, nothing unaccounted for
// ---------------------------------------------------------------------------

test("Active is exactly Applied + Interview + Offer", () => {
  const summary = summarizeApplicationStatuses(DATASET);
  assert.equal(
    summary.active,
    summary.applied + summary.interview + summary.offer
  );
});

test("Rejected and Ghosted are not Active", () => {
  for (const status of CLOSED_STATUSES) {
    assert.ok(
      !ACTIVE_STATUSES.includes(status),
      `${status} must not count as Active`
    );
  }
});

test("Active and closed statuses partition the five statuses exactly once", () => {
  const partition = [...ACTIVE_STATUSES, ...CLOSED_STATUSES];

  assert.equal(
    partition.length,
    ALL_APPLICATION_STATUSES.length,
    "every status is in exactly one group"
  );
  assert.equal(
    new Set(partition).size,
    partition.length,
    "no status appears in both groups"
  );
  for (const status of ALL_APPLICATION_STATUSES) {
    assert.ok(partition.includes(status), `${status} is accounted for`);
  }
});

test("Property: the status buckets sum to the total", () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.record({
          status: fc.constantFrom<ApplicationStatus>(
            "Applied",
            "Interview",
            "Offer",
            "Rejected",
            "Ghosted"
          ),
        }),
        { maxLength: 200 }
      ),
      (rows) => {
        const s = summarizeApplicationStatuses(rows);
        return (
          s.applied + s.interview + s.offer + s.rejected + s.ghosted === s.total
        );
      }
    ),
    { numRuns: 300 }
  );
});

test("Property: no application is counted in two status buckets", () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.constantFrom<ApplicationStatus>(
          "Applied",
          "Interview",
          "Offer",
          "Rejected",
          "Ghosted"
        ),
        { maxLength: 150 }
      ),
      (statuses) => {
        const rows = statuses.map((status) => ({ status }));
        const s = summarizeApplicationStatuses(rows);

        // Counting each status independently must reproduce every bucket.
        for (const status of ALL_APPLICATION_STATUSES) {
          const expected = statuses.filter((value) => value === status).length;
          const actual = {
            Applied: s.applied,
            Interview: s.interview,
            Offer: s.offer,
            Rejected: s.rejected,
            Ghosted: s.ghosted,
          }[status];
          if (actual !== expected) return false;
        }
        return true;
      }
    ),
    { numRuns: 300 }
  );
});

// ---------------------------------------------------------------------------
// The surfaces cannot disagree, for any dataset
// ---------------------------------------------------------------------------

test("Property: identical rows always yield identical counts on both surfaces", () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.record({
          status: fc.constantFrom<ApplicationStatus>(
            "Applied",
            "Interview",
            "Offer",
            "Rejected",
            "Ghosted"
          ),
          days: fc.integer({ min: 0, max: 400 }),
        }),
        { maxLength: 120 }
      ),
      fc.constantFrom("7d" as const, "30d" as const, "90d" as const),
      (rows, window) => {
        const dataset = rows.map((row) => app(row.status, row.days));

        const report = computeWindowReport(dataset, window, NOW);
        const scope = applyApplicationFilters(
          dataset,
          { status: "All", window, search: "" },
          NOW
        );
        const stats = computeApplicationStats(scope);

        return (
          stats.total === report.totalApplications &&
          stats.applied === report.statusCounts.Applied &&
          stats.interview === report.statusCounts.Interview &&
          stats.offer === report.statusCounts.Offer &&
          stats.rejected === report.statusCounts.Rejected &&
          stats.ghosted === report.statusCounts.Ghosted
        );
      }
    ),
    { numRuns: 250 }
  );
});

test("the window filters used by both surfaces are the same function", () => {
  // The Applications page delegates its window half to the Dashboard's filter.
  // Asserting they agree on a dataset guards against one of them being
  // reimplemented later.
  for (const window of ["7d", "30d", "90d"] as const) {
    const viaDashboard = filterApplicationsByRange(DATASET, window, NOW);
    const viaApplications = applyApplicationFilters(
      DATASET,
      { status: "All", window, search: "" },
      NOW
    );

    assert.deepEqual(
      viaApplications.map((a) => a.id).sort(),
      viaDashboard.map((a) => a.id).sort(),
      `${window}: both surfaces select the same rows`
    );
  }
});

// ---------------------------------------------------------------------------
// A status change moves both surfaces together
// ---------------------------------------------------------------------------

test("changing a status updates both surfaces consistently", () => {
  const before = [app("Applied", 3, { id: "target" }), app("Interview", 4)];

  const beforeStats = computeApplicationStats(before);
  const beforeReport = computeWindowReport(before, "30d", NOW);
  assert.equal(beforeStats.applied, 1);
  assert.equal(beforeReport.statusCounts.Applied, 1);
  assert.equal(beforeStats.ghosted, 0);

  // The same row, now Ghosted. Its applied date is unchanged, so it stays in
  // the window — which isolates the status change from the scope question.
  const after = before.map((row) =>
    row.id === "target" ? { ...row, status: "Ghosted" as ApplicationStatus } : row
  );

  const afterStats = computeApplicationStats(after);
  const afterReport = computeWindowReport(after, "30d", NOW);

  assert.equal(afterStats.applied, 0, "Applied dropped on Applications");
  assert.equal(afterReport.statusCounts.Applied, 0, "Applied dropped on Dashboard");
  assert.equal(afterStats.ghosted, 1, "Ghosted rose on Applications");
  assert.equal(afterReport.statusCounts.Ghosted, 1, "Ghosted rose on Dashboard");
  assert.equal(
    afterStats.ghosted,
    afterReport.statusCounts.Ghosted,
    "and they agree"
  );

  // Total is unchanged: a status change moves a row between buckets, never in
  // or out of the dataset.
  assert.equal(afterStats.total, beforeStats.total);
});

test("Active shrinks when an application closes", () => {
  const open = [app("Applied", 1), app("Interview", 2), app("Offer", 3)];
  assert.equal(computeApplicationStats(open).active, 3);

  const closed = open.map((row, index) =>
    index === 0 ? { ...row, status: "Ghosted" as ApplicationStatus } : row
  );
  const stats = computeApplicationStats(closed);

  assert.equal(stats.active, 2, "Ghosted no longer counts as Active");
  assert.equal(stats.ghosted, 1);
  assert.equal(stats.total, 3, "the row did not leave the dataset");
});

// ---------------------------------------------------------------------------
// The canonical function is the only aggregation
// ---------------------------------------------------------------------------

test("the Applications summary is a delegation, adding no arithmetic of its own", () => {
  // If this ever diverges, the two screens can disagree again.
  fc.assert(
    fc.property(
      fc.array(
        fc.record({
          status: fc.constantFrom<ApplicationStatus>(
            "Applied",
            "Interview",
            "Offer",
            "Rejected",
            "Ghosted"
          ),
          days: fc.integer({ min: 0, max: 90 }),
        }),
        { maxLength: 80 }
      ),
      (rows) => {
        const dataset = rows.map((row) => app(row.status, row.days));
        return (
          JSON.stringify(computeApplicationStats(dataset)) ===
          JSON.stringify(summarizeApplicationStatuses(dataset))
        );
      }
    ),
    { numRuns: 200 }
  );
});

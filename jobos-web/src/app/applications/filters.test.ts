/**
 * Applications filter-resolution tests.
 *
 * Covers the two query-parameter guards behind the dashboard KPI drill-down and
 * the combined narrowing they produce. The module under test is pure, so there
 * is no React, no Supabase client and no component runner involved — which is
 * exactly why the filter resolution lives outside the component.
 *
 * Every call passes an explicit `now`, so a window boundary never depends on the
 * machine clock. Fixture dates are written as offsets from that `now` and
 * converted with plain arithmetic here rather than by calling the module, so the
 * assertions cross-check the implementation instead of restating it.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  ALL_WINDOWS,
  APPLICATION_WINDOWS,
  applyApplicationFilters,
  describeWindow,
  hasActiveFilters,
  isApplicationWindow,
  parseStatusParam,
  parseWindowParam,
  resolveFiltersFromParams,
  NO_APPLICATION_FILTERS,
  type ApplicationFilters,
} from "./filters.ts";
import type { Application, ApplicationStatus } from "./types.ts";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Fixed clock. Mid-month and mid-day, so no window edge lands on a boundary. */
const NOW = new Date("2025-06-15T12:00:00.000Z");

/** `YYYY-MM-DD`, the stored form of `applied_date`, `days` before `NOW`. */
function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
}

function app(
  id: string,
  status: ApplicationStatus,
  appliedDaysAgo: number
): Application {
  return {
    id,
    company: `Company ${id}`,
    role: `Role ${id}`,
    location: "Remote",
    jobPortal: "LinkedIn",
    appliedDate: daysAgo(appliedDaysAgo),
    status,
  };
}

function ids(applications: readonly Application[]): string[] {
  return applications.map((application) => application.id);
}

function filters(overrides: Partial<ApplicationFilters>): ApplicationFilters {
  return { ...NO_APPLICATION_FILTERS, ...overrides };
}

// ===========================================================================
// status parameter guard
// ===========================================================================

test("parseStatusParam accepts exactly the five ApplicationStatus values", () => {
  const statuses: ApplicationStatus[] = [
    "Applied",
    "Interview",
    "Offer",
    "Rejected",
    "Ghosted",
  ];

  for (const status of statuses) {
    assert.equal(parseStatusParam(status), status);
  }
});

test("parseStatusParam rejects anything outside that vocabulary", () => {
  const rejected = [
    "All",
    "applied",
    "APPLIED",
    "Applied ",
    "Accepted",
    "Interviewing",
    "",
    " ",
    "constructor",
    "toString",
    "__proto__",
    "Applied,Offer",
    "<script>",
    null,
    undefined,
  ];

  for (const value of rejected) {
    assert.equal(
      parseStatusParam(value as string | null | undefined),
      null,
      `expected ${JSON.stringify(value)} to be rejected`
    );
  }
});

// ===========================================================================
// window parameter guard
// ===========================================================================

test("parseWindowParam accepts exactly 7d, 30d and 90d", () => {
  assert.deepEqual([...APPLICATION_WINDOWS], ["7d", "30d", "90d"]);

  for (const window of APPLICATION_WINDOWS) {
    assert.equal(parseWindowParam(window), window);
    assert.equal(isApplicationWindow(window), true);
  }
});

test("parseWindowParam rejects other spans, including dashboard-only ranges", () => {
  // `24h`, `60d` and `all` are valid DashboardRanges but are NOT part of the
  // Applications drill-down contract, so they must not sneak through.
  const rejected = [
    "24h",
    "60d",
    "all",
    "7",
    "7D",
    "30days",
    "0d",
    "-30d",
    "",
    null,
    undefined,
  ];

  for (const value of rejected) {
    assert.equal(
      parseWindowParam(value as string | null | undefined),
      null,
      `expected ${JSON.stringify(value)} to be rejected`
    );
    assert.equal(isApplicationWindow(value), false);
  }
});

test("resolveFiltersFromParams falls back to the unfiltered defaults", () => {
  assert.deepEqual(resolveFiltersFromParams({}), {
    status: "All",
    window: ALL_WINDOWS,
  });

  assert.deepEqual(
    resolveFiltersFromParams({ status: "nonsense", window: "yesterday" }),
    { status: "All", window: ALL_WINDOWS }
  );

  // One bad value must not discard the good one.
  assert.deepEqual(
    resolveFiltersFromParams({ status: "Offer", window: "yesterday" }),
    { status: "Offer", window: ALL_WINDOWS }
  );

  assert.deepEqual(
    resolveFiltersFromParams({ status: "nonsense", window: "90d" }),
    { status: "All", window: "90d" }
  );

  assert.deepEqual(
    resolveFiltersFromParams({ status: "Interview", window: "30d" }),
    { status: "Interview", window: "30d" }
  );
});

test("hasActiveFilters reports narrowing, and whitespace is not narrowing", () => {
  assert.equal(hasActiveFilters(NO_APPLICATION_FILTERS), false);
  assert.equal(hasActiveFilters(filters({ search: "   " })), false);
  assert.equal(hasActiveFilters(filters({ search: "acme" })), true);
  assert.equal(hasActiveFilters(filters({ status: "Rejected" })), true);
  assert.equal(hasActiveFilters(filters({ window: "7d" })), true);
});

test("describeWindow labels every window without inventing a span", () => {
  assert.equal(describeWindow(ALL_WINDOWS), "All time");
  assert.equal(describeWindow("7d"), "Last 7 days");
  assert.equal(describeWindow("30d"), "Last 30 days");
  assert.equal(describeWindow("90d"), "Last 90 days");
});

// ===========================================================================
// applying the resolved filters to the real dataset
// ===========================================================================

/**
 * Spread across the three windows and the five statuses, so a filter that
 * silently ignores one half of the pair changes the result.
 */
const dataset: Application[] = [
  app("a", "Applied", 1),
  app("b", "Applied", 20),
  app("c", "Applied", 200),
  app("d", "Interview", 3),
  app("e", "Interview", 45),
  app("f", "Offer", 10),
  app("g", "Rejected", 2),
  app("h", "Rejected", 100),
  app("i", "Ghosted", 60),
];

test("no filters returns every row, as a copy", () => {
  const result = applyApplicationFilters(dataset, NO_APPLICATION_FILTERS, NOW);

  assert.deepEqual(ids(result), ids(dataset));
  assert.notEqual(result, dataset);
});

test("status alone narrows to that status only", () => {
  assert.deepEqual(
    ids(applyApplicationFilters(dataset, filters({ status: "Applied" }), NOW)),
    ["a", "b", "c"]
  );

  assert.deepEqual(
    ids(applyApplicationFilters(dataset, filters({ status: "Ghosted" }), NOW)),
    ["i"]
  );
});

test("window alone narrows by applied date via the dashboard range filter", () => {
  assert.deepEqual(
    ids(applyApplicationFilters(dataset, filters({ window: "7d" }), NOW)),
    ["a", "d", "g"]
  );

  assert.deepEqual(
    ids(applyApplicationFilters(dataset, filters({ window: "30d" }), NOW)),
    ["a", "b", "d", "f", "g"]
  );

  assert.deepEqual(
    ids(applyApplicationFilters(dataset, filters({ window: "90d" }), NOW)),
    ["a", "b", "d", "e", "f", "g", "i"]
  );
});

test("status + window narrows the dataset on both axes at once", () => {
  // Applied within 30 days: `c` is Applied but 200 days old, `f`/`g` are inside
  // the window but a different status.
  assert.deepEqual(
    ids(
      applyApplicationFilters(
        dataset,
        filters({ status: "Applied", window: "30d" }),
        NOW
      )
    ),
    ["a", "b"]
  );

  assert.deepEqual(
    ids(
      applyApplicationFilters(
        dataset,
        filters({ status: "Interview", window: "7d" }),
        NOW
      )
    ),
    ["d"]
  );

  // Both halves matter: widening only the window, or only the status, adds rows.
  assert.deepEqual(
    ids(
      applyApplicationFilters(
        dataset,
        filters({ status: "Interview", window: "90d" }),
        NOW
      )
    ),
    ["d", "e"]
  );

  // A combination nothing satisfies is empty, not silently unfiltered.
  assert.deepEqual(
    ids(
      applyApplicationFilters(
        dataset,
        filters({ status: "Offer", window: "7d" }),
        NOW
      )
    ),
    []
  );
});

test("combined narrowing is the intersection of the two filters applied alone", () => {
  for (const window of APPLICATION_WINDOWS) {
    const byWindow = new Set(
      ids(applyApplicationFilters(dataset, filters({ window }), NOW))
    );

    for (const status of [
      "Applied",
      "Interview",
      "Offer",
      "Rejected",
      "Ghosted",
    ] as const) {
      const byStatus = new Set(
        ids(applyApplicationFilters(dataset, filters({ status }), NOW))
      );

      const combined = ids(
        applyApplicationFilters(dataset, filters({ status, window }), NOW)
      );

      assert.deepEqual(
        combined,
        ids(dataset).filter((id) => byWindow.has(id) && byStatus.has(id)),
        `status=${status} window=${window}`
      );
    }
  }
});

test("search narrows alongside status and window, case-insensitively", () => {
  const rows: Application[] = [
    { ...app("x", "Applied", 2), company: "Acme Corp", role: "Backend Engineer" },
    { ...app("y", "Applied", 2), company: "Globex", role: "ACME Integrations" },
    { ...app("z", "Applied", 200), company: "Acme Corp", role: "Data Analyst" },
    { ...app("w", "Rejected", 2), company: "Acme Corp", role: "SRE" },
  ];

  assert.deepEqual(
    ids(applyApplicationFilters(rows, filters({ search: "acme" }), NOW)),
    ["x", "y", "z", "w"]
  );

  assert.deepEqual(
    ids(
      applyApplicationFilters(
        rows,
        filters({ search: "  ACME  ", status: "Applied", window: "30d" }),
        NOW
      )
    ),
    ["x", "y"]
  );

  assert.deepEqual(
    ids(applyApplicationFilters(rows, filters({ search: "remote" }), NOW)),
    ["x", "y", "z", "w"]
  );
});

test("an unparseable applied date is excluded by a window, never by default", () => {
  const rows: Application[] = [
    app("ok", "Applied", 1),
    { ...app("bad", "Applied", 1), appliedDate: "not-a-date" },
  ];

  // Unfiltered keeps it: dropping a row nobody asked to filter would hide data.
  assert.deepEqual(
    ids(applyApplicationFilters(rows, NO_APPLICATION_FILTERS, NOW)),
    ["ok", "bad"]
  );

  // Inside a window there is no honest bucket for it.
  assert.deepEqual(
    ids(applyApplicationFilters(rows, filters({ window: "30d" }), NOW)),
    ["ok"]
  );
});

test("an empty dataset stays empty under every filter combination", () => {
  for (const window of [ALL_WINDOWS, ...APPLICATION_WINDOWS]) {
    assert.deepEqual(
      applyApplicationFilters([], filters({ window, status: "Applied" }), NOW),
      []
    );
  }
});

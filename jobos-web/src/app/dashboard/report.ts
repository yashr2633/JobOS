/**
 * The dashboard's reported dataset for one window.
 *
 * The critical semantic this module enforces STRUCTURALLY: a reported figure is
 * derived from rows of the `applications` table and from nothing else. There is
 * no parameter here for `messagesListed`, `messagesDeduplicated`,
 * `messagesFresh` or `messagesSeen`, so no Gmail message counter can reach a KPI
 * even by mistake. Message counts are reported by the scan module, which has its
 * own summary function and its own place on the page.
 *
 * The consequence, which is the behaviour the old dashboard got wrong: a
 * repeated scan of the same window reports the COMPLETE set of applications in
 * that window every time. If today's 30-day scan reads 0 fresh Gmail messages
 * but 22 applications fall inside the 30-day window, Total Applications is 22.
 * Nothing about this function can observe how many messages a scan read.
 *
 * Pure: no network, no Supabase, no React. `now` is injectable so a window
 * boundary is reproducible instead of machine-dependent.
 */

import type { ApplicationStatus } from "../applications/types.ts";
import type { WeeklyData } from "./types.ts";
import {
  computeActivitySeries,
  computePortalDistribution,
  computeStatusDistribution,
  computeWeeklyApplicationData,
  computeWeeklyTrend,
  filterApplicationsByRange,
  type ActivitySeries,
  type PortalCount,
  type WeeklyTrend,
} from "./metrics.ts";
import {
  reportingWindowDays,
  type ReportingWindow,
} from "./reportingWindow.ts";

/** The application fields every reported figure is derived from. */
export interface ReportableApplication {
  appliedDate: string;
  status: ApplicationStatus;
  jobPortal: string;
}

/**
 * The KPI cards, in the order the row renders them.
 *
 * All five lifecycle statuses, Ghosted included. Ghosted was previously left off
 * the row and reported only inside the distribution panel, which made the one
 * outcome a job seeker most wants to count the only one they could not click
 * through to. `satisfies` pins the list to the real status union, so a status
 * added to the lifecycle cannot be silently missing a card.
 */
export const KPI_STATUSES = [
  "Applied",
  "Interview",
  "Offer",
  "Rejected",
  "Ghosted",
] as const satisfies readonly ApplicationStatus[];

export type KpiStatus = (typeof KPI_STATUSES)[number];

export interface WindowReport<T extends ReportableApplication> {
  window: ReportingWindow;
  windowDays: number;
  /** The rows in the window. Real records, in full, never a sample. */
  applications: T[];
  /** Total Applications — the size of the window-filtered set. */
  totalApplications: number;
  /** Per-status counts over the same filtered set, zero-filled. */
  statusCounts: Record<ApplicationStatus, number>;
  /** Eight complete weeks of application counts, oldest first. */
  trend: WeeklyData[];
  /** Movement between the last two complete weeks of that series. */
  trendMovement: WeeklyTrend;
  /**
   * Application activity for THIS window — daily for 7/30 days, weekly for 90.
   *
   * What the activity chart renders. Distinct from `trend`, which is a fixed
   * eight-week series used for the week-over-week figure and which deliberately
   * excludes the current partial week.
   */
  activity: ActivitySeries;
  /** Portal counts over the window, busiest first. */
  portals: PortalCount[];
  /**
   * Whether the portal breakdown is worth rendering.
   *
   * False when the window is empty, and false when every row's portal is
   * `Unknown` — a chart made entirely of "Unknown" states nothing about where
   * applications came from, so the page shows an empty state instead of a
   * single meaningless bar.
   */
  hasPortalBreakdown: boolean;
}

/**
 * Everything the dashboard reports for `window`, from persisted applications.
 *
 * `filterApplicationsByRange` does the window filtering — the reporting window
 * names are a subset of `DashboardRange`, so the existing, tested filter is used
 * as-is rather than reimplemented. A row whose applied date cannot be parsed is
 * excluded by that filter and therefore counted nowhere, which is why
 * `totalApplications` is the size of the filtered set rather than of the input.
 */
export function computeWindowReport<T extends ReportableApplication>(
  applications: readonly T[],
  window: ReportingWindow,
  now: Date = new Date()
): WindowReport<T> {
  const visible = filterApplicationsByRange(applications, window, now);
  const statusCounts = computeStatusDistribution(visible);
  const trend = computeWeeklyApplicationData(visible, now);
  const portals = computePortalDistribution(visible);
  const windowDays = reportingWindowDays(window);
  // Buckets span exactly the selected window and include today, so the chart
  // reflects the selector rather than a fixed eight-week span.
  const activity = computeActivitySeries(visible, windowDays, now);

  return {
    window,
    windowDays,
    applications: visible,
    // The count IS the filtered set's length. Not a stored counter, not a
    // number a scan reported, not a sum of status buckets.
    totalApplications: visible.length,
    statusCounts,
    trend,
    trendMovement: computeWeeklyTrend(trend),
    activity,
    portals,
    hasPortalBreakdown:
      visible.length > 0 &&
      portals.some((entry) => entry.portal !== "Unknown"),
  };
}

/**
 * Link a KPI card into the applications list with the same filter applied.
 *
 * The param names and values are a contract with `/applications`, which reads
 * `status` and `window` from its own search params: `status` is one of the four
 * KPI statuses, `window` is the reporting window. Total Applications carries the
 * window only, because it filters by nothing else.
 */
export function kpiHref(
  window: ReportingWindow,
  status?: KpiStatus
): string {
  return status === undefined
    ? `/applications?window=${window}`
    : `/applications?status=${status}&window=${window}`;
}

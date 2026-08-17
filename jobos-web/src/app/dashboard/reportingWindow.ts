/**
 * The dashboard's REPORTING window — 7 / 30 / 90 days.
 *
 * This vocabulary is deliberately NOT the Gmail scan vocabulary. A scan window
 * says how much mailbox to read (`SCAN_WINDOWS` in `lib/gmail/query.ts`, which
 * is `7d | 30d | 60d | 90d` and is asserted exactly by `scanWindow.test.ts`).
 * A reporting window says which persisted applications a KPI counts. The two
 * answer different questions, so they are allowed to differ, and the scan set is
 * left untouched here.
 *
 * The reporting set is a SUBSET of the scan set, which is what makes the default
 * recovery below work: a completed scan's stored bounds resolve to a scan window
 * via `scanWindowFromBounds`, and that name is adopted as the reporting window
 * whenever it is one of the three offered. A 60-day scan has no reporting
 * equivalent, so it falls back rather than inventing a fourth option.
 *
 * Pure: no React, no network, no clock of its own. Imported by relative path
 * with an explicit `.ts` extension so this module and its test stay runnable
 * under `node --test`, matching the convention in `metrics.ts`.
 */

import {
  DEFAULT_SCAN_WINDOW,
  HISTORY_RANGES,
  scanWindowFromBounds,
} from "../../lib/gmail/query.ts";
import type { DashboardRange } from "./metrics.ts";

/**
 * The windows the dashboard reporting control offers, narrowest first.
 *
 * `satisfies` pins every entry to a range `filterApplicationsByRange` can
 * already resolve, so a window that the metrics layer cannot filter by fails at
 * compile time instead of silently reporting everything.
 */
export const REPORTING_WINDOWS = [
  "7d",
  "30d",
  "90d",
] as const satisfies readonly DashboardRange[];

export type ReportingWindow = (typeof REPORTING_WINDOWS)[number];

/**
 * Reported window when nothing else can be established.
 *
 * The same 30 days the scan defaults to, so the first thing a user sees after
 * connecting Gmail reports the period their first scan covered.
 */
export const DEFAULT_REPORTING_WINDOW: ReportingWindow = isReportingWindow(
  DEFAULT_SCAN_WINDOW
)
  ? DEFAULT_SCAN_WINDOW
  : "30d";

/** Narrow untrusted input — a URL search param, a stored value — to a window. */
export function isReportingWindow(value: unknown): value is ReportingWindow {
  return (
    typeof value === "string" &&
    (REPORTING_WINDOWS as readonly string[]).includes(value)
  );
}

/**
 * Day span of a reporting window, read off `HISTORY_RANGES` so there is no
 * second mapping of window names to day counts anywhere in the app.
 */
export function reportingWindowDays(window: ReportingWindow): number {
  // Every reporting window is bounded, which the `satisfies` above makes a
  // compile-time fact, so this never has to cope with a null day count.
  return HISTORY_RANGES[window];
}

/** Label for the control and for any sentence that names the window. */
export function reportingWindowLabel(window: ReportingWindow): string {
  return `Last ${reportingWindowDays(window)} days`;
}

export interface ReportingWindowOption {
  value: ReportingWindow;
  label: string;
  days: number;
}

/** Exactly the three options the control renders, in order. */
export const REPORTING_WINDOW_OPTIONS: readonly ReportingWindowOption[] =
  REPORTING_WINDOWS.map((window) => ({
    value: window,
    label: reportingWindowLabel(window),
    days: reportingWindowDays(window),
  }));

/**
 * The reporting window implied by a completed scan's persisted date bounds.
 *
 * Read-only use of `scanWindowFromBounds`: the sync job stores concrete
 * `window_start` / `window_end` dates, never the window's name, so the name has
 * to be recovered from the bounds. A span that matches no reporting window — a
 * 60-day scan, a legacy wide scan, unreadable bounds — recovers nothing rather
 * than being rounded to the nearest option.
 */
export function reportingWindowFromScanBounds(
  windowStart: string | null | undefined,
  windowEnd: string | null | undefined
): ReportingWindow | null {
  if (typeof windowStart !== "string" || typeof windowEnd !== "string") {
    return null;
  }

  const scanWindow = scanWindowFromBounds(windowStart, windowEnd);
  return isReportingWindow(scanWindow) ? scanWindow : null;
}

/** The persisted bounds of the latest COMPLETED scan, when one exists. */
export interface LatestScanBounds {
  windowStart: string | null;
  windowEnd: string | null;
}

/**
 * Resolve the window the dashboard should report.
 *
 * Precedence, and the reason for it:
 *   1. the URL search param — an explicit choice, shareable and survivable
 *      across refresh and back/forward, but never trusted raw;
 *   2. the latest completed scan's stored bounds — so the dashboard opens on the
 *      period that was actually read;
 *   3. the 30-day default — when no scan has completed.
 *
 * A junk param is not an error: it resolves down the same chain, so a mangled
 * link still renders a real dashboard.
 */
export function resolveReportingWindow(args: {
  param: unknown;
  latestScan?: LatestScanBounds | null;
}): ReportingWindow {
  if (isReportingWindow(args.param)) return args.param;

  const recovered = reportingWindowFromScanBounds(
    args.latestScan?.windowStart,
    args.latestScan?.windowEnd
  );

  return recovered ?? DEFAULT_REPORTING_WINDOW;
}

/**
 * First value of a Next.js search param.
 *
 * `?window=7d&window=90d` arrives as an array. Taking the first entry keeps the
 * guard above total: whatever comes out is still validated, so a repeated or
 * absent param can only ever resolve to a real window.
 */
export function firstParamValue(
  value: string | string[] | undefined
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

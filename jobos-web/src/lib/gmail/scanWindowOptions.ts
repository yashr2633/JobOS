/**
 * Presentation vocabulary for the scan-window selector.
 *
 * Derived entirely from `SCAN_WINDOWS` and `HISTORY_RANGES` so there is exactly
 * one place that decides which windows exist and how long each one is. A UI that
 * built its own list could drift from what the API accepts; this cannot, because
 * every option value is a `ScanWindow` and every day count is read back out of
 * the query module.
 *
 * Pure data — no React, no network — so it is unit-testable alongside the rest
 * of the window logic.
 */

import {
  DEFAULT_SCAN_WINDOW,
  HISTORY_RANGES,
  SCAN_WINDOWS,
  type ScanWindow,
} from "./query.ts";

export interface ScanWindowOption {
  /** The value sent to `POST /api/gmail/sync` as `window`. */
  value: ScanWindow;
  /** Human label, including the recommended marker for the default window. */
  label: string;
  /** Days of mailbox the window covers. */
  days: number;
  /** True for the default window only, so the UI can mark it visibly. */
  recommended: boolean;
}

/**
 * Days covered by a selectable window.
 *
 * Every selectable window is bounded, which `SCAN_WINDOWS` pins at compile time,
 * so this cannot return null and no second day-count mapping is needed.
 */
export function scanWindowDays(window: ScanWindow): number {
  return HISTORY_RANGES[window];
}

/** Label for one window: "Last 30 days", plus the recommended marker. */
export function scanWindowLabel(window: ScanWindow): string {
  const base = `Last ${scanWindowDays(window)} days`;
  return window === DEFAULT_SCAN_WINDOW ? `${base} (recommended)` : base;
}

/**
 * The selector's options, in `SCAN_WINDOWS` order.
 *
 * Nothing wider than 90 days appears here because nothing wider is selectable:
 * a first scan stays small and cheap, and the legacy `6m` / `1y` / `all` ranges
 * remain resolvable for stored values without ever being offered.
 */
export const SCAN_WINDOW_OPTIONS: readonly ScanWindowOption[] = SCAN_WINDOWS.map(
  (window) => ({
    value: window,
    label: scanWindowLabel(window),
    days: scanWindowDays(window),
    recommended: window === DEFAULT_SCAN_WINDOW,
  })
);

/**
 * Dashboard metrics — pure derivations over already-persisted rows.
 *
 * Replaces the mocked `generateWeeklyData()` array and the hardcoded `trend`
 * props on `DashboardStats`. Nothing here fetches, estimates, or invents a
 * value: every function is a total function of its arguments, so the same rows
 * and the same `now` always produce the same output. That makes the module
 * safe to run on the server and cheap to test.
 *
 * No network, no Supabase client, no React. `now` is always injectable so
 * bucket boundaries are reproducible instead of machine-dependent.
 *
 * Imported by relative path with an explicit `.ts` extension so the module and
 * its test file stay runnable under `node --test`, matching the convention in
 * `src/lib/gmail/`.
 */

import type { ApplicationStatus } from "../applications/types.ts";
import type { WeeklyData } from "./types.ts";
import type { GmailSyncJob } from "../../lib/api/gmailActivity.ts";
import type { EvidenceReason } from "../../lib/gmail/applicationEvidence.ts";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

/** Weeks reported by the trend chart. Requirement 11.2 fixes this at eight. */
export const WEEKS_IN_TREND = 8;

/** Time filters offered on the dashboard. */
export const DASHBOARD_RANGES = [
  "24h",
  "7d",
  "30d",
  "60d",
  "90d",
  "all",
] as const;

export type DashboardRange = (typeof DASHBOARD_RANGES)[number];

/**
 * Range the dashboard reports when the caller expresses no preference.
 *
 * `all` rather than a bounded window: the stat row is a lifetime tally today,
 * and narrowing it by default would silently change what those numbers mean.
 */
export const DEFAULT_DASHBOARD_RANGE: DashboardRange = "all";

/** Day span of each range; `null` means "no lower bound". */
const RANGE_DAYS: Record<DashboardRange, number | null> = {
  "24h": 1,
  "7d": 7,
  "30d": 30,
  "60d": 60,
  "90d": 90,
  all: null,
};

/** Narrow untrusted input — a query string, a stored preference — to a range. */
export function isDashboardRange(value: unknown): value is DashboardRange {
  return (
    typeof value === "string" &&
    (DASHBOARD_RANGES as readonly string[]).includes(value)
  );
}

/** The five statuses the `applications.status` CHECK constraint allows. */
const APPLICATION_STATUSES: readonly ApplicationStatus[] = [
  "Applied",
  "Interview",
  "Offer",
  "Rejected",
  "Ghosted",
];

/**
 * "Active" means the application is still live: submitted and not closed out.
 *
 * Defined here, once, because two screens report it (`ApplicationStats` on
 * /applications) and any second definition would silently disagree. `Rejected`
 * and `Ghosted` are the closed states, so everything else is active.
 */
export const ACTIVE_STATUSES: readonly ApplicationStatus[] = [
  "Applied",
  "Interview",
  "Offer",
];

/** Shown when `job_portal` is blank, so the distribution stays total. */
const UNKNOWN_PORTAL = "Unknown";

const MONTH_ABBREVIATIONS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * `applied_date` is a Postgres `date`, so the stored form is `YYYY-MM-DD`.
 * Timestamps are accepted too, for rows written by other paths.
 */
const APPLIED_DATE_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * Parse an applied date into an epoch millisecond value, or `null` when the
 * value is not a date.
 *
 * Deliberately stricter than `Date.parse`, which accepts fragments like `"5"`
 * and resolves them to a real instant. An unparseable date must be excluded
 * from every bucket (Requirement 11.5), never coerced to today, so guessing is
 * worse than rejecting.
 *
 * A value with no timezone offset is read as UTC: bucket boundaries are UTC, so
 * reading the calendar day in UTC keeps the same row in the same week
 * regardless of the server's timezone.
 */
function parseAppliedDate(value: string): number | null {
  const match = APPLIED_DATE_PATTERN.exec(value.trim());
  if (!match) return null;

  const [, year, month, day, time, offset] = match;
  const normalized =
    time === undefined
      ? `${year}-${month}-${day}T00:00:00.000Z`
      : `${year}-${month}-${day}T${time}${offset ?? "Z"}`;

  // Strict ISO form, so an impossible calendar day such as 2025-02-30 is NaN
  // rather than being rolled over into March.
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Parse a persisted timestamp column. Returns `null` when absent or invalid. */
function parseTimestamp(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Monday 00:00:00.000 UTC of the week containing `ms`. */
function startOfUtcWeek(ms: number): number {
  const date = new Date(ms);
  const midnight = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  );
  // getUTCDay() is 0 for Sunday; shift so Monday is 0.
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  return midnight - daysSinceMonday * MS_PER_DAY;
}

/** e.g. `Nov 4` — short enough for the chart's axis labels, locale-free. */
function formatWeekLabel(startMs: number): string {
  const date = new Date(startMs);
  return `${MONTH_ABBREVIATIONS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

/** One reported week: Monday 00:00:00.000 UTC to Sunday 23:59:59.999 UTC. */
export interface TrendWeek {
  /** Inclusive lower bound, epoch ms. */
  startMs: number;
  /** Inclusive upper bound, epoch ms. */
  endMs: number;
  /** Axis label, e.g. `Nov 4`. */
  label: string;
}

/**
 * The `WEEKS_IN_TREND` most recent COMPLETE Monday-based UTC weeks, oldest
 * first.
 *
 * The week containing `now` is partial, so it is excluded: including it would
 * make the newest bar shrink relative to the others and change within a day.
 * The returned weeks are contiguous and non-overlapping by construction, which
 * is what makes "each application counted in exactly one week" hold.
 */
export function resolveTrendWeeks(now: Date = new Date()): TrendWeek[] {
  const currentWeekStart = startOfUtcWeek(now.getTime());
  const weeks: TrendWeek[] = [];

  for (let index = 0; index < WEEKS_IN_TREND; index += 1) {
    const startMs = currentWeekStart - (WEEKS_IN_TREND - index) * MS_PER_WEEK;
    weeks.push({
      startMs,
      endMs: startMs + MS_PER_WEEK - 1,
      label: formatWeekLabel(startMs),
    });
  }

  return weeks;
}

/**
 * Weekly application counts for the trend chart (Requirement 11).
 *
 * Always returns exactly `WEEKS_IN_TREND` entries, oldest first, zero-filled
 * when the user has no applications. An application lands in the single week
 * whose `[startMs, endMs]` contains its applied date; a date outside the span,
 * or one that cannot be parsed, is counted nowhere. So the sum of the returned
 * counts equals the number of applications inside the reported span.
 */
export function computeWeeklyApplicationData(
  applications: readonly { appliedDate: string }[],
  now: Date = new Date()
): WeeklyData[] {
  const weeks = resolveTrendWeeks(now);
  const counts = new Array<number>(weeks.length).fill(0);
  const spanStart = weeks[0].startMs;
  const spanEnd = weeks[weeks.length - 1].endMs;

  for (const application of applications) {
    const appliedMs = parseAppliedDate(application.appliedDate);
    if (appliedMs === null) continue;
    if (appliedMs < spanStart || appliedMs > spanEnd) continue;

    const index = Math.floor((appliedMs - spanStart) / MS_PER_WEEK);
    counts[index] += 1;
  }

  return weeks.map((week, index) => ({
    week: week.label,
    applications: counts[index],
  }));
}

/** Week-over-week movement of the trend series. */
export interface WeeklyTrend {
  direction: "up" | "down" | "flat";
  /**
   * Percent change against the previous week, rounded. `null` when the previous
   * week has no applications: there is no honest percentage against zero, and
   * reporting one would invent a baseline.
   */
  changePercent: number | null;
  /** Count in the most recent complete week. */
  latest: number;
  /** Count in the week before it. */
  previous: number;
}

/**
 * Compare the last two complete weeks of a series produced by
 * `computeWeeklyApplicationData`.
 *
 * Replaces the chart's hardcoded "Trending up this week" caption. A series
 * shorter than two entries reports `flat` with no percentage, because there is
 * nothing to compare.
 */
export function computeWeeklyTrend(series: readonly WeeklyData[]): WeeklyTrend {
  const latest = series.length > 0 ? series[series.length - 1].applications : 0;
  const previous = series.length > 1 ? series[series.length - 2].applications : 0;

  return {
    direction: latest > previous ? "up" : latest < previous ? "down" : "flat",
    changePercent:
      previous === 0 ? null : Math.round(((latest - previous) / previous) * 100),
    latest,
    previous,
  };
}

// ---------------------------------------------------------------------------
// Activity series — the range-aware chart data
// ---------------------------------------------------------------------------

/**
 * Bucket width of an activity series.
 *
 * Chosen from the reported day span, so the chart's granularity always matches
 * the period the user selected.
 */
export type ActivityGranularity = "day" | "week";

export interface ActivityBucket {
  /** Inclusive lower bound, epoch ms. */
  startMs: number;
  /** Inclusive upper bound, epoch ms. */
  endMs: number;
  /** Short axis label. */
  label: string;
  /** Full label for a tooltip or screen reader, e.g. "17 Aug". */
  fullLabel: string;
  count: number;
}

export interface ActivitySeries {
  granularity: ActivityGranularity;
  /** Contiguous, non-overlapping buckets, oldest first. */
  buckets: ActivityBucket[];
  /** Applications counted across the series. */
  total: number;
  /** Highest single-bucket count, for scaling. Zero when there is no activity. */
  peak: number;
  /** How often the component should render an axis label, to avoid crowding. */
  labelEvery: number;
}

/** Day counts up to this use daily buckets; wider spans use weekly. */
const MAX_DAILY_SPAN = 31;

/**
 * Compute application activity for the SELECTED reporting window.
 *
 * WHY THIS EXISTS ALONGSIDE `computeWeeklyApplicationData`
 *
 * That function answers a different, fixed question — "the last eight complete
 * weeks" — and deliberately EXCLUDES the current partial week so the newest bar
 * cannot shrink relative to its neighbours. It is still used for the
 * week-over-week trend figure and is left untouched.
 *
 * It is the wrong input for a chart driven by a 7 / 30 / 90-day selector, and
 * that mismatch was the bug:
 *
 *  - it ignored the selected range entirely, so all three selections drew the
 *    same eight weeks;
 *  - on a 7-day selection almost every application falls inside the current week,
 *    which that function excludes, so a user with recent applications saw an
 *    all-zero chart captioned "No applications in the last eight weeks".
 *
 * This function fixes both by construction: the buckets span exactly the
 * requested window and the FINAL bucket includes today.
 *
 * Truthfulness properties:
 *  - every count is a real row; nothing is interpolated, smoothed, or defaulted;
 *  - an application lands in exactly one bucket, so the bucket counts sum to
 *    `total`;
 *  - a row whose applied date cannot be parsed is counted nowhere, never coerced
 *    to today;
 *  - a genuinely empty period yields all-zero buckets and `peak === 0`, which the
 *    component renders as an explicit empty state rather than a full-height bar.
 */
export function computeActivitySeries(
  applications: readonly { appliedDate: string }[],
  days: number,
  now: Date = new Date()
): ActivitySeries {
  const span = Math.max(1, Math.floor(days));
  const granularity: ActivityGranularity = span <= MAX_DAILY_SPAN ? "day" : "week";

  // Midnight UTC of today. Bucketing on UTC calendar days keeps a row in the same
  // bucket regardless of the server's timezone.
  const todayStart = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  );

  const buckets: ActivityBucket[] = [];

  if (granularity === "day") {
    // `span` daily buckets, the last of which is today.
    for (let offset = span - 1; offset >= 0; offset -= 1) {
      const startMs = todayStart - offset * MS_PER_DAY;
      buckets.push({
        startMs,
        endMs: startMs + MS_PER_DAY - 1,
        label: String(new Date(startMs).getUTCDate()),
        fullLabel: formatDayLabel(startMs),
        count: 0,
      });
    }
  } else {
    // Weekly buckets ending with the week that contains today, so recent activity
    // is always visible.
    const currentWeekStart = startOfUtcWeek(todayStart);
    const weekCount = Math.max(1, Math.ceil(span / 7));

    for (let index = weekCount - 1; index >= 0; index -= 1) {
      const startMs = currentWeekStart - index * MS_PER_WEEK;
      buckets.push({
        startMs,
        endMs: startMs + MS_PER_WEEK - 1,
        label: formatWeekLabel(startMs),
        fullLabel: `Week of ${formatWeekLabel(startMs)}`,
        count: 0,
      });
    }
  }

  const spanStart = buckets[0].startMs;
  const spanEnd = buckets[buckets.length - 1].endMs;
  const bucketWidth = granularity === "day" ? MS_PER_DAY : MS_PER_WEEK;

  let total = 0;

  for (const application of applications) {
    const appliedMs = parseAppliedDate(application.appliedDate);
    if (appliedMs === null) continue;
    if (appliedMs < spanStart || appliedMs > spanEnd) continue;

    const index = Math.floor((appliedMs - spanStart) / bucketWidth);
    // Defensive: a rounding edge must never write outside the array.
    if (index < 0 || index >= buckets.length) continue;

    buckets[index].count += 1;
    total += 1;
  }

  return {
    granularity,
    buckets,
    total,
    peak: buckets.reduce((max, bucket) => Math.max(max, bucket.count), 0),
    // Keep the axis readable: ~6 labels regardless of bucket count.
    labelEvery: Math.max(1, Math.ceil(buckets.length / 6)),
  };
}

/** e.g. `17 Aug` — locale-free so server and client renders agree. */
function formatDayLabel(ms: number): string {
  const date = new Date(ms);
  return `${date.getUTCDate()} ${MONTH_ABBREVIATIONS[date.getUTCMonth()]}`;
}

/**
 * Keep the applications whose applied date falls inside `range`.
 *
 * `all` returns every row untouched, including rows whose date cannot be
 * parsed — an unfiltered view must not silently drop them. Every bounded range
 * keeps rows dated at or after `now - days`; a row with an unparseable date is
 * excluded because there is no honest way to place it.
 */
export function filterApplicationsByRange<T extends { appliedDate: string }>(
  applications: readonly T[],
  range: DashboardRange,
  now: Date = new Date()
): T[] {
  const days = RANGE_DAYS[range];
  if (days === null) return [...applications];

  const cutoff = now.getTime() - days * MS_PER_DAY;

  return applications.filter((application) => {
    const appliedMs = parseAppliedDate(application.appliedDate);
    return appliedMs !== null && appliedMs >= cutoff;
  });
}

/**
 * Count applications per status, zero-filled across the five allowed statuses
 * so the caller never has to check for a missing key.
 */
export function computeStatusDistribution(
  applications: readonly { status: ApplicationStatus }[]
): Record<ApplicationStatus, number> {
  const distribution: Record<ApplicationStatus, number> = {
    Applied: 0,
    Interview: 0,
    Offer: 0,
    Rejected: 0,
    Ghosted: 0,
  };

  for (const application of applications) {
    if (APPLICATION_STATUSES.includes(application.status)) {
      distribution[application.status] += 1;
    }
  }

  return distribution;
}

/**
 * Applications still live, counted from a distribution rather than by
 * re-filtering rows, so the "Active" figure is derived from the same tally
 * every other status figure comes from.
 */
export function countActive(
  distribution: Readonly<Record<ApplicationStatus, number>>
): number {
  return ACTIVE_STATUSES.reduce(
    (total, status) => total + distribution[status],
    0
  );
}

/**
 * THE canonical status summary. Every surface that reports status counts —
 * the Dashboard KPI row, the Dashboard status breakdown, and the Applications
 * page summary — derives its numbers from this one function.
 *
 * WHY IT EXISTS
 *
 * The Dashboard and the Applications page previously reported different SETS of
 * figures: the Dashboard carried all five statuses, while the Applications
 * summary could only express Total/Active/Interview/Rejected. Offer and Ghosted
 * were not representable there at all, so a user looking at a list full of
 * Ghosted applications saw no Ghosted count beside it.
 *
 * A single shape fixes that structurally: a surface cannot omit a status,
 * because the summary always carries all five.
 *
 * WHAT IT DOES NOT FIX, AND CANNOT
 *
 * Two surfaces agree only when they are given the SAME rows. This function is
 * pure, so identical input always yields identical output — but the Dashboard
 * filters by a reporting window before calling it, and the Applications page
 * defaults to all time. Ghosted is derived from prolonged silence, so a Ghosted
 * application's applied date is always old by construction, and a 30-day window
 * legitimately contains none of them. That is a difference in SCOPE, not in
 * arithmetic, and the honest fix is for each surface to state the scope it is
 * reporting (see `scopeLabel` on the Applications summary) rather than for one
 * of them to quietly widen its window.
 *
 * `total` is the row count, NOT the sum of the buckets: a row carrying a status
 * outside the five (impossible through the CHECK constraint, but possible in a
 * hand-edited row) would otherwise vanish from the total and make the figures
 * disagree with the list beneath them.
 */
export interface StatusSummary {
  /** Every row considered. Equals the input length. */
  total: number;
  /** Applied + Interview + Offer. */
  active: number;
  applied: number;
  interview: number;
  offer: number;
  rejected: number;
  ghosted: number;
}

export function summarizeApplicationStatuses(
  applications: readonly { status: ApplicationStatus }[]
): StatusSummary {
  const byStatus = computeStatusDistribution(applications);

  return {
    total: applications.length,
    active: countActive(byStatus),
    applied: byStatus.Applied,
    interview: byStatus.Interview,
    offer: byStatus.Offer,
    rejected: byStatus.Rejected,
    ghosted: byStatus.Ghosted,
  };
}

/**
 * The statuses that make up `active`, and those that close an application.
 *
 * Exposed so a test can assert the two sets partition the five statuses — which
 * is what guarantees no status is double-counted and none is unaccounted for.
 */
export const CLOSED_STATUSES: readonly ApplicationStatus[] = [
  "Rejected",
  "Ghosted",
];

/** Every status the application lifecycle allows. */
export const ALL_APPLICATION_STATUSES: readonly ApplicationStatus[] =
  APPLICATION_STATUSES;

export interface PortalCount {
  portal: string;
  count: number;
}

/**
 * Count applications per portal, busiest first, ties broken alphabetically so
 * the order is stable across renders. A blank portal is reported as `Unknown`
 * rather than dropped, keeping the counts summing to the input length.
 */
export function computePortalDistribution(
  applications: readonly { jobPortal: string }[]
): PortalCount[] {
  const counts = new Map<string, number>();

  for (const application of applications) {
    const portal = application.jobPortal.trim() || UNKNOWN_PORTAL;
    counts.set(portal, (counts.get(portal) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([portal, count]) => ({ portal, count }))
    .sort((a, b) =>
      b.count === a.count ? a.portal.localeCompare(b.portal) : b.count - a.count
    );
}

/**
 * The persisted `gmail_sync_jobs` fields the scan panel needs.
 *
 * A structural subset of `GmailSyncJob`, so a row read by
 * `getLatestSyncJob` can be passed straight in, and so this module never has
 * to know how that row is fetched.
 */
export type ScanJobSnapshot = Pick<
  GmailSyncJob,
  | "status"
  | "syncMode"
  | "windowStart"
  | "windowEnd"
  | "messagesSeen"
  | "startedAt"
  | "updatedAt"
>;

/**
 * Counts derived from the acting user's `gmail_activity` rows.
 *
 * `total` is every ledger row, `excluded` the `NOT_JOB_RELATED` ones,
 * `lifecycle` the genuine lifecycle events, `ambiguous` the rows still awaiting
 * a user decision, and `unknownEmployer` the Unknown-bucket rows.
 */
export interface EvidenceCounts {
  total: number;
  lifecycle: number;
  excluded: number;
  ambiguous: number;
  unknownEmployer: number;
}

/** The part of `EvidenceCounts` a reason-code tally can answer on its own. */
export type EvidenceReasonTotals = Pick<
  EvidenceCounts,
  "total" | "lifecycle" | "excluded"
>;

/** Reason codes the Evidence Gate records for genuine lifecycle evidence. */
const LIFECYCLE_REASONS: readonly EvidenceReason[] = [
  "lifecycle_subject_match",
  "lifecycle_body_match",
];

/**
 * Every hard exclusion the gate can record shares this prefix, so a class added
 * to the gate later is counted here without this module being edited.
 */
const EXCLUSION_REASON_PREFIX = "excluded_";

/**
 * Fold a `countEvidenceByReason` tally into ledger totals.
 *
 * The keys are the gate's fixed reason vocabulary plus `unrecorded` for rows
 * written before the codes were stored, never email text. Codes that are
 * neither lifecycle nor an exclusion — `keyword_only`, `application_url_only`,
 * `unrecorded` — count toward `total` only: they are real rows, but they
 * evidence nothing either way, so folding them into either bucket would
 * overstate it.
 *
 * Typed as a loose record on purpose: the column is free text at the database
 * level, so an unrecognised code has to pass through as part of the total
 * rather than be dropped.
 */
export function summarizeEvidenceReasons(
  reasonCounts: Readonly<Record<string, number>>
): EvidenceReasonTotals {
  let total = 0;
  let lifecycle = 0;
  let excluded = 0;

  for (const [reason, count] of Object.entries(reasonCounts)) {
    total += count;

    if ((LIFECYCLE_REASONS as readonly string[]).includes(reason)) {
      lifecycle += count;
    } else if (reason.startsWith(EXCLUSION_REASON_PREFIX)) {
      excluded += count;
    }
  }

  return { total, lifecycle, excluded };
}

export interface ScanSummaryInput {
  /** The user's most recent sync job, or `null` when no scan has ever run. */
  latestJob: ScanJobSnapshot | null;
  evidenceCounts: EvidenceCounts;
  /**
   * Applications the Auto_Importer created.
   *
   * `null` means the number is genuinely unavailable, which is the case for a
   * scan that is already over: `sync.ts` reports created and updated counts in
   * its response and persists neither, so nothing can be read back afterwards.
   * A caller that has no per-scan figure MUST pass `null` rather than `0`,
   * which would claim the scan created nothing.
   */
  autoImported: number | null;
  /** Applications whose status the Auto_Importer advanced. `null` as above. */
  applicationsUpdated: number | null;
  /** Last completed sync on the Gmail connection. */
  lastSyncAt: string | null;
}

export interface ScanSummary {
  /** False when no sync job exists yet, so the panel can say so plainly. */
  hasScanned: boolean;
  /** Human-readable window the last scan covered. */
  windowLabel: string;
  /** Day span of that window, or `null` when the bounds are unreadable. */
  windowDays: number | null;
  windowStart: string | null;
  windowEnd: string | null;
  status: GmailSyncJob["status"] | null;
  syncMode: GmailSyncJob["syncMode"] | null;
  /** Last completed sync, ISO, or `null` when none has completed. */
  lastScanAt: string | null;
  /** `started_at` → `updated_at` on the job, or `null` when not derivable. */
  durationMs: number | null;
  messagesScanned: number;
  lifecycleDetected: number;
  /** `null` when no per-scan figure was reported — never a fabricated zero. */
  autoImported: number | null;
  /** `null` when no per-scan figure was reported — never a fabricated zero. */
  applicationsUpdated: number | null;
  /** Ambiguous evidence waiting on the user. */
  pendingReview: number;
  unknownEmployer: number;
  excluded: number;
}

/**
 * A scan wider than a year is reported as "All mail": that is the only window
 * whose Gmail query omits a lower bound, so its stored bounds are the whole
 * mailbox rather than a chosen day count.
 */
const ALL_MAIL_THRESHOLD_DAYS = 365;

function describeWindow(days: number | null): string {
  if (days === null) return "Unknown window";
  if (days >= ALL_MAIL_THRESHOLD_DAYS) return "All mail";
  if (days <= 1) return "Last 24 hours";
  return `Last ${days} days`;
}

/**
 * Shape the scan-health panel from persisted rows (Requirement 11.1).
 *
 * Every number comes from a stored counter or a stored timestamp difference;
 * nothing is estimated. When a job exists, `messagesScanned` is that job's own
 * counter, which is what "what did the last scan do" asks for; with no job at
 * all it falls back to the size of the ledger.
 */
export function computeScanSummary(input: ScanSummaryInput): ScanSummary {
  const { latestJob, evidenceCounts } = input;

  const windowStartMs = parseTimestamp(latestJob?.windowStart ?? null);
  const windowEndMs = parseTimestamp(latestJob?.windowEnd ?? null);
  const windowDays =
    windowStartMs !== null && windowEndMs !== null && windowEndMs >= windowStartMs
      ? Math.round((windowEndMs - windowStartMs) / MS_PER_DAY)
      : null;

  const startedAtMs = parseTimestamp(latestJob?.startedAt ?? null);
  const updatedAtMs = parseTimestamp(latestJob?.updatedAt ?? null);
  const durationMs =
    startedAtMs !== null && updatedAtMs !== null && updatedAtMs >= startedAtMs
      ? updatedAtMs - startedAtMs
      : null;

  return {
    hasScanned: latestJob !== null,
    windowLabel: latestJob === null ? "No scan yet" : describeWindow(windowDays),
    windowDays,
    windowStart: latestJob?.windowStart ?? null,
    windowEnd: latestJob?.windowEnd ?? null,
    status: latestJob?.status ?? null,
    syncMode: latestJob?.syncMode ?? null,
    lastScanAt: input.lastSyncAt,
    durationMs,
    messagesScanned: latestJob?.messagesSeen ?? evidenceCounts.total,
    lifecycleDetected: evidenceCounts.lifecycle,
    autoImported: input.autoImported,
    applicationsUpdated: input.applicationsUpdated,
    pendingReview: evidenceCounts.ambiguous,
    unknownEmployer: evidenceCounts.unknownEmployer,
    excluded: evidenceCounts.excluded,
  };
}

/**
 * Gmail search-query construction.
 *
 * The single most important cost control in the whole tracking pipeline. Every
 * message excluded here is a message we never list, never fetch, and never
 * classify. Filtering is pushed into Gmail's own `q=` parameter so the work
 * happens on Google's side, not ours.
 *
 * Pure string building — no network, no secrets — so it is fully unit-testable.
 */

/**
 * Every range the builder can still resolve, including legacy values.
 *
 * `6m` and `1y` are no longer offered to users but stay here so stored range
 * values and existing callers keep resolving exactly as they always have.
 * `all` omits the lower bound entirely.
 */
export const HISTORY_RANGES = {
  "7d": 7,
  "30d": 30,
  "60d": 60,
  "90d": 90,
  "6m": 180,
  "1y": 365,
  all: null,
} as const;

export type HistoryRange = keyof typeof HISTORY_RANGES;

/**
 * The windows a user can actually select.
 *
 * Deliberately narrower than `HISTORY_RANGES`: a first scan should stay small
 * and cheap, so nothing here reaches past 90 days and every entry has a
 * concrete lower bound. `satisfies` pins the set to resolvable ranges, so a
 * window that `resolveWindow` cannot handle fails at compile time.
 */
export const SCAN_WINDOWS = [
  "7d",
  "30d",
  "60d",
  "90d",
] as const satisfies readonly HistoryRange[];

export type ScanWindow = (typeof SCAN_WINDOWS)[number];

/** Recommended window: covers an active search, keeps AI spend near zero. */
export const DEFAULT_SCAN_WINDOW: ScanWindow = "30d";

/** Day count of the default window, for display and for date arithmetic. */
export const DEFAULT_WINDOW_DAYS = 30;

/** Narrow untrusted input — request bodies, stored values — to a scan window. */
export function isScanWindow(value: unknown): value is ScanWindow {
  return (
    typeof value === "string" &&
    (SCAN_WINDOWS as readonly string[]).includes(value)
  );
}

/**
 * Coerce untrusted input to a selectable window, falling back to the default.
 *
 * The API boundary must never reject a request over a bad window, and must
 * never start a job with an unvalidated one. Anything outside the selectable
 * set — a legacy `6m`, a typo, a number, a missing field — resolves to the
 * 30-day window instead.
 */
export function coerceScanWindow(value: unknown): ScanWindow {
  return isScanWindow(value) ? value : DEFAULT_SCAN_WINDOW;
}

/** Milliseconds in a day, for reading a day span back off two date bounds. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The selectable window a pair of stored `YYYY-MM-DD` bounds represents.
 *
 * A sync job persists concrete date bounds, not the window's name, so a job that
 * is RESUMED has to have its window read back off those bounds: the Gmail page
 * cursor stored on that job was issued against the query the job started with,
 * so continuing it under a different `after:` bound would list one scan under two
 * different windows. Reading the window back is what lets the resumed batch keep
 * using the query its cursor belongs to.
 *
 * Returns null when the span matches no selectable window — a legacy `6m` / `1y`
 * job, or unreadable bounds — and the caller then falls back to what was asked
 * for rather than inventing a window.
 */
export function scanWindowFromBounds(
  start: string,
  end: string
): ScanWindow | null {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  if (endMs < startMs) return null;

  const days = Math.round((endMs - startMs) / MS_PER_DAY);
  return SCAN_WINDOWS.find((window) => HISTORY_RANGES[window] === days) ?? null;
}

/**
 * Applicant-tracking systems and job boards that send application mail.
 *
 * Presence of one of these is a strong candidate signal, never a conclusion:
 * these domains also send newsletters and job alerts, which the heuristics
 * layer is responsible for rejecting.
 */
export const ATS_DOMAINS = [
  "greenhouse.io",
  "lever.co",
  "myworkday.com",
  "ashbyhq.com",
  "smartrecruiters.com",
  "icims.com",
  "taleo.net",
  "successfactors.com",
  "workable.com",
  "jobvite.com",
  "bamboohr.com",
  "linkedin.com",
  "indeed.com",
  // Job boards / aggregators. Missing one of these means both a query-narrowing
  // gap (that portal's mail is never candidate-matched) AND a company-naming
  // bug (companyFromDomain would title-case the portal itself as the employer,
  // e.g. "Naukri" showing where the real employer belongs).
  "naukri.com",
  "foundit.in",
  "shine.com",
  "instahyre.com",
  "glassdoor.com",
  "wellfound.com",
  "angel.co",
  "ziprecruiter.com",
  "monster.com",
  "dice.com",
  "simplyhired.com",
] as const;

/** Phrases that appear in genuine application correspondence. */
const SUBJECT_SIGNALS = [
  "application",
  "applying",
  "applied",
  "candidacy",
  "interview",
  "offer",
  "recruiter",
  "your resume",
  "thank you for your interest",
] as const;

/**
 * Format a date as Gmail's `YYYY/MM/DD`, in UTC.
 *
 * Gmail interprets bare dates in the user's timezone; using UTC consistently
 * keeps the window reproducible and testable rather than machine-dependent.
 */
export function toGmailDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

/**
 * Quote a term for use inside a Gmail query.
 *
 * Gmail has no escape syntax inside quoted strings, so an embedded double quote
 * would break out of the term. Stripping quotes and control characters is the
 * safe, lossless-enough option and prevents a crafted term from altering the
 * query's structure.
 */
export function quoteTerm(term: string): string {
  const cleaned = term.replace(/["\\\r\n]/g, " ").trim();
  return `"${cleaned}"`;
}

export interface WindowBounds {
  /** Inclusive lower bound, or null for "all time". */
  start: Date | null;
  /** Exclusive-ish upper bound; Gmail's `before:` is exclusive. */
  end: Date;
}

/** Resolve a named range into concrete dates. */
export function resolveWindow(
  range: HistoryRange = DEFAULT_SCAN_WINDOW,
  now: Date = new Date()
): WindowBounds {
  const days = HISTORY_RANGES[range];
  if (days === null) return { start: null, end: now };

  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return { start, end: now };
}

/**
 * Build the Gmail search query for a historical scan.
 *
 * Structure:
 *   (from:ats OR from:ats OR subject:"signal" OR ...) AND after: AND before:
 *   AND -in:spam AND -in:trash AND -in:chats AND -category:promotions
 *
 * Spam and trash are excluded so deleted or junk mail cannot fabricate
 * applications. Chats are excluded because they carry no application evidence.
 * Promotions is excluded because job alerts, digests, and marketing mail land
 * there in bulk: dropping the whole category on Google's side is the cheapest
 * form of the exclusion the evidence gate would otherwise apply per message.
 */
export function buildGmailQuery(options: {
  range?: HistoryRange;
  now?: Date;
  /** Overrides the default signal set. Used by tests and future tuning. */
  extraSubjectSignals?: string[];
}): string {
  const { start, end } = resolveWindow(
    options.range ?? DEFAULT_SCAN_WINDOW,
    options.now
  );

  const senderClauses = ATS_DOMAINS.map((domain) => `from:${domain}`);
  const subjectClauses = [
    ...SUBJECT_SIGNALS,
    ...(options.extraSubjectSignals ?? []),
  ].map((signal) => `subject:${quoteTerm(signal)}`);

  const signalGroup = `(${[...senderClauses, ...subjectClauses].join(" OR ")})`;

  const parts = [signalGroup];

  if (start) parts.push(`after:${toGmailDate(start)}`);
  // `before:` is exclusive, so push the bound out one day to include today.
  const beforeBound = new Date(end.getTime() + 24 * 60 * 60 * 1000);
  parts.push(`before:${toGmailDate(beforeBound)}`);

  // Never let junk, deleted mail, chats, or promotions become application evidence.
  parts.push("-in:spam", "-in:trash", "-in:chats", "-category:promotions");

  return parts.join(" ");
}

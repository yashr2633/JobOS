/**
 * Filter resolution for the Applications list — pure, React-free.
 *
 * The Dashboard KPI cards deep-link into this page:
 *
 *   /applications?status=Applied&window=30d
 *   /applications?window=30d              (Total Applications)
 *
 * Both parameters arrive as untrusted strings, so each is narrowed by a guard
 * against a closed vocabulary and an unrecognised value is IGNORED rather than
 * shown as a filter that filters nothing. A drill-down must narrow the ACTUAL
 * dataset, so `applyApplicationFilters` is the single place the list is reduced:
 * the URL parameters and the on-page search/status controls feed the same
 * resolved filter object instead of competing with each other.
 *
 * Date filtering is delegated to `filterApplicationsByRange` in
 * `../dashboard/metrics.ts` — the dashboard's own window logic — so the KPI card
 * and the list it links to can never disagree about what "last 30 days" means.
 *
 * Imported by relative path with an explicit `.ts` extension so the module and
 * its test stay runnable under `node --test`, matching the convention in
 * `src/app/dashboard/metrics.ts` and `src/lib/applications/lifecycle.ts`.
 */

import type { ApplicationStatus, ApplicationStatusFilter } from "./types.ts";
import {
  ACTIVE_STATUSES,
  filterApplicationsByRange,
  type DashboardRange,
} from "../dashboard/metrics.ts";
import { isApplicationStatus } from "../../lib/applications/lifecycle.ts";

/**
 * Windows the KPI drill-down may request.
 *
 * A deliberate subset of `DashboardRange`: these are the only spans the
 * Applications list offers, and every one of them is a valid `DashboardRange`
 * so it can be handed straight to `filterApplicationsByRange`.
 */
export const APPLICATION_WINDOWS = ["7d", "30d", "90d"] as const;

export type ApplicationWindow = (typeof APPLICATION_WINDOWS)[number];

/** The window filter's state, where `all` means "no date bound". */
export type ApplicationWindowFilter = ApplicationWindow | "all";

/**
 * The "no date bound" window.
 *
 * Typed as the literal rather than as `ApplicationWindowFilter` so comparing
 * against it narrows: `window === ALL_WINDOWS` has to leave `7d | 30d | 90d`
 * behind for the label lookup and the range delegation to stay type-safe
 * without a cast.
 */
export const ALL_WINDOWS: "all" = "all";

/**
 * Narrow an untrusted `status` query parameter.
 *
 * Reuses the lifecycle module's guard, so the accepted vocabulary is exactly
 * the five values of the `ApplicationStatus` union and cannot drift from it.
 * Anything else — a typo, a removed status, an injection attempt — is `null`.
 */
export function parseStatusParam(
  value: string | null | undefined
): ApplicationStatus | null {
  return isApplicationStatus(value) ? value : null;
}

/** Narrow an untrusted `window` query parameter to `7d | 30d | 90d`. */
export function isApplicationWindow(
  value: unknown
): value is ApplicationWindow {
  return (
    typeof value === "string" &&
    (APPLICATION_WINDOWS as readonly string[]).includes(value)
  );
}

export function parseWindowParam(
  value: string | null | undefined
): ApplicationWindow | null {
  return isApplicationWindow(value) ? value : null;
}

// ---------------------------------------------------------------------------
// Derived views: Active, and Needs attention
// ---------------------------------------------------------------------------

/**
 * Two list views that are NOT a single stored status.
 *
 * `Active` spans three statuses; `Needs attention` is about record completeness
 * and ignores status entirely. They live alongside the status options in one
 * dropdown because to a user they answer the same question — "which subset am I
 * looking at" — but they are kept as a separate union so the URL contract with
 * the Dashboard (`?status=`) still only ever carries a real status.
 */
export const DERIVED_VIEWS = ["Active", "Needs attention"] as const;

export type DerivedView = (typeof DERIVED_VIEWS)[number];

/** Everything the list dropdown can be set to. */
export type ApplicationListFilter = ApplicationStatusFilter | DerivedView;

export function isDerivedView(value: unknown): value is DerivedView {
  return (
    typeof value === "string" && (DERIVED_VIEWS as readonly string[]).includes(value)
  );
}

/**
 * Placeholders the import paths write when a fact could not be determined.
 *
 * These are deliberate, reconcilable markers — not fabricated data — so a record
 * carrying one is genuinely incomplete and worth surfacing. Matched
 * case-insensitively because they are written from more than one path.
 */
const INCOMPLETE_COMPANY_VALUES = ["unknown company", "unknown", ""];
const INCOMPLETE_ROLE_VALUES = ["unknown role", "not specified", "unknown", ""];
const INCOMPLETE_PORTAL_VALUES = ["", "unknown"];

/** The fields an attention check looks at. */
export interface AttentionCandidate {
  company: string;
  role: string;
  jobPortal: string;
}

/**
 * Why a record needs attention, as a list of short reasons.
 *
 * Empty means the record is complete. Reasons are fixed phrases, never derived
 * from email text, and the function NEVER guesses a replacement value — it only
 * reports what is missing so the user can supply it.
 */
export function attentionReasons(application: AttentionCandidate): string[] {
  const reasons: string[] = [];

  const company = (application.company ?? "").trim().toLowerCase();
  const role = (application.role ?? "").trim().toLowerCase();
  const portal = (application.jobPortal ?? "").trim().toLowerCase();

  if (INCOMPLETE_COMPANY_VALUES.includes(company)) {
    reasons.push("Needs company name");
  }
  if (INCOMPLETE_ROLE_VALUES.includes(role)) {
    reasons.push("Needs job title");
  }
  if (INCOMPLETE_PORTAL_VALUES.includes(portal)) {
    reasons.push("Needs source");
  }

  return reasons;
}

/** True when a record is missing something a user would want filled in. */
export function needsAttention(application: AttentionCandidate): boolean {
  return attentionReasons(application).length > 0;
}

/** Everything that narrows the visible list, resolved into one object. */
export interface ApplicationFilters {
  /**
   * `All` means every status. May also be one of the derived views, which are
   * resolved in `applyApplicationFilters`.
   */
  status: ApplicationListFilter;
  /** `all` means every date. */
  window: ApplicationWindowFilter;
  /** Free-text query over company, role and location. */
  search: string;
}

export const NO_APPLICATION_FILTERS: ApplicationFilters = {
  status: "All",
  window: ALL_WINDOWS,
  search: "",
};

/**
 * Turn the two raw query parameters into filter state.
 *
 * An unrecognised value falls back to the unfiltered default, which is what
 * "ignore it and show the unfiltered set" means in practice.
 */
export function resolveFiltersFromParams(params: {
  status?: string | null;
  window?: string | null;
}): Pick<ApplicationFilters, "status" | "window"> {
  return {
    status: parseStatusParam(params.status) ?? "All",
    window: parseWindowParam(params.window) ?? ALL_WINDOWS,
  };
}

/** True when at least one filter is actually narrowing the list. */
export function hasActiveFilters(filters: ApplicationFilters): boolean {
  return (
    filters.status !== "All" ||
    filters.window !== ALL_WINDOWS ||
    filters.search.trim() !== ""
  );
}

const WINDOW_LABELS: Record<ApplicationWindow, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
};

/** Human wording for a window, for the active-filter chips. */
export function describeWindow(window: ApplicationWindowFilter): string {
  return window === ALL_WINDOWS ? "All time" : WINDOW_LABELS[window];
}

/**
 * Apply the resolved filters to the real dataset.
 *
 * Order is irrelevant to the result — the three predicates are independent —
 * but the window is applied first so the date work runs over the largest set
 * only once. `now` is injectable so the window boundary is reproducible in
 * tests rather than machine-dependent.
 */
export function applyApplicationFilters<
  T extends {
    company: string;
    role: string;
    location: string;
    jobPortal: string;
    appliedDate: string;
    status: ApplicationStatus;
  },
>(
  applications: readonly T[],
  filters: ApplicationFilters,
  now: Date = new Date()
): T[] {
  // Every `ApplicationWindow` is also a `DashboardRange`, which is what lets
  // the dashboard's own date filter be reused verbatim here.
  const window: DashboardRange = filters.window;

  const withinWindow =
    window === ALL_WINDOWS
      ? [...applications]
      : filterApplicationsByRange(applications, window, now);

  const query = filters.search.trim().toLowerCase();

  return withinWindow.filter((application) => {
    // Derived views resolve here rather than being pre-baked into the status
    // union, so the dashboard's `?status=` contract stays a real status.
    const matchesStatus =
      filters.status === "All"
        ? true
        : filters.status === "Active"
          ? (ACTIVE_STATUSES as readonly string[]).includes(application.status)
          : filters.status === "Needs attention"
            ? needsAttention(application)
            : application.status === filters.status;

    const matchesSearch =
      query === "" ||
      application.company.toLowerCase().includes(query) ||
      application.role.toLowerCase().includes(query) ||
      application.location.toLowerCase().includes(query);

    return matchesStatus && matchesSearch;
  });
}

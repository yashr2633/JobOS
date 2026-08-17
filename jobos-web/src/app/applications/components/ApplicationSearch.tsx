"use client";

import {
  ALL_WINDOWS,
  APPLICATION_WINDOWS,
  describeWindow,
  type ApplicationListFilter,
  type ApplicationWindowFilter,
} from "../filters";

/**
 * The list views, grouped so the two DERIVED views read as a different kind of
 * choice from the five stored statuses. `Active` spans three statuses; `Needs
 * attention` is about record completeness and ignores status entirely.
 */
const statusOptionGroups: ReadonlyArray<{
  label: string;
  options: readonly ApplicationListFilter[];
}> = [
  { label: "Views", options: ["All", "Active", "Needs attention"] },
  {
    label: "Status",
    options: ["Applied", "Interview", "Offer", "Rejected", "Ghosted"],
  },
];

const windowOptions: ApplicationWindowFilter[] = [
  ALL_WINDOWS,
  ...APPLICATION_WINDOWS,
];

interface ApplicationSearchProps {
  searchQuery: string;
  statusFilter: ApplicationListFilter;
  /** Applied-date window. Seeded by the `window` query parameter. */
  windowFilter: ApplicationWindowFilter;
  onSearchChange: (query: string) => void;
  onStatusChange: (status: ApplicationListFilter) => void;
  onWindowChange: (window: ApplicationWindowFilter) => void;
  /** Resets every filter, including ones that arrived in the URL. */
  onClearFilters: () => void;
  /** Rows currently shown, out of `totalCount` tracked. */
  resultCount: number;
  totalCount: number;
}

/** One active filter, shown as a chip that can be dismissed on its own. */
function FilterChip({
  label,
  onClear,
}: {
  label: string;
  onClear: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 py-1 pl-3 pr-1.5 text-xs font-medium text-accent">
      {label}
      <button
        type="button"
        onClick={onClear}
        aria-label={`Remove filter: ${label}`}
        className="rounded-full p-0.5 text-accent/70 transition-colors hover:bg-accent/20 hover:text-text"
      >
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2.5}
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M6 18 18 6M6 6l12 12"
          />
        </svg>
      </button>
    </span>
  );
}

/**
 * The one filter bar on this page.
 *
 * The dashboard's KPI drill-down (`?status=…&window=…`) does not add a second,
 * competing filter mechanism: it seeds these same two controls, so a linked-in
 * filter is visible here, adjustable here, and clearable here like any filter
 * the user set by hand.
 */
export default function ApplicationSearch({
  searchQuery,
  statusFilter,
  windowFilter,
  onSearchChange,
  onStatusChange,
  onWindowChange,
  onClearFilters,
  resultCount,
  totalCount,
}: ApplicationSearchProps) {
  const trimmedQuery = searchQuery.trim();
  const anyActive =
    statusFilter !== "All" || windowFilter !== ALL_WINDOWS || trimmedQuery !== "";

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="relative flex-1">
          <svg
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
            />
          </svg>
          <input
            type="search"
            placeholder="Search by company, role or location..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full rounded-md border border-border bg-surface py-2.5 pl-10 pr-4 text-sm text-text placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) =>
            onStatusChange(e.target.value as ApplicationListFilter)
          }
          aria-label="Filter list"
          className="w-full rounded-md border border-border bg-surface px-4 py-2.5 text-sm text-text focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent sm:w-48"
        >
          {statusOptionGroups.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.options.map((option) => (
                <option key={option} value={option}>
                  {option === "All" ? "All applications" : option}
                </option>
              ))}
            </optgroup>
          ))}
        </select>

        <select
          value={windowFilter}
          onChange={(e) =>
            onWindowChange(e.target.value as ApplicationWindowFilter)
          }
          aria-label="Filter by applied date"
          className="w-full rounded-md border border-border bg-surface px-4 py-2.5 text-sm text-text focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent sm:w-44"
        >
          {windowOptions.map((option) => (
            <option key={option} value={option}>
              {describeWindow(option)}
            </option>
          ))}
        </select>
      </div>

      {anyActive && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-text-muted">
            Filtered
          </span>

          {statusFilter !== "All" && (
            <FilterChip
              // The derived views are not statuses, so they are not labelled as
              // one — "Status: Needs attention" would misdescribe the filter.
              label={
                statusFilter === "Active" || statusFilter === "Needs attention"
                  ? statusFilter
                  : `Status: ${statusFilter}`
              }
              onClear={() => onStatusChange("All")}
            />
          )}

          {windowFilter !== ALL_WINDOWS && (
            <FilterChip
              label={describeWindow(windowFilter)}
              onClear={() => onWindowChange(ALL_WINDOWS)}
            />
          )}

          {trimmedQuery !== "" && (
            <FilterChip
              label={`Search: ${trimmedQuery}`}
              onClear={() => onSearchChange("")}
            />
          )}

          <span className="text-xs text-text-muted">
            {resultCount} of {totalCount} shown
          </span>

          <button
            type="button"
            onClick={onClearFilters}
            className="text-xs font-medium text-text-secondary underline-offset-2 transition-colors hover:text-text hover:underline"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}

import type { Application } from "../types";
import ApplicationCard from "./ApplicationCard";

interface ApplicationListProps {
  /** The rows to render — already filtered. */
  applications: Application[];
  /**
   * How many applications the user has in total, before any filter.
   *
   * This is what separates "you haven't tracked anything yet" from "your
   * filters match nothing". The two used to share one message, which told a
   * brand-new user to adjust search criteria they had never set.
   */
  totalCount: number;
  /** True when at least one filter is narrowing the list. */
  filtersActive: boolean;
  onClearFilters: () => void;
  onAddFirst: () => void;
  onView: (application: Application) => void;
  onEdit: (application: Application) => void;
  onDuplicate: (application: Application) => void;
  onDelete: (application: Application) => void;
}

export default function ApplicationList({
  applications,
  totalCount,
  filtersActive,
  onClearFilters,
  onAddFirst,
  onView,
  onEdit,
  onDuplicate,
  onDelete,
}: ApplicationListProps) {
  // Nothing tracked yet. Not a filter problem, so it must not read like one.
  if (totalCount === 0) {
    return (
      <div className="rounded-md border border-border bg-surface px-6 py-12 text-center">
        <p className="text-base font-medium text-text">No applications yet</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-text-muted">
          Add your first application to start tracking it, or import what you
          have already applied to from Gmail.
        </p>
        <button
          type="button"
          onClick={onAddFirst}
          className="mt-4 inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover"
        >
          + Add your first application
        </button>
      </div>
    );
  }

  // Rows exist, the current filters just exclude all of them.
  if (applications.length === 0) {
    return (
      <div className="rounded-md border border-border bg-surface px-6 py-12 text-center">
        <p className="text-base font-medium text-text">
          No applications match these filters
        </p>
        <p className="mt-1 text-sm text-text-muted">
          {totalCount === 1
            ? "You have 1 application, and it falls outside the current filters."
            : `You have ${totalCount} applications, and none of them fall inside the current filters.`}
        </p>
        {filtersActive && (
          <button
            type="button"
            onClick={onClearFilters}
            className="mt-4 rounded-md border border-border px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-2 hover:text-text"
          >
            Clear all filters
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {applications.map((application) => (
        <ApplicationCard
          key={application.id}
          application={application}
          onView={onView}
          onEdit={onEdit}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

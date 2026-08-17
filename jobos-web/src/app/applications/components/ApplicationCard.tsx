"use client";

import type { Application } from "../types";
import { formatApplicationDate } from "../utils";
import StatusBadge from "./StatusBadge";
import ApplicationCardMenu from "./ApplicationCardMenu";

interface ApplicationCardProps {
  application: Application;
  onView: (application: Application) => void;
  onEdit: (application: Application) => void;
  onDuplicate: (application: Application) => void;
  onDelete: (application: Application) => void;
}

export default function ApplicationCard({
  application,
  onView,
  onEdit,
  onDuplicate,
  onDelete,
}: ApplicationCardProps) {
  // Optional-in-practice text fields: the columns are NOT NULL, but a row
  // imported from Gmail can carry an empty string, and blank is "unknown".
  const location = application.location.trim();
  const jobPortal = application.jobPortal.trim();
  const salary = application.salary?.trim() ?? "";

  return (
    <article className="rounded-md border border-border bg-surface p-4 transition-colors hover:border-border-strong">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-text">
              {application.company}
            </h3>
            <StatusBadge status={application.status} />
          </div>

          <p className="mt-0.5 text-sm font-medium text-text-secondary">
            {application.role}
          </p>

          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-text-muted">
            {/* Location, only when one was actually recorded — an empty pin
                would read as missing data rather than as no data. */}
            {location && (
              <span className="inline-flex items-center gap-1.5">
                <svg
                  className="h-4 w-4 shrink-0 text-text-muted"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z"
                  />
                </svg>
                {location}
              </span>
            )}

            <span className="inline-flex items-center gap-1.5">
              <svg
                className="h-4 w-4 shrink-0 text-text-muted"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5"
                />
              </svg>
              Applied {formatApplicationDate(application.appliedDate)}
            </span>

            {/* Source/portal, explicitly labelled. The company is the heading
                above; this field records only where the application came from,
                so the two can never be visually confused. */}
            {jobPortal && (
              <span className="inline-flex items-center gap-1.5">
                <svg
                  className="h-4 w-4 shrink-0 text-text-muted"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"
                  />
                </svg>
                via {jobPortal}
              </span>
            )}

            {salary && (
              <span className="inline-flex items-center gap-1.5">
                <svg
                  className="h-4 w-4 shrink-0 text-text-muted"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                  />
                </svg>
                {salary}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onView(application)}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text-secondary transition-colors hover:border-border-strong hover:bg-surface-2 hover:text-text"
          >
            View
          </button>
          <button
            type="button"
            onClick={() => onEdit(application)}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text-secondary transition-colors hover:border-border-strong hover:bg-surface-2 hover:text-text"
          >
            Edit
          </button>
          <ApplicationCardMenu
            onDuplicate={() => onDuplicate(application)}
            onDelete={() => onDelete(application)}
          />
        </div>
      </div>
    </article>
  );
}

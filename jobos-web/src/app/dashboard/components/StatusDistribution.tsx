import type { ApplicationStatus } from "../../applications/types";

interface StatusDistributionProps {
  /** Zero-filled counts from `computeStatusDistribution` over the window. */
  statusCounts: Record<ApplicationStatus, number>;
  /** Size of the same window-filtered set, used as the bar scale. */
  total: number;
  windowDays: number;
}

/** Every status the schema allows, in pipeline order. Ghosted included. */
const ORDER: readonly { status: ApplicationStatus; bar: string }[] = [
  { status: "Applied", bar: "bg-accent" },
  { status: "Interview", bar: "bg-warning" },
  { status: "Offer", bar: "bg-success" },
  { status: "Rejected", bar: "bg-danger" },
  { status: "Ghosted", bar: "bg-text-muted" },
];

/**
 * Status distribution across the reported window.
 *
 * Counts real application rows and nothing else. With an empty window it says so
 * plainly rather than drawing five empty bars that imply a pipeline exists, and
 * the percentage is only shown when there is a total to divide by.
 */
export default function StatusDistribution({
  statusCounts,
  total,
  windowDays,
}: StatusDistributionProps) {
  return (
    <div className="h-full rounded-md border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold text-text">Status breakdown</h2>
      <p className="mt-0.5 text-xs text-text-muted">
        Applications in the last {windowDays} days, by current status
      </p>

      {total === 0 ? (
        <p className="mt-5 text-sm text-text-muted">
          No applications fall in this window, so there is nothing to break down.
          Try a wider window.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {ORDER.map(({ status, bar }) => {
            const count = statusCounts[status];
            const percent = Math.round((count / total) * 100);

            return (
              <div key={status}>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-text-secondary">{status}</span>
                  <span className="text-text-secondary">
                    {count}
                    <span className="ml-1 text-xs text-text-muted">
                      {percent}%
                    </span>
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                  <div
                    className={`h-full rounded-full ${bar}`}
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

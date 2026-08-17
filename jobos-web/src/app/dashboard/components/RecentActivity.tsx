import type { ActivityItem } from "../types";
import { formatRelativeTime } from "../utils";
import StatusBadge from "../../applications/components/StatusBadge";

interface RecentActivityProps {
  activities: ActivityItem[];
}

/**
 * Recent activity, limited to what is actually recorded.
 *
 * Every row is one `application_status_history` event, shown at its real
 * `changed_at`. Nothing is derived from `applied_date`, `updated_at`, or the
 * application's current status, so an application whose status has never changed
 * contributes no row and the panel reports the feed as empty.
 */
const eventIcon = (
  <svg
    className="h-5 w-5"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z"
    />
  </svg>
);

export default function RecentActivity({ activities }: RecentActivityProps) {
  if (activities.length === 0) {
    return (
      <div className="h-full rounded-md border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-text">Recent activity</h2>
        <div className="mt-6 flex flex-col items-center justify-center py-6">
          <div className="flex h-12 w-12 items-center justify-center rounded-md bg-surface-2 text-text-muted">
            <svg
              className="h-6 w-6"
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
          </div>
          <p className="mt-3 text-sm font-medium text-text-secondary">
            No recent activity
          </p>
          <p className="mt-1 max-w-[15rem] text-center text-xs text-text-muted">
            Status changes appear here once an application moves.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full rounded-md border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold text-text">Recent activity</h2>
      <div className="mt-3 space-y-1">
        {activities.map((activity) => (
          <div
            key={activity.id}
            className="flex items-start gap-3 rounded-md p-2 transition-colors hover:bg-surface-2"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
              {eventIcon}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-text">{activity.label}</p>
              <p className="mt-0.5 truncate text-xs text-text-muted">
                {activity.role}
              </p>
              <div className="mt-1.5 flex items-center gap-2">
                <StatusBadge status={activity.status} />
                <span className="text-xs text-text-muted">
                  {formatRelativeTime(activity.timestamp)}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

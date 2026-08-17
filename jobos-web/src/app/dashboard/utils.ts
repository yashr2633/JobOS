/*
 * `computeDashboardStats` used to live here and shaped an unlinked five-figure
 * stat row. The dashboard's KPI row is now computed by `computeWindowReport` in
 * `report.ts`, over the window-filtered application set, and every card links
 * into /applications with that filter applied — so the intermediate shape and its
 * derived response-rate figure had no remaining caller.
 */

/*
 * Recent activity used to be derived here, one "Applied to X" row per
 * application dated with `applied_date`, because no status history existed.
 * `application_status_history` records real events now, so the feed is built
 * from those rows in `recentActivity.ts` and nothing about it is inferred from
 * an application row.
 */

/**
 * Relative age of a persisted date. An unparseable value reports `—`: it is
 * unknown, and rendering it as "Today" would invent a timestamp.
 */
export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "—";

  const now = new Date();
  const diffInMs = now.getTime() - date.getTime();
  const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

  // A date in the future has no "ago" reading, so show the date itself rather
  // than a negative age.
  if (diffInDays < 0) return date.toLocaleDateString();
  if (diffInDays === 0) return "Today";
  if (diffInDays === 1) return "Yesterday";
  if (diffInDays < 7) return `${diffInDays} days ago`;
  if (diffInDays < 30) return `${Math.floor(diffInDays / 7)} weeks ago`;
  return `${Math.floor(diffInDays / 30)} months ago`;
}

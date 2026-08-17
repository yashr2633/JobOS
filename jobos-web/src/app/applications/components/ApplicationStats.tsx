import type { ApplicationStats as ApplicationStatsData } from "../types";
import { ACTIVE_STATUSES } from "../../dashboard/metrics";

interface StatCardProps {
  label: string;
  value: number;
  accent: string;
  hint?: string;
}

function StatCard({ label, value, accent, hint }: StatCardProps) {
  return (
    <div className="rounded-md border border-border bg-surface p-3 sm:p-4">
      <p className="text-xs font-medium text-text-muted">{label}</p>
      <p
        className={`mt-1.5 text-xl font-semibold tracking-tight sm:text-2xl ${accent}`}
      >
        {value}
      </p>
      {hint && <p className="mt-1 hidden text-xs text-text-muted sm:block">{hint}</p>}
    </div>
  );
}

interface ApplicationStatsProps {
  stats: ApplicationStatsData;
  /**
   * What these numbers are counted over, e.g. "All time" or "Last 30 days".
   *
   * Rendered because the Dashboard reports the same figures over ITS window: the
   * two screens legitimately differ when their scopes differ, and Ghosted makes
   * that visible (it is derived from prolonged silence, so a narrow window
   * contains none). Naming the scope is what turns a confusing mismatch into a
   * comprehensible one.
   */
  scopeLabel?: string;
}

/**
 * The Applications summary.
 *
 * All five lifecycle statuses plus Total and Active, from the canonical
 * `summarizeApplicationStatuses`. Offer and Ghosted were previously absent from
 * this row entirely, so a list full of Ghosted applications had no Ghosted count
 * beside it — the inconsistency this fixes.
 *
 * Grid: two columns on a phone (readable at 375px), three at `sm`, six on a wide
 * screen, so no card is ever clipped and the row never scrolls sideways.
 */
export default function ApplicationStats({
  stats,
  scopeLabel,
}: ApplicationStatsProps) {
  return (
    <div>
      {scopeLabel && (
        <p className="mb-2 text-xs text-text-muted">
          Counting <span className="font-medium text-text-secondary">{scopeLabel}</span>
        </p>
      )}

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-6">
        <StatCard label="Total" value={stats.total} accent="text-text" />
        <StatCard
          label="Active"
          value={stats.active}
          accent="text-accent"
          hint={ACTIVE_STATUSES.join(", ")}
        />
        <StatCard label="Interview" value={stats.interview} accent="text-warning" />
        <StatCard label="Offer" value={stats.offer} accent="text-success" />
        <StatCard label="Rejected" value={stats.rejected} accent="text-danger" />
        {/* Ghosted: real applications that went silent. Counted from the stored
            status, never inferred here. */}
        <StatCard
          label="Ghosted"
          value={stats.ghosted}
          accent="text-text-secondary"
          hint="No reply for a long time"
        />
      </div>
    </div>
  );
}

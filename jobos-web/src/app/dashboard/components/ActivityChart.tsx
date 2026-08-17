import type { ActivitySeries } from "../metrics";

interface ActivityChartProps {
  /** Range-aware series from `computeActivitySeries`. */
  activity: ActivitySeries;
  /** Day span of the selected reporting window, for the caption. */
  windowDays: number;
}

/**
 * Application activity for the selected reporting window.
 *
 * Replaces the old "Weekly applications" chart, which drew a FIXED eight-week
 * series regardless of the 7 / 30 / 90-day selector and excluded the current
 * partial week — so a 7-day selection showed an all-zero chart even when the user
 * had applied that week.
 *
 * What changed, and why each part matters:
 *
 *  - The heading names the ACTUAL granularity ("per day" / "per week"), so it can
 *    never claim to be weekly while showing days.
 *  - Bars are scaled against `peak`, and when `peak` is 0 nothing is drawn at all.
 *    The previous version applied a 2% minimum height to every bar, which made an
 *    empty period look like a real floor of activity.
 *  - An empty period renders an explicit message instead of a chart, because a row
 *    of zero-height bars reads as a rendering fault rather than as "no activity".
 *  - Axis labels are thinned via `labelEvery`, so 30 daily buckets stay readable
 *    at 375px instead of overlapping into an unreadable smear.
 *
 * The bar styling, border, and surface are carried over unchanged, so this sits in
 * the same visual language as the rest of the dashboard.
 */
export default function ActivityChart({
  activity,
  windowDays,
}: ActivityChartProps) {
  const { buckets, granularity, total, peak, labelEvery } = activity;
  const hasActivity = peak > 0;

  const unitLabel = granularity === "day" ? "per day" : "per week";

  return (
    <div className="h-full rounded-md border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-text">Application activity</h2>
          <p className="mt-0.5 text-xs text-text-muted">
            Last {windowDays} days, {unitLabel}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
          <span className="text-xs text-text-muted">
            {total} {total === 1 ? "application" : "applications"}
          </span>
        </div>
      </div>

      {hasActivity ? (
        <>
          {/* `items-end` with a fixed height is what makes the bars share a
              baseline. `gap-px` rather than `gap-2` so 30 daily bars still fit at
              375px without shrinking to invisibility. */}
          <div
            className="mt-5 flex h-40 items-end gap-px sm:gap-0.5"
            role="img"
            aria-label={`Application activity for the last ${windowDays} days, ${unitLabel}. ${total} applications in total.`}
          >
            {buckets.map((bucket, index) => {
              // Scaled against the tallest bucket. A real zero stays at zero —
              // no minimum height, so "no activity that day" looks like it.
              const heightPercent = (bucket.count / peak) * 100;

              return (
                <div
                  key={bucket.startMs}
                  className="group relative flex h-full flex-1 flex-col justify-end"
                >
                  <div
                    className={`w-full rounded-t-sm transition-colors ${
                      bucket.count > 0
                        ? "bg-accent/70 group-hover:bg-accent"
                        : "bg-transparent"
                    }`}
                    style={{ height: `${heightPercent}%` }}
                  />
                  {/* A faint baseline tick marks an empty bucket, so the axis
                      still reads as a continuous timeline. */}
                  {bucket.count === 0 && (
                    <div className="h-px w-full bg-border" aria-hidden="true" />
                  )}

                  <div className="pointer-events-none absolute -top-1 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-text opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
                    {bucket.fullLabel}: {bucket.count}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-2 flex gap-px sm:gap-0.5" aria-hidden="true">
            {buckets.map((bucket, index) => (
              <div key={bucket.startMs} className="flex-1 overflow-hidden">
                {/* Thinned labels: every bucket would overlap at 30 daily bars. */}
                {index % labelEvery === 0 && (
                  <p className="text-center text-[10px] leading-none text-text-muted">
                    {bucket.label}
                  </p>
                )}
              </div>
            ))}
          </div>
        </>
      ) : (
        /* Truthful empty state. Not a flat chart, and not a fabricated value. */
        <div className="mt-5 flex h-40 flex-col items-center justify-center rounded-md border border-dashed border-border px-4 text-center">
          <p className="text-sm font-medium text-text">No activity in this period</p>
          <p className="mt-1 text-xs text-text-secondary">
            No applications were logged in the last {windowDays} days. Try a wider
            range, or sync from Gmail below.
          </p>
        </div>
      )}
    </div>
  );
}

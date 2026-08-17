import type { PortalCount } from "../metrics";

interface PortalBreakdownProps {
  /** Busiest-first counts from `computePortalDistribution` over the window. */
  portals: PortalCount[];
  /** False when the data says nothing — every row Unknown, or no rows at all. */
  hasData: boolean;
  windowDays: number;
}

/** How many portals are listed before the rest are summed into one row. */
const VISIBLE_PORTALS = 6;

/**
 * Where applications came from, over the reported window.
 *
 * `computePortalDistribution` has existed and been unwired; it is wired here on
 * one condition — it renders only when the breakdown actually says something. A
 * window where every row's portal is blank produces a single "Unknown" bar,
 * which looks like insight and carries none, so that case gets an honest empty
 * state instead. No series is ever padded or invented.
 */
export default function PortalBreakdown({
  portals,
  hasData,
  windowDays,
}: PortalBreakdownProps) {
  const shown = portals.slice(0, VISIBLE_PORTALS);
  const remainder = portals.slice(VISIBLE_PORTALS);
  const remainderCount = remainder.reduce((total, entry) => total + entry.count, 0);
  const max = Math.max(0, ...portals.map((entry) => entry.count));

  return (
    <div className="h-full rounded-md border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold text-text">Where they came from</h2>
      <p className="mt-0.5 text-xs text-text-muted">
        Source recorded on each application, last {windowDays} days
      </p>

      {!hasData ? (
        <p className="mt-5 text-sm text-text-muted">
          Not enough recorded sources in this window to break down. The source is
          filled in when you add an application or when a scan can read it from
          the email.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {shown.map((entry) => (
            <div key={entry.portal}>
              <div className="flex items-baseline justify-between text-sm">
                <span className="truncate text-text-secondary">{entry.portal}</span>
                <span className="text-text-secondary">{entry.count}</span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{
                    width: `${max === 0 ? 0 : Math.round((entry.count / max) * 100)}%`,
                  }}
                />
              </div>
            </div>
          ))}

          {remainder.length > 0 && (
            <p className="text-xs text-text-muted">
              + {remainder.length} more source
              {remainder.length === 1 ? "" : "s"} covering {remainderCount}{" "}
              application{remainderCount === 1 ? "" : "s"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

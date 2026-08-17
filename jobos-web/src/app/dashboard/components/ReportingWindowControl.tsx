import Link from "next/link";

import {
  REPORTING_WINDOW_OPTIONS,
  type ReportingWindow,
} from "../reportingWindow";

interface ReportingWindowControlProps {
  /** The window currently being reported, already narrowed. */
  selected: ReportingWindow;
}

/**
 * The reporting-window control: 7 / 30 / 90 days.
 *
 * Deliberately links rather than holding React state. The window is a URL search
 * param, so refresh, back/forward and a shared link all report the same period,
 * and the control keeps working with no client JavaScript at all. Local state
 * would lose the selection on every refresh and would make the URL a lie.
 *
 * This is NOT the Gmail scan selector. It changes which persisted applications
 * are counted; it does not read any mail. The scan module keeps its own,
 * separately tested window set.
 */
export default function ReportingWindowControl({
  selected,
}: ReportingWindowControlProps) {
  return (
    <div
      role="group"
      aria-label="Reporting window"
      className="inline-flex rounded-md border border-border bg-surface p-0.5"
    >
      {REPORTING_WINDOW_OPTIONS.map((option) => {
        const isSelected = option.value === selected;

        return (
          <Link
            key={option.value}
            href={`/?window=${option.value}`}
            aria-current={isSelected ? "page" : undefined}
            className={`rounded-[5px] px-3 py-1.5 text-sm font-medium transition-colors ${
              isSelected
                ? "bg-accent text-accent-fg"
                : "text-text-secondary hover:bg-surface-2 hover:text-text"
            }`}
          >
            {option.days}d
          </Link>
        );
      })}
    </div>
  );
}

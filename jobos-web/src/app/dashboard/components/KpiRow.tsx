import Link from "next/link";

import type { ApplicationStatus } from "../../applications/types";
import { kpiHref, type KpiStatus } from "../report";
import type { ReportingWindow } from "../reportingWindow";
import StatCard from "./StatCard";

interface KpiRowProps {
  window: ReportingWindow;
  /** Size of the window-filtered application set. */
  totalApplications: number;
  /** Per-status counts over that same set. */
  statusCounts: Record<ApplicationStatus, number>;
}

/**
 * The KPI row: Total Applications, then one card per pipeline status.
 *
 * Every figure is a count of REAL `applications` rows inside the reported
 * window — the props carry nothing else, and no Gmail message counter is in
 * scope here at all. Message counts live in the scan module, in their own panel.
 *
 * Each card is a link into `/applications` with the same filter applied, using
 * the `status` and `window` params that page reads, so a number on the dashboard
 * can always be opened as the list of records behind it.
 *
 * Ghosted has a card too. It is the outcome a job seeker most wants to count, and
 * leaving it out of the row meant the one number they cared about was the only one
 * they could not open as a list.
 */
const CARDS: readonly {
  status: KpiStatus;
  title: string;
  accentColor: string;
}[] = [
  { status: "Applied", title: "Applied", accentColor: "text-accent" },
  { status: "Interview", title: "Interview", accentColor: "text-warning" },
  { status: "Offer", title: "Offer", accentColor: "text-success" },
  { status: "Rejected", title: "Rejected", accentColor: "text-danger" },
  { status: "Ghosted", title: "Ghosted", accentColor: "text-text-muted" },
];

const documentIcon = (
  <svg
    className="h-4 w-4"
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

const statusIcon = (
  <svg
    className="h-4 w-4"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z"
    />
  </svg>
);

export default function KpiRow({
  window,
  totalApplications,
  statusCounts,
}: KpiRowProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Link href={kpiHref(window)} className="block rounded-md">
        <StatCard
          title="Total Applications"
          value={totalApplications}
          icon={documentIcon}
          accentColor="text-text"
        />
      </Link>

      {CARDS.map((card) => (
        <Link key={card.status} href={kpiHref(window, card.status)} className="block rounded-md">
          <StatCard
            title={card.title}
            value={statusCounts[card.status]}
            icon={statusIcon}
            accentColor={card.accentColor}
          />
        </Link>
      ))}
    </div>
  );
}

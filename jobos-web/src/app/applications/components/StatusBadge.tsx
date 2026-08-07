import type { ApplicationStatus } from "../types";

const statusStyles: Record<ApplicationStatus, string> = {
  Applied: "bg-blue-500/10 text-blue-400 ring-blue-500/20",
  Interview: "bg-yellow-500/10 text-yellow-400 ring-yellow-500/20",
  Offer: "bg-green-500/10 text-green-400 ring-green-500/20",
  Rejected: "bg-red-500/10 text-red-400 ring-red-500/20",
  Ghosted: "bg-slate-500/10 text-slate-400 ring-slate-500/20",
};

interface StatusBadgeProps {
  status: ApplicationStatus;
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${statusStyles[status]}`}
    >
      {status}
    </span>
  );
}

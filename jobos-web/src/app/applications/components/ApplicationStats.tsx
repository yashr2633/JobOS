import type { ApplicationStats as ApplicationStatsData } from "../types";

interface StatCardProps {
  label: string;
  value: number;
  accent: string;
}

function StatCard({ label, value, accent }: StatCardProps) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
      <p className="text-sm font-medium text-slate-400">{label}</p>
      <p className={`mt-2 text-3xl font-bold tracking-tight ${accent}`}>
        {value}
      </p>
    </div>
  );
}

interface ApplicationStatsProps {
  stats: ApplicationStatsData;
}

export default function ApplicationStats({ stats }: ApplicationStatsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label="Total Applications"
        value={stats.total}
        accent="text-white"
      />
      <StatCard label="Active" value={stats.active} accent="text-blue-400" />
      <StatCard
        label="Interviews"
        value={stats.interviews}
        accent="text-yellow-400"
      />
      <StatCard
        label="Rejected"
        value={stats.rejected}
        accent="text-red-400"
      />
    </div>
  );
}

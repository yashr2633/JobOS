interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  accentColor: string;
}

export default function StatCard({
  title,
  value,
  icon,
  trend,
  accentColor,
}: StatCardProps) {
  return (
    <div className="group relative rounded-xl border border-slate-800/50 bg-slate-900/50 p-5 backdrop-blur-sm transition-all duration-200 hover:border-slate-700/50 hover:bg-slate-900/80 hover:shadow-lg hover:shadow-slate-950/50">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
            {title}
          </p>
          <p className={`mt-3 text-3xl font-semibold tracking-tight ${accentColor}`}>
            {value}
          </p>
          {trend && (
            <div className="mt-3 flex items-center gap-1.5">
              <div
                className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ${
                  trend.isPositive
                    ? "bg-emerald-500/10 text-emerald-400"
                    : "bg-rose-500/10 text-rose-400"
                }`}
              >
                <svg
                  className={`h-3 w-3 ${trend.isPositive ? "" : "rotate-180"}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M2.25 18 9 11.25l4.306 4.306a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941"
                  />
                </svg>
                <span>{trend.value}%</span>
              </div>
              <span className="text-xs text-slate-500">vs last week</span>
            </div>
          )}
        </div>
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-800/50 transition-colors duration-200 group-hover:bg-slate-800 ${accentColor}`}>
          {icon}
        </div>
      </div>
    </div>
  );
}

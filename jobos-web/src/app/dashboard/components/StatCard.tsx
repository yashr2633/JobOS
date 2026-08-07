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
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 transition-colors hover:border-slate-700">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-slate-400">{title}</p>
          <p className={`mt-2 text-3xl font-bold tracking-tight ${accentColor}`}>
            {value}
          </p>
          {trend && (
            <p
              className={`mt-2 flex items-center gap-1 text-sm ${
                trend.isPositive ? "text-green-400" : "text-red-400"
              }`}
            >
              <svg
                className={`h-4 w-4 ${trend.isPositive ? "" : "rotate-180"}`}
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M2.25 18 9 11.25l4.306 4.306a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941"
                />
              </svg>
              {trend.value}%
            </p>
          )}
        </div>
        <div className={`rounded-lg bg-slate-800 p-3 ${accentColor}`}>
          {icon}
        </div>
      </div>
    </div>
  );
}

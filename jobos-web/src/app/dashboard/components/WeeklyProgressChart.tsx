import type { WeeklyData } from "../types";

interface WeeklyProgressChartProps {
  data: WeeklyData[];
}

export default function WeeklyProgressChart({
  data,
}: WeeklyProgressChartProps) {
  const maxApplications = Math.max(...data.map((d) => d.applications));

  return (
    <div className="h-full rounded-xl border border-slate-800/50 bg-slate-900/50 p-6 backdrop-blur-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-white">
          Weekly Applications
        </h2>
        <div className="flex items-center gap-2 rounded-lg bg-slate-800/50 px-2.5 py-1.5">
          <span className="h-2 w-2 rounded-full bg-blue-500"></span>
          <span className="text-xs font-medium text-slate-400">
            Applications
          </span>
        </div>
      </div>

      <div className="mt-8 flex items-end justify-between gap-3 h-56">
        {data.map((item, index) => {
          const heightPercent = (item.applications / maxApplications) * 100;

          return (
            <div
              key={index}
              className="group flex flex-1 flex-col items-center gap-3"
            >
              <div className="relative flex w-full items-end justify-center h-full">
                <div
                  className="relative w-full max-w-[32px] rounded-t-lg bg-blue-500/80 transition-all duration-300 hover:bg-blue-500"
                  style={{ height: `${heightPercent}%` }}
                >
                  <div className="absolute -top-7 left-1/2 -translate-x-1/2 rounded-md bg-slate-800 px-2 py-1 text-xs font-semibold text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                    {item.applications}
                  </div>
                </div>
              </div>
              <p className="text-[10px] font-medium text-slate-500 transition-colors duration-200 group-hover:text-slate-400">
                {item.week}
              </p>
            </div>
          );
        })}
      </div>

      <div className="mt-6 flex items-center justify-center gap-2 rounded-lg bg-emerald-500/5 px-3 py-2">
        <svg
          className="h-4 w-4 text-emerald-400"
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
        <span className="text-xs font-medium text-emerald-400">
          Trending up this week
        </span>
      </div>
    </div>
  );
}

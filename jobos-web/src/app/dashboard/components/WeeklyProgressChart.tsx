import type { WeeklyData } from "../types";

interface WeeklyProgressChartProps {
  data: WeeklyData[];
}

export default function WeeklyProgressChart({
  data,
}: WeeklyProgressChartProps) {
  const maxApplications = Math.max(...data.map((d) => d.applications));

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">
          Weekly Application Progress
        </h2>
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <span className="h-3 w-3 rounded-full bg-blue-500"></span>
          <span>Applications</span>
        </div>
      </div>

      <div className="mt-6 flex items-end justify-between gap-2 h-64">
        {data.map((item, index) => {
          const heightPercent = (item.applications / maxApplications) * 100;

          return (
            <div
              key={index}
              className="flex flex-1 flex-col items-center gap-2"
            >
              <div className="relative flex w-full items-end justify-center">
                <div
                  className="w-full max-w-[40px] rounded-t-lg bg-blue-500 transition-all hover:bg-blue-400"
                  style={{ height: `${heightPercent}%` }}
                >
                  <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-xs font-medium text-white">
                    {item.applications}
                  </div>
                </div>
              </div>
              <p className="text-xs text-slate-500">{item.week}</p>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-center gap-4 text-xs text-slate-400">
        <div className="flex items-center gap-2">
          <svg
            className="h-4 w-4 text-green-400"
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
          <span>Trending up this week</span>
        </div>
      </div>
    </div>
  );
}

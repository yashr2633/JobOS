"use client";

import Link from "next/link";

export default function QuickActions() {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
      <h2 className="text-lg font-semibold text-white">Quick Actions</h2>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Link
          href="/applications"
          className="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-800 p-4 transition-colors hover:border-slate-600 hover:bg-slate-750"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 4.5v15m7.5-7.5h-15"
              />
            </svg>
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-white">Add Application</p>
            <p className="mt-0.5 text-xs text-slate-400">
              Track a new job application
            </p>
          </div>
        </Link>

        <Link
          href="/applications"
          className="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-800 p-4 transition-colors hover:border-slate-600 hover:bg-slate-750"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-yellow-500/10 text-yellow-400">
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
              />
            </svg>
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-white">
              View All Applications
            </p>
            <p className="mt-0.5 text-xs text-slate-400">
              Manage your applications
            </p>
          </div>
        </Link>
      </div>
    </div>
  );
}

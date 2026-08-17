"use client";

import Link from "next/link";

/**
 * Shortcuts to pages that exist, labelled with what they actually do.
 *
 * Flat, bordered rows rather than glowing hover cards — a quiet secondary
 * surface, consistent with the rest of the dashboard's restrained treatment.
 */
export default function QuickActions() {
  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold text-text">Quick actions</h2>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Link
          href="/applications"
          className="group flex items-center gap-3 rounded-md border border-border p-3 transition-colors hover:border-border-strong hover:bg-surface-2"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z"
              />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text">View applications</p>
            <p className="mt-0.5 text-xs text-text-muted">
              Browse, edit, and add from the list
            </p>
          </div>
        </Link>

        <Link
          href="/resumes"
          className="group flex items-center gap-3 rounded-md border border-border p-3 transition-colors hover:border-border-strong hover:bg-surface-2"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5A3.375 3.375 0 0 0 10.125 2.25H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
              />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text">Resume Match</p>
            <p className="mt-0.5 text-xs text-text-muted">
              Analyze and tailor your resume
            </p>
          </div>
        </Link>
      </div>
    </div>
  );
}

"use client";

import type { ApplicationStatusFilter } from "../types";

const statusOptions: ApplicationStatusFilter[] = [
  "All",
  "Applied",
  "Interview",
  "Offer",
  "Rejected",
  "Ghosted",
];

interface ApplicationSearchProps {
  searchQuery: string;
  statusFilter: ApplicationStatusFilter;
  onSearchChange: (query: string) => void;
  onStatusChange: (status: ApplicationStatusFilter) => void;
}

export default function ApplicationSearch({
  searchQuery,
  statusFilter,
  onSearchChange,
  onStatusChange,
}: ApplicationSearchProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row">
      <div className="relative flex-1">
        <svg
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
          />
        </svg>
        <input
          type="search"
          placeholder="Search by company or role..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full rounded-lg border border-slate-800 bg-slate-900 py-2.5 pl-10 pr-4 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>
      
      <select
        value={statusFilter}
        onChange={(e) =>
          onStatusChange(e.target.value as ApplicationStatusFilter)
        }
        aria-label="Filter by status"
        className="w-full rounded-lg border border-slate-800 bg-slate-900 px-4 py-2.5 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:w-44"
      >
        {statusOptions.map((option) => (
          <option key={option} value={option}>
            {option === "All" ? "All Status" : option}
          </option>
        ))}
      </select>
    </div>
  );
}

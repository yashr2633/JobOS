"use client";

import { useEffect } from "react";
import type { Application } from "../types";
import { formatApplicationDate } from "../utils";
import StatusBadge from "./StatusBadge";

interface ViewApplicationModalProps {
  application: Application | null;
  onClose: () => void;
  onEdit: (application: Application) => void;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-white">{value}</dd>
    </div>
  );
}

export default function ViewApplicationModal({
  application,
  onClose,
  onEdit,
}: ViewApplicationModalProps) {
  useEffect(() => {
    if (!application) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [application, onClose]);

  if (!application) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close modal"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="view-application-title"
        className="relative z-10 w-full max-w-lg rounded-xl border border-slate-800 bg-slate-900 shadow-2xl"
      >
        <div className="flex items-start justify-between border-b border-slate-800 px-6 py-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2
                id="view-application-title"
                className="text-lg font-semibold"
              >
                {application.company}
              </h2>
              <StatusBadge status={application.status} />
            </div>
            <p className="mt-1 text-sm text-slate-400">{application.role}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18 18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <dl className="grid grid-cols-1 gap-4 px-6 py-5 sm:grid-cols-2">
          <DetailRow label="Location" value={application.location} />
          <DetailRow
            label="Applied Date"
            value={formatApplicationDate(application.appliedDate)}
          />
          <DetailRow label="Job Portal" value={application.jobPortal} />
          <DetailRow
            label="Salary"
            value={application.salary ?? "Not specified"}
          />
        </dl>

        <div className="flex justify-end gap-3 border-t border-slate-800 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:border-slate-600 hover:bg-slate-800"
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => onEdit(application)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
          >
            Edit Application
          </button>
        </div>
      </div>
    </div>
  );
}

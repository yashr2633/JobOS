"use client";

import type { Resume } from "@/lib/ai/types";
import { formatApplicationDate } from "../../applications/utils";

interface ResumeCardProps {
  resume: Resume;
  onSetDefault: (resume: Resume) => void;
  onDelete: (resume: Resume) => void;
}

const statusStyles: Record<string, string> = {
  complete: "bg-success-bg text-success ring-success/20",
  pending: "bg-warning-bg text-warning ring-warning/25",
  failed: "bg-danger-bg text-danger ring-danger/25",
};

function ExtractionBadge({ resume }: { resume: Resume }) {
  const status = resume.extractionStatus;
  const label =
    status === "complete"
      ? "Text extracted"
      : status === "pending"
        ? "Processing"
        : "Extraction failed";

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${statusStyles[status]}`}
    >
      {label}
    </span>
  );
}

export default function ResumeCard({
  resume,
  onSetDefault,
  onDelete,
}: ResumeCardProps) {
  return (
    <article className="rounded-lg border border-border bg-surface p-5 transition-colors hover:border-border-strong">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-lg font-semibold text-text">
              {resume.label}
            </h3>
            {resume.isDefault && (
              <span className="inline-flex items-center rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-medium text-accent ring-1 ring-inset ring-accent/20">
                Default
              </span>
            )}
            <ExtractionBadge resume={resume} />
          </div>

          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-text-secondary">
            {resume.fileName && (
              <span className="inline-flex items-center gap-1.5">
                <svg
                  className="h-4 w-4 shrink-0 text-text-muted"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
                  />
                </svg>
                {resume.fileName}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <svg
                className="h-4 w-4 shrink-0 text-text-muted"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5"
                />
              </svg>
              Uploaded {formatApplicationDate(resume.createdAt)}
            </span>
          </div>

          {resume.extractionStatus === "failed" && resume.extractionError && (
            <p className="mt-2 text-sm text-danger">{resume.extractionError}</p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {!resume.isDefault && (
            <button
              type="button"
              onClick={() => onSetDefault(resume)}
              className="rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium text-text-secondary transition-colors hover:border-border-strong hover:bg-surface-2 hover:text-text"
            >
              Set as default
            </button>
          )}
          <button
            type="button"
            onClick={() => onDelete(resume)}
            className="rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium text-danger transition-colors hover:border-danger/40 hover:bg-danger/10"
          >
            Delete
          </button>
        </div>
      </div>
    </article>
  );
}

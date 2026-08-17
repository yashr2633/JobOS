"use client";

import { useEffect, useState } from "react";
import type { Application } from "../types";
import { formatApplicationDate } from "../utils";
import { buildGmailMessageUrl } from "@/lib/gmail/sourceLink";
import StatusBadge from "./StatusBadge";
import IntelligencePanel from "./IntelligencePanel";
import StatusHistorySection from "./StatusHistorySection";

interface ViewApplicationModalProps {
  application: Application | null;
  onClose: () => void;
  onEdit: (application: Application) => void;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-text-muted">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-text">{value}</dd>
    </div>
  );
}

export default function ViewApplicationModal({
  application,
  onClose,
  onEdit,
}: ViewApplicationModalProps) {
  const [tab, setTab] = useState<"details" | "intelligence">("details");

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

  // Non-Gmail applications carry no message id, so this is null and the Gmail
  // source section is not rendered. When present, the link targets the
  // connected mailbox (authuser) and the exact stored message.
  const gmailSourceUrl = buildGmailMessageUrl(
    application.gmailMessageId,
    application.gmailAddress
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close modal"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/*
        Same three-region shape as the form modal: the dialog itself is bounded
        to the visible viewport and split into a fixed header (plus tabs), one
        scrolling body, and a footer that cannot be pushed off screen by a long
        job description or a long status history.
      */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="view-application-title"
        className="relative z-10 flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-2xl"
      >
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between border-b border-border px-6 py-4">
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
            <p className="mt-1 text-sm text-text-secondary">{application.role}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-surface-2 hover:text-text"
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

        {/* Tabs */}
        <div className="flex shrink-0 border-b border-border px-6">
          <button
            type="button"
            onClick={() => setTab("details")}
            className={`px-4 py-3 text-sm font-medium transition-colors ${
              tab === "details"
                ? "border-b-2 border-accent text-text"
                : "text-text-secondary hover:text-text-secondary"
            }`}
          >
            Details
          </button>
          <button
            type="button"
            onClick={() => setTab("intelligence")}
            className={`px-4 py-3 text-sm font-medium transition-colors ${
              tab === "intelligence"
                ? "border-b-2 border-accent text-text"
                : "text-text-secondary hover:text-text-secondary"
            }`}
          >
            AI Intelligence
          </button>
        </div>

        {/* Content — the only scrolling region. */}
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {tab === "details" && (
            <>
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <DetailRow label="Company" value={application.company} />
                <DetailRow label="Job Title" value={application.role} />
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-text-muted">
                    Current Status
                  </dt>
                  <dd className="mt-1">
                    <StatusBadge status={application.status} />
                  </dd>
                </div>
                <DetailRow
                  label="Applied Date"
                  value={formatApplicationDate(application.appliedDate)}
                />
                {/* A blank stored value says "not recorded", never an empty row. */}
                <DetailRow
                  label="Location"
                  value={application.location.trim() || "Not specified"}
                />
                <DetailRow
                  label="Source"
                  value={application.jobPortal.trim() || "Not specified"}
                />
                <DetailRow
                  label="Salary"
                  value={application.salary?.trim() || "Not specified"}
                />
              </dl>

              {gmailSourceUrl && (
                <section className="mt-6 border-t border-border pt-5">
                  <h3 className="text-xs font-medium uppercase tracking-wide text-text-muted">
                    Gmail Source
                  </h3>
                  <a
                    href={gmailSourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-2 text-sm text-accent hover:text-accent-hover"
                  >
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.5}
                      stroke="currentColor"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75"
                      />
                    </svg>
                    View original email in Gmail
                  </a>
                </section>
              )}

              <section className="mt-6 border-t border-border pt-5">
                <h3 className="text-xs font-medium uppercase tracking-wide text-text-muted">
                  Job Description
                </h3>
                {application.jobDescription ? (
                  <p className="mt-2 whitespace-pre-wrap text-sm text-text-secondary">
                    {application.jobDescription}
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-text-muted">
                    No job description saved yet.
                  </p>
                )}
              </section>

              <StatusHistorySection applicationId={application.id} />
            </>
          )}

          {tab === "intelligence" && (
            <IntelligencePanel application={application} />
          )}
        </div>

        {/* Footer actions (only on Details tab) */}
        {tab === "details" && (
          <div className="flex shrink-0 justify-end gap-3 border-t border-border px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border-strong px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:border-border-strong hover:bg-surface-2"
            >
              Close
            </button>
            <button
              type="button"
              onClick={() => onEdit(application)}
              className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-colors hover:bg-accent-hover"
            >
              Edit Application
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

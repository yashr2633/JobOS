"use client";

import { useEffect, useState } from "react";
import type { Application, ApplicationStatus, ApplicationFormData } from "../types";
import { applicationToFormData, getEmptyApplicationForm } from "../utils";
import {
  APPLICATION_STATUSES,
  allowedNextStatuses,
} from "@/lib/applications/lifecycle";

/**
 * Statuses a person may set on a NEW application.
 *
 * Creating an application is not a transition — there is no prior status to move
 * from — so the lifecycle table does not apply here. `Ghosted` is still absent:
 * it is a DERIVED state (silence over time), never something a single click
 * establishes.
 */
const initialStatusOptions: ApplicationStatus[] = [
  "Applied",
  "Interview",
  "Offer",
  "Rejected",
];

/** What the form asks the data layer to do with the status field. */
export interface ApplicationSaveOptions {
  /**
   * The user declared this status was set by mistake, so a change the forward
   * table refuses is applied as a recorded correction instead.
   */
  allowCorrection: boolean;
}

interface ApplicationFormModalProps {
  isOpen: boolean;
  mode: "add" | "edit";
  application?: Application;
  onClose: () => void;
  onSave: (
    data: ApplicationFormData,
    options: ApplicationSaveOptions
  ) => Promise<void>;
}

const fieldClass =
  "w-full rounded-md border border-border-strong bg-bg px-3 py-2 text-sm text-text placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

export default function ApplicationFormModal({
  isOpen,
  mode,
  application,
  onClose,
  onSave,
}: ApplicationFormModalProps) {
  const [form, setForm] = useState<ApplicationFormData>(getEmptyApplicationForm);
  const [isSaving, setIsSaving] = useState(false);
  /** Opt-in to a status change the lifecycle would otherwise refuse. */
  const [correcting, setCorrecting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    setForm(
      mode === "edit" && application
        ? applicationToFormData(application)
        : getEmptyApplicationForm()
    );
    setCorrecting(false);

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [isOpen, mode, application, onClose]);

  if (!isOpen) return null;

  const title = mode === "add" ? "Add Application" : "Edit Application";
  const submitLabel =
    mode === "add" ? "Save Application" : "Update Application";

  /**
   * The status this application currently has, when editing one.
   *
   * `null` in add mode: there is no current status, so there is no transition to
   * constrain.
   */
  const currentStatus: ApplicationStatus | null =
    mode === "edit" && application ? application.status : null;

  /**
   * The statuses the control offers.
   *
   * On an existing application that is the current status (staying put) plus the
   * targets the lifecycle allows from it — nothing else, so the UI cannot ask for
   * a change the data layer will refuse. Ticking "set by mistake" widens it to
   * every status, and that save is recorded as a correction.
   */
  const statusOptions: ApplicationStatus[] =
    currentStatus === null
      ? initialStatusOptions
      : correcting
        ? [...APPLICATION_STATUSES]
        : [currentStatus, ...allowedNextStatuses(currentStatus)];

  /** True when the form is asking for a change the forward table refuses. */
  const isCorrection =
    currentStatus !== null &&
    form.status !== currentStatus &&
    !allowedNextStatuses(currentStatus).includes(form.status);

  function toggleCorrecting(next: boolean) {
    setCorrecting(next);
    // Leaving correction mode must not leave an unofferable status selected.
    if (!next && currentStatus !== null) {
      setForm((prev) =>
        prev.status === currentStatus ||
        allowedNextStatuses(currentStatus).includes(prev.status)
          ? prev
          : { ...prev, status: currentStatus }
      );
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsSaving(true);

    try {
      await onSave(form, { allowCorrection: correcting && isCorrection });
      onClose();
    } catch {
      // The caller has already surfaced the Supabase error through the Toast.
      // Keep the modal open so the user can correct the form and retry.
    } finally {
      setIsSaving(false);
    }
  }

  function updateField<K extends keyof ApplicationFormData>(
    key: K,
    value: ApplicationFormData[K]
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden p-4">
      <button
        type="button"
        aria-label="Close modal"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/*
        Three-region dialog: fixed header, scrollable body, always-visible
        footer.

        `max-h-[90dvh]` bounds the dialog to the *visible* viewport (dvh, so a
        mobile browser's collapsing toolbar cannot push the footer out of
        reach), and `flex flex-col` splits that bounded height between the
        regions. Only the middle region grows and scrolls, so no amount of
        content — a multi-thousand-character job description, every optional
        field filled in, a short laptop window — can move the footer: the
        dialog's own height is capped, the footer is `shrink-0`, and the
        overflow is absorbed by the body instead of the page.
      */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="application-form-title"
        className="relative z-10 flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-2xl"
      >
        {/* Region 1 — header. Never scrolls, never shrinks. */}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
          <h2 id="application-form-title" className="text-lg font-semibold">
            {title}
          </h2>
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

        {/*
          The form spans the body and the footer so the submit button stays a
          real form submit (Enter still works) while living outside the
          scrolling area. `min-h-0` is what allows the flex child to be shorter
          than its content, which is what makes the inner overflow work at all.
        */}
        <form
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col"
        >
          {/* Region 2 — the only scrolling region. */}
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label
                  htmlFor="company"
                  className="mb-1.5 block text-sm font-medium text-text-secondary"
                >
                  Company
                </label>
                <input
                  id="company"
                  type="text"
                  required
                  value={form.company}
                  onChange={(e) => updateField("company", e.target.value)}
                  placeholder="e.g. Google"
                  className={fieldClass}
                />
              </div>

              <div className="sm:col-span-2">
                <label
                  htmlFor="role"
                  className="mb-1.5 block text-sm font-medium text-text-secondary"
                >
                  Role
                </label>
                <input
                  id="role"
                  type="text"
                  required
                  value={form.role}
                  onChange={(e) => updateField("role", e.target.value)}
                  placeholder="e.g. Software Engineer"
                  className={fieldClass}
                />
              </div>

              <div>
                <label
                  htmlFor="location"
                  className="mb-1.5 block text-sm font-medium text-text-secondary"
                >
                  Location
                </label>
                <input
                  id="location"
                  type="text"
                  required
                  value={form.location}
                  onChange={(e) => updateField("location", e.target.value)}
                  placeholder="e.g. Remote"
                  className={fieldClass}
                />
              </div>

              <div>
                <label
                  htmlFor="appliedDate"
                  className="mb-1.5 block text-sm font-medium text-text-secondary"
                >
                  Applied Date
                </label>
                <input
                  id="appliedDate"
                  type="date"
                  required
                  value={form.appliedDate}
                  onChange={(e) => updateField("appliedDate", e.target.value)}
                  className={fieldClass}
                />
              </div>

              {/*
                Status control (Sprint 10), unchanged in behaviour: it offers
                only the current status plus `allowedNextStatuses(current)`,
                widened solely by the explicit "set by mistake" opt-in.

                A native <select> paints its option list in the browser's own
                layer, above the page, so the scrolling body above cannot clip
                the open dropdown however long the form is.
              */}
              <div>
                <label
                  htmlFor="status"
                  className="mb-1.5 block text-sm font-medium text-text-secondary"
                >
                  Status
                </label>
                <select
                  id="status"
                  value={form.status}
                  onChange={(e) =>
                    updateField("status", e.target.value as ApplicationStatus)
                  }
                  className="w-full rounded-md border border-border-strong bg-bg px-3 py-2 text-sm text-text focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  {statusOptions.map((option) => (
                    <option key={option} value={option}>
                      {option === currentStatus ? `${option} (current)` : option}
                    </option>
                  ))}
                </select>

                {currentStatus !== null && (
                  <div className="mt-2">
                    <label className="flex items-start gap-2 text-xs text-text-secondary">
                      <input
                        type="checkbox"
                        checked={correcting}
                        onChange={(e) => toggleCorrecting(e.target.checked)}
                        className="mt-0.5 h-3.5 w-3.5 rounded border-border-strong bg-bg"
                      />
                      <span>
                        This status was set by mistake — let me correct it to any
                        status.
                      </span>
                    </label>
                    <p className="mt-1.5 text-xs text-text-muted">
                      {correcting
                        ? "A correction is recorded in the status history like any other change."
                        : `From ${currentStatus}, an application can move to ${
                            allowedNextStatuses(currentStatus).join(", ") ||
                            "no further status"
                          }.`}
                    </p>
                  </div>
                )}
              </div>

              <div>
                <label
                  htmlFor="jobPortal"
                  className="mb-1.5 block text-sm font-medium text-text-secondary"
                >
                  Job Portal
                </label>
                <input
                  id="jobPortal"
                  type="text"
                  required
                  value={form.jobPortal}
                  onChange={(e) => updateField("jobPortal", e.target.value)}
                  placeholder="e.g. LinkedIn"
                  className={fieldClass}
                />
              </div>

              <div className="sm:col-span-2">
                <label
                  htmlFor="salary"
                  className="mb-1.5 block text-sm font-medium text-text-secondary"
                >
                  Salary{" "}
                  <span className="font-normal text-text-muted">(optional)</span>
                </label>
                <input
                  id="salary"
                  type="text"
                  value={form.salary}
                  onChange={(e) => updateField("salary", e.target.value)}
                  placeholder="e.g. $150k – $180k"
                  className={fieldClass}
                />
              </div>

              <div className="sm:col-span-2">
                <label
                  htmlFor="jobDescription"
                  className="mb-1.5 block text-sm font-medium text-text-secondary"
                >
                  Job Description{" "}
                  <span className="font-normal text-text-muted">(optional)</span>
                </label>
                {/*
                  Kept at its full six rows. A long JD makes the body scroll,
                  which is the point of the three-region layout — the field is
                  never shrunk or hidden to buy space for the footer.
                */}
                <textarea
                  id="jobDescription"
                  rows={6}
                  value={form.jobDescription}
                  onChange={(e) =>
                    updateField("jobDescription", e.target.value)
                  }
                  placeholder="Paste the job description text to enable Resume Match analysis..."
                  className={fieldClass}
                />
                <p className="mt-1.5 text-xs text-text-muted">
                  Changing this text clears the cached analysis of the old
                  description, so the next Resume Match run reads the new one.
                </p>
              </div>
            </div>
          </div>

          {/*
            Region 3 — footer. `shrink-0` outside the scroll container, so
            Cancel and Save/Update are on screen at every viewport height.
          */}
          <div className="flex shrink-0 justify-end gap-3 border-t border-border bg-surface px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border-strong px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:border-border-strong hover:bg-surface-2"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSaving ? "Saving…" : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

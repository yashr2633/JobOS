"use client";

import { useEffect, useState } from "react";
import type { Application, ApplicationStatus, ApplicationFormData } from "../types";
import { applicationToFormData, getEmptyApplicationForm } from "../utils";

const statusOptions: ApplicationStatus[] = [
  "Applied",
  "Interview",
  "Offer",
  "Rejected",
  "Ghosted",
];

interface ApplicationFormModalProps {
  isOpen: boolean;
  mode: "add" | "edit";
  application?: Application;
  onClose: () => void;
  onSave: (data: ApplicationFormData) => Promise<void>;
}

export default function ApplicationFormModal({
  isOpen,
  mode,
  application,
  onClose,
  onSave,
}: ApplicationFormModalProps) {
  const [form, setForm] = useState<ApplicationFormData>(getEmptyApplicationForm);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    setForm(
      mode === "edit" && application
        ? applicationToFormData(application)
        : getEmptyApplicationForm()
    );

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSaving(true);

    try {
      await onSave(form);
      onClose();
    } catch {
      // The caller has already surfaced the Supabase error. Keep the modal
      // open so the user can correct the form and retry.
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
        aria-labelledby="application-form-title"
        className="relative z-10 w-full max-w-lg rounded-xl border border-slate-800 bg-slate-900 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <h2 id="application-form-title" className="text-lg font-semibold">
            {title}
          </h2>
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

        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label
                htmlFor="company"
                className="mb-1.5 block text-sm font-medium text-slate-300"
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
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div className="sm:col-span-2">
              <label
                htmlFor="role"
                className="mb-1.5 block text-sm font-medium text-slate-300"
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
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div>
              <label
                htmlFor="location"
                className="mb-1.5 block text-sm font-medium text-slate-300"
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
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div>
              <label
                htmlFor="appliedDate"
                className="mb-1.5 block text-sm font-medium text-slate-300"
              >
                Applied Date
              </label>
              <input
                id="appliedDate"
                type="date"
                required
                value={form.appliedDate}
                onChange={(e) => updateField("appliedDate", e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div>
              <label
                htmlFor="status"
                className="mb-1.5 block text-sm font-medium text-slate-300"
              >
                Status
              </label>
              <select
                id="status"
                value={form.status}
                onChange={(e) =>
                  updateField("status", e.target.value as ApplicationStatus)
                }
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {statusOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="jobPortal"
                className="mb-1.5 block text-sm font-medium text-slate-300"
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
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div className="sm:col-span-2">
              <label
                htmlFor="salary"
                className="mb-1.5 block text-sm font-medium text-slate-300"
              >
                Salary{" "}
                <span className="font-normal text-slate-500">(optional)</span>
              </label>
              <input
                id="salary"
                type="text"
                value={form.salary}
                onChange={(e) => updateField("salary", e.target.value)}
                placeholder="e.g. $150k – $180k"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 border-t border-slate-800 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:border-slate-600 hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

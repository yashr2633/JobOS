/**
 * Unknown applications from Gmail - needs user input to identify employer.
 *
 * Shows browser-local Gmail applications where the company could not be
 * automatically identified. User can fill in the company name and save,
 * updating IndexedDB and refreshing merged views.
 */

"use client";

import { useState } from "react";
import { useLocalGmailApplications } from "@/lib/gmail/useLocalGmailApplications";
import { updateGmailApplication } from "@/lib/gmail/browserStore";
import type { LocalGmailApplication } from "@/lib/gmail/browserStore";

export default function UnknownApplicationsList() {
  const { applications, loading, error, refresh } = useLocalGmailApplications();
  const [editing, setEditing] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<{
    company: string;
    role: string;
  }>({ company: "", role: "" });
  const [saving, setSaving] = useState(false);

  // Filter for unknown company applications
  const unknownApps = applications.filter(
    (app) => !app.company || app.company.trim() === "" || app.company === "Unknown Company"
  );

  const handleEdit = (app: LocalGmailApplication) => {
    setEditing(app.id);
    setEditValues({
      company: app.company || "",
      role: app.role || "",
    });
  };

  const handleSave = async (app: LocalGmailApplication) => {
    if (!editValues.company.trim()) {
      alert("Please enter a company name");
      return;
    }

    setSaving(true);
    try {
      await updateGmailApplication(app.userId, app.gmailMessageId, {
        company: editValues.company.trim(),
        role: (editValues.role.trim() || app.role) ?? undefined,
      });
      
      await refresh();
      setEditing(null);
    } catch (err) {
      alert("Failed to save: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditing(null);
    setEditValues({ company: "", role: "" });
  };

  if (loading) {
    return (
      <div className="rounded-md border border-border bg-surface p-6">
        <h2 className="text-lg font-semibold text-text">Unknown Applications</h2>
        <p className="mt-2 text-sm text-text-muted">Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-danger/20 bg-danger-bg p-6">
        <h2 className="text-lg font-semibold text-danger">Error Loading Unknown Applications</h2>
        <p className="mt-2 text-sm text-danger">{error}</p>
      </div>
    );
  }

  if (unknownApps.length === 0) {
    return (
      <div className="rounded-md border border-border bg-surface p-6">
        <h2 className="text-lg font-semibold text-text">Unknown Applications</h2>
        <p className="mt-2 text-sm text-text-secondary">
          No applications with unknown company found.
        </p>
        <p className="mt-1 text-xs text-text-muted">
          All Gmail-detected applications have been identified or you haven't synced Gmail yet.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border bg-surface p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-text">
          Unknown Applications ({unknownApps.length})
        </h2>
        <p className="mt-1 text-sm text-text-secondary">
          These job applications were detected from your Gmail but need company identification.
        </p>
      </div>

      <div className="space-y-3">
        {unknownApps.map((app) => {
          const isEditing = editing === app.id;

          return (
            <div
              key={app.id}
              className="rounded-md border border-border bg-bg p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  {isEditing ? (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-text-secondary mb-1">
                          Company Name *
                        </label>
                        <input
                          type="text"
                          value={editValues.company}
                          onChange={(e) =>
                            setEditValues({ ...editValues, company: e.target.value })
                          }
                          placeholder="Enter company name"
                          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                          autoFocus
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-text-secondary mb-1">
                          Role/Position
                        </label>
                        <input
                          type="text"
                          value={editValues.role}
                          onChange={(e) =>
                            setEditValues({ ...editValues, role: e.target.value })
                          }
                          placeholder="Enter role (optional)"
                          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleSave(app)}
                          disabled={saving}
                          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-50"
                        >
                          {saving ? "Saving..." : "Save"}
                        </button>
                        <button
                          onClick={handleCancel}
                          disabled={saving}
                          className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-2 disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-text">
                          {app.company || "Unknown Company"}
                        </h3>
                        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-text-muted">
                          {app.status}
                        </span>
                      </div>
                      {app.role && (
                        <p className="mt-1 text-sm text-text-secondary">{app.role}</p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
                        {app.source && (
                          <span>Source: {app.source}</span>
                        )}
                        {app.appliedDate && (
                          <span>
                            Applied: {new Date(app.appliedDate).toLocaleDateString()}
                          </span>
                        )}
                        <span>Confidence: {Math.round(app.confidence * 100)}%</span>
                      </div>
                    </>
                  )}
                </div>
                {!isEditing && (
                  <button
                    onClick={() => handleEdit(app)}
                    className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-2"
                  >
                    Identify
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

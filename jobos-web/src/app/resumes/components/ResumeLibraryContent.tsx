"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fetchResumes, deleteResume, setDefaultResume } from "@/lib/api/resumes";
import type { Resume } from "@/lib/ai/types";
import ResumeUploadForm from "./ResumeUploadForm";
import ResumeCard from "./ResumeCard";
import Toast, { useToast } from "../../components/Toast";
import ConfirmDialog from "../../components/ConfirmDialog";
import { toHumanMessage } from "../../components/errorMessage";

/**
 * Resume Library: upload, list, select-default, and delete resumes.
 *
 * This is the "Resume section" referenced by IntelligencePanel's empty state
 * on /resume-match. It reuses the existing `resumes` table and data-access
 * layer (`@/lib/api/resumes`) — no new schema or duplicate AI logic here.
 * Once a resume is uploaded and its text extracted, it becomes selectable in
 * IntelligencePanel exactly like a pasted-text resume, with no changes
 * needed to the analyze pipeline.
 */
export default function ResumeLibraryContent() {
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** The resume a delete has been requested for, pending confirmation. */
  const [pendingDelete, setPendingDelete] = useState<Resume | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const { toast, showSuccess, showError, dismiss } = useToast();

  const supabase = useMemo(() => createClient(), []);

  const loadResumes = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchResumes(supabase);
      setResumes(data);
    } catch (err: unknown) {
      setError(toHumanMessage(err, "Failed to load resumes."));
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    loadResumes();
  }, [loadResumes]);

  async function handleSetDefault(resume: Resume) {
    try {
      await setDefaultResume(supabase, resume.id);
      await loadResumes();
      showSuccess(`"${resume.label}" is now your default resume.`);
    } catch (err: unknown) {
      showError(toHumanMessage(err, "Failed to set the default resume."));
    }
  }

  async function handleConfirmDelete() {
    if (!pendingDelete) return;
    const resume = pendingDelete;

    setIsDeleting(true);
    try {
      await deleteResume(supabase, resume.id);
      setResumes((prev) => prev.filter((r) => r.id !== resume.id));
      setPendingDelete(null);
      showSuccess(`Deleted "${resume.label}".`);
    } catch (err: unknown) {
      setPendingDelete(null);
      showError(toHumanMessage(err, "Failed to delete the resume."));
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Resumes</h1>
        <p className="mt-2 text-text-secondary">
          Upload and manage the resumes used by Resume Match.
        </p>
      </div>

      <ResumeUploadForm onUploaded={loadResumes} />

      {loading ? (
        <div className="flex min-h-[200px] items-center justify-center">
          <div className="text-center">
            <div className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-4 border-border-strong border-t-blue-500"></div>
            <p className="text-sm text-text-secondary">Loading resumes...</p>
          </div>
        </div>
      ) : error ? (
        <div className="rounded-lg border border-danger/20 bg-danger-bg p-6 text-center">
          <p className="text-danger">{error}</p>
        </div>
      ) : resumes.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface px-6 py-12 text-center">
          <p className="text-lg font-medium text-text-secondary">
            No resumes yet
          </p>
          <p className="mt-1 text-sm text-text-muted">
            Upload a PDF or DOCX resume above to get started.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {resumes.map((resume) => (
            <ResumeCard
              key={resume.id}
              resume={resume}
              onSetDefault={handleSetDefault}
              onDelete={setPendingDelete}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this resume?"
        message={
          pendingDelete
            ? `"${pendingDelete.label}" and its uploaded file will be removed. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete resume"
        busy={isDeleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDelete(null)}
      />

      <Toast toast={toast} onDismiss={dismiss} />
    </div>
  );
}

"use client";

import { useRef, useState } from "react";
import { validateResumeFile } from "@/lib/resumes/validation";
import { uploadResumeFile } from "../../resumes/services/resumeUploadClient";

export interface UploadedResumeInfo {
  id: string;
  fileName: string;
}

interface ResumeUploadStepProps {
  uploadedResume: UploadedResumeInfo | null;
  onUploaded: (resume: UploadedResumeInfo) => void;
}

type UploadStatus = "idle" | "uploading" | "error";

/**
 * Resume step of the Resume Match workflow.
 *
 * Adds a NEW resume to the library, via the existing `resumes` table and
 * `/api/resumes/upload` route (no duplicate pipeline). It is not the only way to
 * choose a resume: `ResumeMatchContent` renders a picker over the saved library
 * above this control, so an already-uploaded resume is reused rather than
 * uploaded again. This step is the "I want to add another one" path, and the
 * parent selects whatever it uploads immediately.
 */
export default function ResumeUploadStep({
  uploadedResume,
  onUploaded,
}: ResumeUploadStepProps) {
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (!file) return;

    setErrorMsg(null);

    const validation = validateResumeFile({
      name: file.name,
      size: file.size,
      type: file.type,
    });

    if (!validation.ok) {
      setErrorMsg(validation.error ?? "Invalid file.");
      setStatus("error");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setStatus("uploading");

    try {
      const uploaded = await uploadResumeFile(file);
      onUploaded({ id: uploaded.id, fileName: file.name });
      setStatus("idle");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Upload failed";
      setErrorMsg(message);
      setStatus("error");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handleReplaceClick() {
    fileInputRef.current?.click();
  }

  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-text-secondary">
        Resume
      </label>

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        onChange={handleFileChange}
        className="hidden"
      />

      {status === "uploading" ? (
        <div className="flex items-center gap-3 rounded-md border border-border-strong bg-bg px-4 py-3">
          <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-border-strong border-t-blue-500"></div>
          <span className="text-sm text-text-secondary">
            Uploading and processing resume...
          </span>
        </div>
      ) : uploadedResume ? (
        <div className="rounded-md border border-success/20 bg-success-bg px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2 text-sm text-success">
              <svg
                className="h-4 w-4 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
              <span className="font-medium text-text">{uploadedResume.fileName}</span>
            </span>
            <button
              type="button"
              onClick={handleReplaceClick}
              className="rounded-md border border-border-strong px-3 py-1 text-xs font-medium text-text-secondary transition-colors hover:border-border-strong hover:bg-surface-2 hover:text-text"
            >
              Replace Resume
            </button>
          </div>
          <p className="mt-1 text-xs text-success/80">
            Resume ready for analysis
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleReplaceClick}
          className="flex w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border-strong bg-bg px-4 py-8 text-center transition-colors hover:border-border-strong hover:bg-surface"
        >
          <svg
            className="h-6 w-6 text-text-muted"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z"
            />
          </svg>
          <span className="text-sm font-medium text-text-secondary">
            Upload Resume
          </span>
          <span className="text-xs text-text-muted">PDF or DOCX, up to 10MB</span>
        </button>
      )}

      {status === "error" && errorMsg && (
        <p className="mt-2 text-sm text-danger">{errorMsg}</p>
      )}
    </div>
  );
}

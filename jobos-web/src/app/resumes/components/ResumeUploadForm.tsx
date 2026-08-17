"use client";

import { useRef, useState } from "react";
import { validateResumeFile } from "@/lib/resumes/validation";
import { uploadResumeFile } from "../services/resumeUploadClient";

interface ResumeUploadFormProps {
  onUploaded: () => void;
}

type UploadStatus = "idle" | "uploading" | "success" | "error";

export default function ResumeUploadForm({ onUploaded }: ResumeUploadFormProps) {
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setErrorMsg(null);
    setStatus("idle");

    if (!file) {
      setSelectedFile(null);
      return;
    }

    const validation = validateResumeFile({
      name: file.name,
      size: file.size,
      type: file.type,
    });

    if (!validation.ok) {
      setSelectedFile(null);
      setErrorMsg(validation.error ?? "Invalid file.");
      setStatus("error");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setSelectedFile(file);
  }

  async function handleUpload() {
    if (!selectedFile || status === "uploading") return;

    setStatus("uploading");
    setErrorMsg(null);

    try {
      await uploadResumeFile(selectedFile);
      setStatus("success");
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      onUploaded();
      // Return to idle shortly after so the form is ready for another upload.
      setTimeout(() => setStatus("idle"), 2000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Upload failed";
      setErrorMsg(message);
      setStatus("error");
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-6">
      <h2 className="text-lg font-semibold text-text">Upload a resume</h2>
      <p className="mt-1 text-sm text-text-secondary">
        PDF or DOCX, up to 10MB. Text is extracted automatically so it can be
        used in Resume Match.
      </p>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={handleFileChange}
          className="block w-full text-sm text-text-secondary file:mr-4 file:rounded-lg file:border-0 file:bg-surface-2 file:px-4 file:py-2 file:text-sm file:font-medium file:text-text hover:file:bg-surface-2"
        />
        <button
          type="button"
          onClick={handleUpload}
          disabled={!selectedFile || status === "uploading"}
          className="shrink-0 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "uploading" ? "Uploading..." : "Upload"}
        </button>
      </div>

      {status === "error" && errorMsg && (
        <p className="mt-3 text-sm text-danger">{errorMsg}</p>
      )}
      {status === "success" && (
        <p className="mt-3 text-sm text-success">
          Resume uploaded and processed successfully.
        </p>
      )}
    </div>
  );
}

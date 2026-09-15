"use client";

import { useRef, useState } from "react";
import { validateResumeFile } from "@/lib/resumes/validation";
import { uploadResumeFile } from "../resumes/services/resumeUploadClient";
import { resumeOptionLabel, selectedResume } from "@/lib/jobs/profile";
import type { ResumeEvidence } from "@/lib/jobs/types";

export default function DiscoveryResumePicker({ resumes, value, onChange, onResumesChange, onBusyChange }: {
  resumes: ResumeEvidence[]; value: string | null; onChange: (id: string | null) => void;
  onResumesChange: (resumes: ResumeEvidence[]) => void; onBusyChange?: (busy: boolean) => void;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const selected = selectedResume(resumes, value);
  async function refresh() {
    const response = await fetch("/api/jobs/profile", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Could not refresh resumes.");
    onResumesChange(data.resumes); setNeedsRefresh(false);
  }
  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const incoming = event.target.files?.[0]; event.target.value = "";
    if (!incoming) return;
    const valid = validateResumeFile({ name: incoming.name, size: incoming.size, type: incoming.type });
    if (!valid.ok) { setError(valid.error ?? "Choose a PDF or DOCX resume."); return; }
    setBusy(true); onBusyChange?.(true); setError(null);
    try {
      const uploaded = await uploadResumeFile(incoming);
      const provisional: ResumeEvidence = { id: uploaded.id, label: uploaded.label, fileName: incoming.name, skills: [], roles: [], yearsExperience: null, usable: false };
      onResumesChange([provisional, ...resumes]); onChange(uploaded.id);
      setNeedsRefresh(true); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not upload resume."); }
    finally { setBusy(false); onBusyChange?.(false); }
  }
  return <div>
    <label className="block text-sm font-semibold">Resume
      <select disabled={busy} value={selected?.id ?? ""} onChange={(e) => onChange(e.target.value || null)} className="mt-2 min-h-[44px] w-full rounded-md border border-border bg-surface px-3 py-2 text-sm font-normal text-text focus:ring-2 focus:ring-accent">
        <option value="">Select an existing resume</option>
        {resumes.map((r) => <option key={r.id} value={r.id} disabled={r.usable === false}>{resumeOptionLabel(r)}</option>)}
      </select>
    </label>
    <input ref={file} type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="hidden" onChange={(e) => void upload(e)} />
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
      <button type="button" disabled={busy} onClick={() => file.current?.click()} className="min-h-[44px] text-sm font-medium text-accent hover:underline disabled:opacity-50">{busy ? "Uploading and reading…" : "Upload new resume"}</button>
      <span className="text-xs text-text-muted">PDF / DOCX · up to 10 MB · newest usable first</span>
    </div>
    {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    {needsRefresh && !busy && <button type="button" onClick={() => { setError(null); void refresh().catch(() => setError("Your file is saved. Please retry refreshing the library.")); }} className="min-h-[44px] text-sm text-accent hover:underline">Refresh uploaded resume</button>}
  </div>;
}

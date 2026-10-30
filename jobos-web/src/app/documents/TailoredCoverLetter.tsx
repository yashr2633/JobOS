"use client";
import { useState } from "react";
import DocumentWorkbench, { type LetterSeed } from "./DocumentWorkbench";
import type { ResumeFormatInput } from "@/lib/resume/templates";
import { fetchResume } from "@/lib/api/resumes";
import { createClient } from "@/lib/supabase/client";

export default function TailoredCoverLetter({ resumeText, resumeId, formatting, role = "", company = "", jobDescription = "", sourceLabel = "your selected resume" }: { resumeText: string; resumeId?: string | null; formatting: ResumeFormatInput; role?: string; company?: string; jobDescription?: string; sourceLabel?: string }) {
  const [seed, setSeed] = useState<{ data: LetterSeed; revision: number } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const ready = !!((resumeText.trim() || resumeId) && role.trim() && company.trim() && jobDescription.trim());
  async function start() {
    if (!ready || busy) return;
    if (seed && !window.confirm("Refresh the Cover Letter from your current resume and job description? Save letter edits first if you want to keep them.")) return;
    setBusy(true); setError(null);
    try {
      const text = resumeText.trim() ? resumeText : resumeId ? (await fetchResume(createClient(), resumeId))?.extractedText ?? "" : "";
      if (!text.trim()) throw new Error("This resume has no readable text. Select another resume or upload a readable PDF/DOCX, then retry.");
      setSeed({ revision: (seed?.revision ?? 0) + 1, data: { resumeText: text, formatting, role, company, jobDescription } });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Your resume could not load. Please retry."); }
    finally { setBusy(false); }
  }
  return <section className="tailored-cover-letter"><div className="studio-format-heading"><div><p className="product-kicker">YOUR APPLICATION LETTER</p><h3>Tailored Cover Letter</h3><p className="document-help">Create a role-specific Cover Letter using {sourceLabel} and this job description. Review, edit and export it here.</p></div><button type="button" className="product-button product-button-primary" disabled={!ready || busy} onClick={() => void start()}>{busy ? "Preparing your letter…" : seed ? "Refresh tailored Cover Letter" : "Create tailored Cover Letter"}</button></div>{!ready && <p className="document-help">Select a readable resume and add the job description, role and company above to get started.</p>}{error && <p role="alert" className="product-notice product-error">{error}</p>}{seed && <DocumentWorkbench key={seed.revision} kind="letter" embedded seed={seed.data} />}</section>;
}

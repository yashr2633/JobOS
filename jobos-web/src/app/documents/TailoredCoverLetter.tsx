"use client";
import { useState } from "react";
import DocumentWorkbench, { type LetterSeed } from "./DocumentWorkbench";
import type { ResumeFormatInput } from "@/lib/resume/templates";

export default function TailoredCoverLetter({ resumeText, formatting, role = "", company = "", jobDescription = "" }: { resumeText: string; formatting: ResumeFormatInput; role?: string; company?: string; jobDescription?: string }) {
  const [seed, setSeed] = useState<{ data: LetterSeed; revision: number } | null>(null);
  function start() {
    if (seed && !window.confirm("Refresh the Cover Letter from your latest tailored resume? Save letter edits first if you want to keep them.")) return;
    setSeed({ revision: (seed?.revision ?? 0) + 1, data: { resumeText, formatting, role, company, jobDescription } });
  }
  return <section className="tailored-cover-letter"><div className="studio-format-heading"><div><h3>Resume + Cover Letter</h3><p className="document-help">Prepare a matching letter from this edited resume, with the same design. Review and edit before export.</p></div><button type="button" className="product-button product-button-primary" onClick={start}>{seed ? "Refresh from edited resume" : "Create matching Cover Letter"}</button></div>{seed && <DocumentWorkbench key={seed.revision} kind="letter" embedded seed={seed.data} />}</section>;
}

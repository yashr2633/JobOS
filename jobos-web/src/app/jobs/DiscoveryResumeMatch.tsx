"use client";

import { useState } from "react";
import Link from "next/link";
import type { Job, ResumeEvidence } from "@/lib/jobs/types";
import IntelligencePanel from "../applications/components/IntelligencePanel";
import ResumeUploadStep, { type UploadedResumeInfo } from "../resume-match/components/ResumeUploadStep";
import { inputClass } from "./CareerProfileForm";

export default function DiscoveryResumeMatch({ job, resumes, initialResumeId }: { job: Job; resumes: ResumeEvidence[]; initialResumeId: string | null }) {
  const [selected, setSelected] = useState(initialResumeId ?? resumes[0]?.id ?? "");
  const [uploaded, setUploaded] = useState<UploadedResumeInfo | null>(null);
  const options = uploaded ? [...resumes, { id: uploaded.id, label: uploaded.fileName }] : resumes;
  return <div className="mx-auto max-w-3xl">
    <Link className="text-sm text-accent hover:underline" href={`/jobs?job=${encodeURIComponent(job.id)}`}>← Back to job</Link>
    <h1 className="mt-4 text-2xl font-semibold">Resume Match</h1>
    <p className="mt-2 text-sm text-text-secondary">{job.title} · {job.company}</p>
    <p className="mt-3 text-sm text-text-secondary">Check your resume before applying. This uses the existing Resume Match analysis and daily allowance. No application is added to your tracker.</p>
    <label className="mt-5 block text-sm">Choose an existing resume<select className={`${inputClass} mt-2`} value={selected} onChange={(e) => setSelected(e.target.value)}><option value="">Select a resume</option>{options.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
    <div className="mt-4"><ResumeUploadStep uploadedResume={uploaded} onUploaded={(r) => { setUploaded(r); setSelected(r.id); }} /></div>
    <details className="my-5 rounded-md border border-border p-4"><summary className="cursor-pointer text-sm font-medium">Job description from the employer</summary><p className="mt-3 whitespace-pre-wrap text-sm text-text-secondary">{job.description}</p></details>
    <IntelligencePanel key={`${job.id}:${selected}`} discoveryJobId={job.id} resumeId={selected || null} application={{ id: job.id, company: job.company, role: job.title, location: job.location, jobPortal: job.source, appliedDate: "", status: "Applied", jobDescription: job.description }} />
    <p className="mt-4 text-xs text-text-muted">AI runs only when you press Analyze Resume. Review recommendations against your real experience. After confirming an application, the existing tracker also provides its full Resume Match workflow.</p>
  </div>;
}

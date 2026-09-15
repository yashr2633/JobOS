"use client";

import { useState } from "react";
import Link from "next/link";
import { parseProfile } from "@/lib/jobs/profile";
import type { CareerProfile, ResumeEvidence, WorkMode } from "@/lib/jobs/types";

export const inputClass = "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent";
export const buttonClass = "min-h-[44px] rounded-md border border-border px-4 py-2 text-sm font-medium text-text hover:bg-surface-2 disabled:opacity-50 disabled:cursor-not-allowed";
export const primaryClass = "min-h-[44px] rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed";
const split = (s: string) => s.split(",").map((s) => s.trim()).filter(Boolean);

export default function CareerProfileForm({ profile, resumes, onSave, onCancel }: {
  profile: CareerProfile; resumes: ResumeEvidence[];
  onSave: (profile: CareerProfile) => void; onCancel: () => void;
}) {
  const [draft, setDraft] = useState(profile);
  const [roles, setRoles] = useState(profile.roles.join(", "));
  const [skills, setSkills] = useState(profile.skills.join(", "));
  const [locations, setLocations] = useState(profile.locations.join(", "));
  const [keywords, setKeywords] = useState(profile.keywords.join(", "));
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const selectedResume = resumes.find((r) => r.id === draft.resumeId);

  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const p = parseProfile({ ...draft, roles: split(roles), skills: split(skills), locations: split(locations), keywords: split(keywords) });
      if (!p.roles.length && !p.skills.length && !p.resumeId) throw new Error("Add a target role, skills, or a resume to personalize your feed.");
      const response = await fetch("/api/jobs/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not save preferences.");
      onSave(body.profile);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save preferences."); }
    finally { setBusy(false); }
  }

  return <form onSubmit={save} className="mb-6 rounded-lg border border-border bg-surface p-5">
    <h2 className="text-lg font-semibold">Your career preferences</h2>
    <p className="mt-1 text-sm text-text-secondary">Start with a role or your existing resume. These preferences stay in JobTrackOS and are never sent to job providers.</p>
    <div className="mt-5 grid gap-4 sm:grid-cols-2">
      <label className="space-y-1 text-sm">Target roles <input className={inputClass} value={roles} onChange={(e) => setRoles(e.target.value)} maxLength={1000} placeholder="Data analyst, Business analyst" /><span className="text-xs text-text-muted">Separate multiple entries with commas.</span></label>
      <label className="space-y-1 text-sm">Skills <input className={inputClass} value={skills} onChange={(e) => setSkills(e.target.value)} maxLength={8000} placeholder="SQL, Excel, Python" /></label>
      <label className="space-y-1 text-sm">Years of experience <input className={inputClass} type="number" min="0" max="60" step="0.5" value={draft.yearsExperience ?? ""} onChange={(e) => setDraft({ ...draft, yearsExperience: e.target.value === "" ? null : Number(e.target.value) })} placeholder="Not specified" /></label>
      <label className="space-y-1 text-sm">Preferred locations <input className={inputClass} value={locations} onChange={(e) => setLocations(e.target.value)} maxLength={2000} placeholder="India, Bengaluru, EMEA" /></label>
      <fieldset className="sm:col-span-2"><legend className="mb-2 text-sm">Work mode <span className="text-text-muted">(leave blank for any)</span></legend><div className="flex flex-wrap gap-4">{(["Remote", "Hybrid", "On-site"] as WorkMode[]).map((mode) => <label key={mode} className="flex min-h-[44px] items-center gap-2 text-sm"><input type="checkbox" checked={draft.workModes.includes(mode)} onChange={(e) => setDraft({ ...draft, workModes: e.target.checked ? [...draft.workModes, mode] : draft.workModes.filter((m) => m !== mode) })} />{mode}</label>)}</div></fieldset>
      <label className="space-y-1 text-sm">Preferred annual salary (optional)<input className={inputClass} type="number" min="0" max="1000000000" value={draft.salaryMin ?? ""} onChange={(e) => setDraft({ ...draft, salaryMin: e.target.value === "" ? null : Number(e.target.value) })} /></label>
      <label className="space-y-1 text-sm">Salary currency<input className={inputClass} maxLength={3} placeholder="INR or USD" value={draft.salaryCurrency} onChange={(e) => setDraft({ ...draft, salaryCurrency: e.target.value.toUpperCase() })} /></label>
      <label className="space-y-1 text-sm">Existing resume<select className={inputClass} value={draft.resumeId ?? ""} onChange={(e) => setDraft({ ...draft, resumeId: e.target.value || null })}><option value="">No resume selected</option>{resumes.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
      <label className="space-y-1 text-sm">Additional keywords (optional)<input className={inputClass} maxLength={2000} value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="Open source, Fintech" /></label>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
      {selectedResume && <button type="button" className={buttonClass} onClick={() => { setSkills([...new Set([...split(skills), ...selectedResume.skills])].join(", ")); if (!roles.trim()) setRoles(selectedResume.roles.join(", ")); if (draft.yearsExperience === null) setDraft({ ...draft, yearsExperience: selectedResume.yearsExperience }); }}>Use evidence from this resume</button>}
      <Link className="text-accent hover:underline" href="/resumes">Upload or manage resumes</Link>
      <span className="text-xs text-text-muted">Resume evidence uses existing text and parses; no AI call.</span>
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
    <div className="mt-5 flex gap-3"><button type="submit" disabled={busy} className={primaryClass}>{busy ? "Saving…" : "Save preferences"}</button><button type="button" disabled={busy} className={buttonClass} onClick={onCancel}>Cancel</button></div>
  </form>;
}

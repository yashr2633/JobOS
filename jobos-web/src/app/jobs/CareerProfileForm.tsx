"use client";

import { useRef, useState } from "react";
import { parseProfile, prefillProfile, selectedResume as findResume, type InferredField } from "@/lib/jobs/profile";
import type { CareerProfile, ResumeEvidence, WorkMode } from "@/lib/jobs/types";
import DiscoveryResumePicker from "./DiscoveryResumePicker";

export const inputClass = "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent";
export const buttonClass = "min-h-[44px] rounded-md border border-border px-4 py-2 text-sm font-medium text-text hover:bg-surface-2 disabled:opacity-50 disabled:cursor-not-allowed";
export const primaryClass = "min-h-[44px] rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed";
const split = (s: string) => s.split(",").map((s) => s.trim()).filter(Boolean);

export default function CareerProfileForm({ profile, resumes, onResumesChange, onSave, onCancel }: {
  profile: CareerProfile; resumes: ResumeEvidence[];
  onResumesChange: (resumes: ResumeEvidence[]) => void;
  onSave: (profile: CareerProfile) => void; onCancel: () => void;
}) {
  const [draft, setDraft] = useState(profile);
  const [roles, setRoles] = useState(profile.roles.join(", "));
  const [skills, setSkills] = useState(profile.skills.join(", "));
  const [locations, setLocations] = useState(profile.locations.join(", "));
  const [keywords, setKeywords] = useState(profile.keywords.join(", "));
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false), [notice, setNotice] = useState<string | null>(null);
  const edited = useRef(new Set<InferredField>());
  const selectedResume = findResume(resumes, draft.resumeId);
  function buildProfile() {
    if (!selectedResume) return;
    const next = prefillProfile({ ...draft, roles: split(roles), skills: split(skills), locations: split(locations), keywords: split(keywords) }, selectedResume, [...edited.current]);
    setDraft(next); setRoles(next.roles.join(", ")); setSkills(next.skills.join(", ")); setLocations(next.locations.join(", ")); setKeywords(next.keywords.join(", "));
    setNotice("Supported empty fields filled. Your existing choices were kept. Review all suggestions before saving; blank fields need your input.");
  }

  async function save(e: React.FormEvent) {
    e.preventDefault(); if (uploading) return; setBusy(true); setError(null);
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

  return <form id="career-preferences" onSubmit={save} className="mb-6 rounded-xl bg-surface p-5 shadow-sm sm:p-6">
    <h2 className="text-lg font-semibold">Career preferences</h2>
    <p className="mt-1 text-sm text-text-secondary">Start with your resume, then choose where you want to go next.</p>
    <fieldset disabled={busy}>
    <div className="mt-5 rounded-lg bg-surface-2 p-4">
      <DiscoveryResumePicker resumes={resumes} value={draft.resumeId} onChange={(id) => { setDraft((current) => ({ ...current, resumeId: id })); setNotice(null); }} onResumesChange={onResumesChange} onBusyChange={setUploading} />
      <button type="button" disabled={!selectedResume || selectedResume.usable === false || uploading} className={`${primaryClass} mt-2`} onClick={buildProfile}>Use resume to build profile</button>
      <p className="mt-2 text-xs leading-5 text-text-muted">Uses existing resume evidence. Choosing a file never changes your preferences automatically.</p>
    </div>
    {notice && <p role="status" className="mt-3 text-sm text-text-secondary">{notice}</p>}
    <div className="mt-5 grid gap-4 sm:grid-cols-2">
      <label className="space-y-1 text-sm">Target roles <input className={inputClass} value={roles} onChange={(e) => { edited.current.add("roles"); setRoles(e.target.value); }} maxLength={1000} placeholder="Operations Analyst, Data Analyst" /><span className="text-xs text-text-muted">Your choices take priority. Separate roles with commas.</span></label>
      <label className="space-y-1 text-sm">Skills <input className={inputClass} value={skills} onChange={(e) => { edited.current.add("skills"); setSkills(e.target.value); }} maxLength={8000} placeholder="SQL, Excel, Python" /></label>
    </div>
    {!!selectedResume?.suggestedRoles?.length && <div className="mt-3"><p className="text-xs text-text-muted">Role ideas from your evidence · add only the ones you want</p><div className="mt-2 flex flex-wrap gap-2">{selectedResume.suggestedRoles.filter((r) => !split(roles).some((existing) => existing.toLowerCase() === r.toLowerCase())).map((r) => <button key={r} type="button" className="min-h-[36px] rounded-full bg-surface-2 px-3 text-xs text-text-secondary hover:text-accent" onClick={() => { edited.current.add("roles"); setRoles([...split(roles), r].join(", ")); }}>+ {r}</button>)}</div></div>}
    <details className="mt-5 border-t border-border pt-4"><summary className="min-h-[36px] cursor-pointer text-sm font-medium">Experience, location & optional preferences</summary><p className="mt-1 text-xs text-text-muted">Review prefilled values here. Work mode, salary and seniority are never assumed.</p><div className="mt-4 grid gap-4 sm:grid-cols-2">
      <label className="space-y-1 text-sm">Years of experience <input className={inputClass} type="number" min="0" max="60" step="0.5" value={draft.yearsExperience ?? ""} onChange={(e) => { edited.current.add("yearsExperience"); setDraft({ ...draft, yearsExperience: e.target.value === "" ? null : Number(e.target.value) }); }} placeholder="Not specified" /></label>
      <label className="space-y-1 text-sm">Preferred locations <input className={inputClass} value={locations} onChange={(e) => { edited.current.add("locations"); setLocations(e.target.value); }} maxLength={2000} placeholder="India, Bengaluru, EMEA" /></label>
      <fieldset className="sm:col-span-2"><legend className="mb-2 text-sm">Work mode <span className="text-text-muted">(leave blank for any)</span></legend><div className="flex flex-wrap gap-4">{(["Remote", "Hybrid", "On-site"] as WorkMode[]).map((mode) => <label key={mode} className="flex min-h-[44px] items-center gap-2 text-sm"><input type="checkbox" checked={draft.workModes.includes(mode)} onChange={(e) => setDraft({ ...draft, workModes: e.target.checked ? [...draft.workModes, mode] : draft.workModes.filter((m) => m !== mode) })} />{mode}</label>)}</div></fieldset>
      <label className="space-y-1 text-sm">Preferred annual salary (optional)<input className={inputClass} type="number" min="0" max="1000000000" value={draft.salaryMin ?? ""} onChange={(e) => setDraft({ ...draft, salaryMin: e.target.value === "" ? null : Number(e.target.value) })} /></label>
      <label className="space-y-1 text-sm">Salary currency<input className={inputClass} maxLength={3} placeholder="INR or USD" value={draft.salaryCurrency} onChange={(e) => setDraft({ ...draft, salaryCurrency: e.target.value.toUpperCase() })} /></label>
      <label className="space-y-1 text-sm sm:col-span-2">Relevant keywords (optional)<input className={inputClass} maxLength={2000} value={keywords} onChange={(e) => { edited.current.add("keywords"); setKeywords(e.target.value); }} placeholder="Operations, Reporting, Fintech" /></label>
    </div></details>
    </fieldset>
    {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
    <div className="mt-5 flex gap-3"><button type="submit" disabled={busy || uploading} className={primaryClass}>{busy ? "Saving…" : "Save & find jobs"}</button><button type="button" disabled={busy || uploading} className={buttonClass} onClick={onCancel}>Cancel</button></div>
  </form>;
}

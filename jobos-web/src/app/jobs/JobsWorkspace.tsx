"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Catalog } from "@/lib/jobs/providers";
import { scoreJob, roleAlignment } from "@/lib/jobs/matching";
import { safeJobUrl } from "@/lib/jobs/normalize";
import type { CareerProfile, JobState, ResumeEvidence } from "@/lib/jobs/types";
import CareerProfileForm, { buttonClass, inputClass, primaryClass } from "./CareerProfileForm";

const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const dateLabel = (date: string | null) => date ? new Date(date).toLocaleDateString("en-GB", { timeZone: "UTC" }) : "Not provided";

export default function JobsWorkspace({ profile: initialProfile, states: initialStates, resumes, catalog, initialJobId }: {
  profile: CareerProfile; states: JobState[]; resumes: ResumeEvidence[]; catalog: Catalog; initialJobId?: string;
}) {
  const router = useRouter();
  const [profile, setProfile] = useState(initialProfile);
  const [states, setStates] = useState(initialStates);
  const [editing, setEditing] = useState(!profile.roles.length && !profile.skills.length && !profile.resumeId);
  const [view, setView] = useState("recommended");
  const [query, setQuery] = useState(""), [role, setRole] = useState(""), [location, setLocation] = useState("");
  const [mode, setMode] = useState(""), [experience, setExperience] = useState(""), [posted, setPosted] = useState("");
  const [limit, setLimit] = useState(30);
  const [selected, setSelected] = useState<string | null>(initialJobId ?? null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [appliedDate, setAppliedDate] = useState(localDate);
  const dialog = useRef<HTMLDialogElement>(null);
  const stateMap = useMemo(() => new Map(states.map((s) => [s.job_id, s])), [states]);
  const allJobs = useMemo(() => {
    const map = new Map(states.map((s) => [s.job_id, s.snapshot]));
    for (const job of catalog.jobs) map.set(job.id, job);
    return map;
  }, [catalog.jobs, states]);
  const resume = useMemo(() => resumes.find((r) => r.id === profile.resumeId), [resumes, profile.resumeId]);
  const personalized = profile.roles.length > 0 || profile.skills.length > 0 || !!resume?.skills.length;
  const job = selected ? allJobs.get(selected) : undefined;
  const state = selected ? stateMap.get(selected) : undefined;
  const fit = job ? scoreJob(job, profile, resume) : null;
  const pending = states.filter((s) => s.apply_started_at && !s.application_id && !s.hidden);

  useEffect(() => {
    if (selected && dialog.current && !dialog.current.open) dialog.current.showModal();
    if (!selected) dialog.current?.close();
  }, [selected]);

  const ranked = useMemo(() => {
    const source = view === "recommended" ? catalog.jobs : [...allJobs.values()];
    return source.filter((job) => {
      const state = stateMap.get(job.id);
      if (view === "hidden") { if (!state?.hidden) return false; }
      else if (state?.hidden) return false;
      if (view === "saved" && !state?.saved) return false;
      if (view === "pending" && (!state?.apply_started_at || state.application_id)) return false;
      if (view === "recommended" && state?.application_id) return false;
      const text = `${job.company} ${job.title} ${job.description}`.toLowerCase();
      if (query && !text.includes(query.toLowerCase())) return false;
      if (role && roleAlignment(job.title, [role]) < 0.5) return false;
      if (location && !job.location.toLowerCase().includes(location.toLowerCase())) return false;
      if (mode && job.workMode !== mode) return false;
      if (experience === "unknown" && job.minYearsExperience !== null) return false;
      if (experience && experience !== "unknown" && (job.minYearsExperience === null || job.minYearsExperience > Number(experience))) return false;
      if (posted && (!job.postedAt || Date.parse(job.postedAt) < Date.parse(catalog.checkedAt) - Number(posted) * 86_400_000)) return false;
      return true;
    }).map((job) => ({ job, fit: scoreJob(job, profile, resume) }))
      .sort((a, b) => b.fit.score - a.fit.score || (b.job.postedAt ?? "").localeCompare(a.job.postedAt ?? "") || a.job.id.localeCompare(b.job.id));
  }, [view, catalog.jobs, catalog.checkedAt, allJobs, stateMap, profile, resume, query, role, location, mode, experience, posted]);

  async function act(jobId: string, action: string) {
    if (busy) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const response = await fetch("/api/jobs/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId, action, appliedDate }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not save the action.");
      if (data.state) setStates((previous) => [...previous.filter((s) => s.job_id !== jobId), data.state]);
      if (data.applicationId) {
        setStates((previous) => previous.map((s) => s.job_id === jobId ? { ...s, application_id: data.applicationId, saved: true } : s));
        setNotice("Application added to your existing tracker.");
        router.refresh();
      } else setNotice(action === "apply" ? "Context saved. Open the employer page below, then confirm when you have applied." : "Job preference saved.");
    } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong. Please retry."); }
    finally { setBusy(false); }
  }

  const messages = <>{error && <p role="alert" className="my-3 rounded-md bg-danger-bg p-3 text-sm text-danger">{error}</p>}{notice && <p role="status" className="my-3 text-sm text-success">{notice}</p>}</>;
  return <>
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight">Discover Jobs</h1><p className="mt-2 text-sm text-text-secondary">Relevant roles, clear fit, and your next application in one place.</p></div><button className={buttonClass} onClick={() => setEditing(!editing)}>Career preferences</button></div>
    {editing && <CareerProfileForm profile={profile} resumes={resumes} onCancel={() => setEditing(false)} onSave={(p) => { setProfile(p); setEditing(false); setNotice("Preferences saved. Your feed has been ranked again."); }} />}
    {!selected && messages}
    <p className="mb-4 text-xs leading-5 text-text-muted">V1 covers a limited set of public company boards via Greenhouse. Fit measures evidence and preferences, not hiring probability. Skill mentions may include optional skills. Remote jobs can have location restrictions.</p>
    {catalog.warnings.map((warning) => <p role="status" key={warning} className="mb-2 rounded-md border border-warning/30 p-3 text-sm text-text-secondary">{warning}</p>)}
    <div className="mb-4 flex flex-wrap gap-2" aria-label="Job views">{[["recommended", "Recommended"], ["saved", "Saved"], ["pending", `Did you apply? (${pending.length})`], ["hidden", "Hidden"]].map(([value, label]) => <button key={value} aria-pressed={view === value} className={view === value ? primaryClass : buttonClass} onClick={() => { setView(value); setLimit(30); }}>{label}</button>)}</div>
    <div className="mb-5 grid gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-3">
      <label className="text-xs text-text-secondary">Search<input className={inputClass} value={query} onChange={(e) => { setQuery(e.target.value); setLimit(30); }} placeholder="Title, company, keyword" /></label>
      <label className="text-xs text-text-secondary">Role<input className={inputClass} value={role} onChange={(e) => setRole(e.target.value)} placeholder="Any role" /></label>
      <label className="text-xs text-text-secondary">Location<input className={inputClass} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Any location" /></label>
      <label className="text-xs text-text-secondary">Work mode<select className={inputClass} value={mode} onChange={(e) => setMode(e.target.value)}><option value="">Any / not specified</option>{["Remote", "Hybrid", "On-site"].map((m) => <option key={m}>{m}</option>)}</select></label>
      <label className="text-xs text-text-secondary">Minimum experience requested<select className={inputClass} value={experience} onChange={(e) => setExperience(e.target.value)}><option value="">Any</option><option value="0">No prior experience stated</option><option value="2">Up to 2 years</option><option value="5">Up to 5 years</option><option value="10">Up to 10 years</option><option value="unknown">Not specified</option></select></label>
      <label className="text-xs text-text-secondary">Date posted<select className={inputClass} value={posted} onChange={(e) => setPosted(e.target.value)}><option value="">Any / not provided</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select></label>
      <button className="text-left text-sm text-accent hover:underline" onClick={() => { setQuery(""); setRole(""); setLocation(""); setMode(""); setExperience(""); setPosted(""); }}>Clear filters</button>
    </div>
    {!personalized && view === "recommended" ? <div className="rounded-lg border border-border p-6"><h2 className="font-semibold">Make this feed yours</h2><p className="mt-2 text-sm text-text-secondary">Add a target role or skills to rank the available jobs. A resume alone needs readable skill evidence.</p><button className={`${primaryClass} mt-4`} onClick={() => setEditing(true)}>Set career preferences</button></div> : <>
      <div className="mb-3 flex flex-wrap justify-between gap-2 text-xs text-text-muted"><span>{ranked.length} jobs · highest fit first</span><span>Source checked {dateLabel(catalog.checkedAt)} · cached up to 15 minutes</span></div>
      {!ranked.length && <p className="rounded-lg border border-border p-6 text-sm text-text-secondary">No jobs match this view. Try broader filters or update your preferences. We only show real listings from the available sources.</p>}
      <div className="grid gap-4 lg:grid-cols-2">{ranked.slice(0, limit).map(({ job, fit }) => <article key={job.id} className="min-w-0 rounded-lg border border-border bg-surface p-5">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs text-text-muted">{job.company} · {job.source}</p><h2 className="mt-1 break-words text-base font-semibold"><button className="text-left hover:text-accent" onClick={() => { setSelected(job.id); setError(null); setNotice(null); }}>{job.title}</button></h2></div><span className="shrink-0 rounded-md bg-surface-2 px-3 py-2 text-sm font-semibold">{fit.score} Fit</span></div>
        <p className="mt-2 text-sm text-text-secondary">{job.location || "Location not provided"} · {job.workMode ?? "Work mode not specified"}</p>
        <p className="mt-2 text-xs text-text-muted">Posted {dateLabel(job.postedAt)} · {fit.evidence} evidence</p>
        <p className="mt-3 text-sm text-text-secondary">{fit.strengths[0] ?? "Partial match based on the information available."}</p>
        <p className="mt-2 text-xs text-text-muted">{fit.matchedSkills.length ? `Matches: ${fit.matchedSkills.slice(0, 5).join(", ")}` : "No matching skill evidence yet"}</p>
        <div className="mt-4 flex flex-wrap gap-2"><button className={primaryClass} onClick={() => { setSelected(job.id); setError(null); setNotice(null); }}>View job</button><button disabled={busy} className={buttonClass} onClick={() => void act(job.id, stateMap.get(job.id)?.saved ? "unsave" : "save")}>{stateMap.get(job.id)?.saved ? "Unsave" : "Save job"}</button><button disabled={busy} className={buttonClass} onClick={() => void act(job.id, stateMap.get(job.id)?.hidden ? "restore" : "hide")}>{stateMap.get(job.id)?.hidden ? "Restore" : "Not interested"}</button></div>
      </article>)}</div>
      {ranked.length > limit && <button className={`${buttonClass} mt-5`} onClick={() => setLimit(limit + 30)}>Show more jobs</button>}
    </>}
    <dialog ref={dialog} aria-label="Job details" onCancel={(e) => { if (busy) e.preventDefault(); else setSelected(null); }} onClose={() => setSelected(null)} className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-3xl overflow-y-auto rounded-lg border border-border bg-surface p-0 text-text shadow-xl backdrop:bg-black/60">
      {job && fit ? <div className="p-5 sm:p-7">
        <div className="flex items-start justify-between gap-3"><div><p className="text-sm text-text-secondary">{job.company}</p><h2 className="mt-1 text-xl font-semibold">{job.title}</h2></div><button aria-label="Close job details" className={buttonClass} disabled={busy} onClick={() => setSelected(null)}>Close</button></div>
        <p className="mt-3 text-sm">{job.location || "Location not provided"} · {job.workMode ?? "Work mode not specified"}</p>
        <div className="mt-3 grid gap-2 text-sm text-text-secondary sm:grid-cols-2"><p>Experience: {job.minYearsExperience === null ? "Not specified" : `${job.minYearsExperience}+ years stated`}</p><p>Employment: {job.employmentType ?? "Not specified"}</p><p>Salary: {job.salary ? `${job.salary.currency} ${job.salary.min ?? "?"}–${job.salary.max ?? "?"}${job.salary.period ? ` / ${job.salary.period}` : " (period not provided)"}` : "Not provided"}</p><p>Posted: {dateLabel(job.postedAt)}</p></div>
        {!catalog.jobs.some((j) => j.id === job.id) && <p className="mt-3 text-sm text-warning">Saved snapshot: this job is not in the current feed. Availability is checked again when you apply.</p>}
        <section className="mt-5 rounded-md border border-border bg-surface-2 p-4"><h3 className="font-semibold">{fit.score}/100 Job Fit · {fit.evidence} evidence</h3><p className="mt-1 text-xs text-text-muted">Evidence-based alignment, not a hiring probability.</p><div className="mt-4 grid gap-4 sm:grid-cols-2"><div><h4 className="text-sm font-semibold">Why this job</h4><ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-text-secondary">{fit.strengths.map((s) => <li key={s}>{s}</li>)}</ul><p className="mt-2 text-sm">Matched skills: {fit.matchedSkills.join(", ") || "No evidence yet"}</p></div><div><h4 className="text-sm font-semibold">Key gaps / check before applying</h4><ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-text-secondary">{fit.gaps.map((s) => <li key={s}>{s}</li>)}</ul><p className="mt-2 text-sm">Not evidenced: {fit.missingSkills.join(", ") || "None among recognized mentions"}</p></div></div><details className="mt-4 text-xs text-text-muted"><summary className="cursor-pointer">How the score is calculated</summary><p className="mt-2">Available components are weighted and normalized to 100. Missing requirements are not assumed.</p>{fit.components.map((c) => <p key={c.label}>{c.label}: {Math.round(c.points)} / {c.available} weighted points</p>)}</details></section>
        {messages}
        <div className="mt-5 flex flex-wrap gap-2"><button disabled={busy} className={primaryClass} onClick={() => void act(job.id, "apply")}>{busy ? "Working…" : "Apply on employer site"}</button><Link className={buttonClass} href={`/resumes?job=${encodeURIComponent(job.id)}`}>Check Resume Match</Link><button disabled={busy} className={buttonClass} onClick={() => void act(job.id, state?.saved ? "unsave" : "save")}>{state?.saved ? "Unsave" : "Save job"}</button><button disabled={busy} className={buttonClass} onClick={() => void act(job.id, state?.hidden ? "restore" : "hide")}>{state?.hidden ? "Restore" : "Not interested"}</button></div>
        {state?.apply_started_at && !state.application_id && <section className="mt-4 rounded-md border border-accent/40 p-4"><h3 className="font-semibold">Did you apply?</h3><p className="mt-2 text-sm text-text-secondary">Opening the employer page does not submit an application. Your place is saved here if you return later.</p>{safeJobUrl(state.snapshot.applicationUrl) && <a href={safeJobUrl(state.snapshot.applicationUrl)!} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-sm font-semibold text-accent hover:underline">Open employer application ↗</a>}<div className="mt-4 flex flex-wrap items-end gap-3"><label className="text-sm">Date applied<input type="date" className={inputClass} value={appliedDate} max={localDate()} onChange={(e) => setAppliedDate(e.target.value)} /></label><button disabled={busy} className={primaryClass} onClick={() => void act(job.id, "confirm")}>Yes, I applied</button><button disabled={busy} className={buttonClass} onClick={() => void act(job.id, "dismiss")}>Not yet</button></div></section>}
        {state?.application_id && <p className="mt-4 text-sm text-success">Already in your tracker. <Link className="underline" href="/applications">View Applications</Link></p>}
        {job.requirements.length > 0 && <section className="mt-6"><h3 className="font-semibold">Requirement excerpts</h3><ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-text-secondary">{job.requirements.map((r, i) => <li key={i}>{r}</li>)}</ul></section>}
        <section className="mt-6"><h3 className="font-semibold">Full job description</h3><p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-text-secondary">{job.description || "See the employer's listing for the description."}</p></section>
        <p className="mt-6 text-xs text-text-muted">Source: {job.source} · Last checked {dateLabel(job.fetchedAt)} · {job.expiresAt ? `Deadline ${dateLabel(job.expiresAt)}` : "No deadline provided"}. Employer availability can change.</p><a className="mt-2 inline-block text-xs text-accent hover:underline" href={safeJobUrl(job.sourceUrl) ?? undefined} target="_blank" rel="noopener noreferrer">View source board ↗</a>
      </div> : <div className="p-6"><p>This job is no longer in the available feed or your saved jobs.</p><button className={`${buttonClass} mt-4`} onClick={() => setSelected(null)}>Close</button></div>}
    </dialog>
  </>;
}

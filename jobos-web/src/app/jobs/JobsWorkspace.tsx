"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Catalog } from "@/lib/jobs/providers";
import { scoreJob, roleAlignment } from "@/lib/jobs/matching";
import { safeJobUrl } from "@/lib/jobs/normalize";
import type { CareerProfile, JobState, ResumeEvidence } from "@/lib/jobs/types";
import CareerProfileForm, { buttonClass, inputClass, primaryClass } from "./CareerProfileForm";
import { DEFAULT_RANKING, rankJob, compareRanked, type RankingConfig } from "@/lib/jobs/ranking";
import { selectedResume } from "@/lib/jobs/profile";
import JobCard from "./JobCard";

const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const dateLabel = (date: string | null) => date ? new Date(date).toLocaleDateString("en-GB", { timeZone: "UTC" }) : "Not provided";

export default function JobsWorkspace({ profile: initialProfile, states: initialStates, resumes, catalog, initialJobId, ranking = DEFAULT_RANKING, asOf }: {
  profile: CareerProfile; states: JobState[]; resumes: ResumeEvidence[]; catalog: Catalog; initialJobId?: string;
  ranking?: RankingConfig; asOf?: string;
}) {
  const router = useRouter();
  const [profile, setProfile] = useState(initialProfile);
  const [states, setStates] = useState(initialStates);
  const [editing, setEditing] = useState(false);
  const [library, setLibrary] = useState(resumes);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const jobsStart = useRef<HTMLDivElement>(null), preferencesStart = useRef<HTMLDivElement>(null);
  const now = Date.parse(asOf ?? catalog.checkedAt);
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
  const resume = useMemo(() => selectedResume(library, profile.resumeId), [library, profile.resumeId]);
  const personalized = profile.roles.length > 0 || profile.skills.length > 0 || !!resume?.skills.length || !!resume?.suggestedRoles?.length;
  const discovering = view === "recommended" || view === "new";
  const job = selected ? allJobs.get(selected) : undefined;
  const state = selected ? stateMap.get(selected) : undefined;
  const fit = job ? scoreJob(job, profile, resume) : null;
  const pending = states.filter((s) => s.apply_started_at && !s.application_id && !s.hidden);

  useEffect(() => {
    if (selected && dialog.current && !dialog.current.open) dialog.current.showModal();
    if (!selected) dialog.current?.close();
  }, [selected]);

  useEffect(() => { if (editing) preferencesStart.current?.querySelector("select")?.focus(); }, [editing]);
  function returnToJobs() { setEditing(false); jobsStart.current?.focus(); jobsStart.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }

  const ranked = useMemo(() => {
    const source = discovering ? catalog.jobs : [...allJobs.values()];
    return source.filter((job) => {
      const state = stateMap.get(job.id);
      if (view === "hidden") { if (!state?.hidden) return false; }
      else if (state?.hidden) return false;
      if (view === "saved" && !state?.saved) return false;
      if (view === "pending" && (!state?.apply_started_at || state.application_id)) return false;
      if (discovering && (state?.application_id || unavailable.includes(job.id))) return false;
      const text = `${job.company} ${job.title} ${job.description}`.toLowerCase();
      if (query && !text.includes(query.toLowerCase())) return false;
      if (role && roleAlignment(job.title, [role]) < 0.5) return false;
      if (location && !job.location.toLowerCase().includes(location.toLowerCase())) return false;
      if (mode && job.workMode !== mode) return false;
      if (experience === "unknown" && job.minYearsExperience !== null) return false;
      if (experience && experience !== "unknown" && (job.minYearsExperience === null || job.minYearsExperience > Number(experience))) return false;
      if (posted && (!job.postedAt || Date.parse(job.postedAt) > now || Date.parse(job.postedAt) < now - Number(posted) * 86_400_000)) return false;
      return true;
    }).map((job) => rankJob(job, profile, resume, now, ranking))
      .filter((item) => !discovering || item.eligible)
      .sort((a, b) => compareRanked(a, b, view === "new"));
  }, [view, discovering, unavailable, catalog.jobs, allJobs, stateMap, profile, resume, query, role, location, mode, experience, posted, now, ranking]);

  async function act(jobId: string, action: string) {
    if (busy) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const response = await fetch("/api/jobs/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId, action, appliedDate }) });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 410 || data.code === "source_unavailable") setUnavailable((ids) => [...new Set([...ids, jobId])]);
        throw new Error(data.error ?? "Could not save the action.");
      }
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
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold tracking-tight">Discover Jobs</h1><p className="mt-1 text-sm text-text-secondary">Fresh opportunities that fit your next move.</p></div><button aria-expanded={editing} aria-controls="career-preferences" className={buttonClass} onClick={() => editing ? returnToJobs() : setEditing(true)}>Career preferences</button></div>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface px-4 py-3">
      <div className="min-w-0"><p className="truncate text-sm font-medium">{profile.roles.length ? profile.roles.slice(0, 3).join(" · ") : resume?.suggestedRoles?.join(" · ") || "Make discovery yours"}</p><p className="mt-1 truncate text-xs text-text-muted">{[profile.locations.join(", "), profile.workModes.join(" / "), resume?.fileName ?? resume?.label].filter(Boolean).join(" · ") || "Choose a resume or add your target role to get started."}</p></div>
      <button className="min-h-[44px] text-sm font-medium text-accent hover:underline" onClick={() => setEditing(true)}>{personalized ? "Edit preferences" : "Set up profile"}</button>
    </div>
    <div ref={preferencesStart}>{editing && <CareerProfileForm profile={profile} resumes={library} onResumesChange={setLibrary} onCancel={returnToJobs} onSave={(p) => { setProfile(p); setNotice("Preferences saved. Your matches are updated."); returnToJobs(); }} />}</div>
    {!selected && messages}
    {catalog.warnings.map((warning) => <p role="status" key={warning} className="mb-3 rounded-md bg-surface-2 p-3 text-sm text-text-secondary">{warning}</p>)}
    <div ref={jobsStart} tabIndex={-1} className="scroll-mt-5 outline-none">
      <div className="mb-5 flex gap-5 overflow-x-auto border-b border-border" aria-label="Job views">{[["recommended", "Best Matches"], ["new", "New"], ["saved", "Saved"], ["pending", "Did you apply? (" + pending.length + ")"], ["hidden", "Hidden"]].map(([value, label]) => <button key={value} aria-pressed={view === value} className={"min-h-[48px] shrink-0 whitespace-nowrap border-b-2 pb-3 pt-2 text-sm font-medium " + (view === value ? "border-accent text-accent" : "border-transparent text-text-muted hover:text-text")} onClick={() => { setView(value); setLimit(30); }}>{label}</button>)}</div>
    </div>
    <div className="mb-5 rounded-lg bg-surface p-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
        <label className="text-xs font-medium text-text-secondary">Search<input className={inputClass + " mt-1"} value={query} onChange={(e) => { setQuery(e.target.value); setLimit(30); }} placeholder="Job title, company or keyword" /></label>
        <label className="text-xs font-medium text-text-secondary">Date posted<select className={inputClass + " mt-1"} value={posted} onChange={(e) => setPosted(e.target.value)}><option value="">{discovering ? "Within " + ranking.maxAgeDays + " days" : "Any date"}</option><option value="1">Last 24 hours</option><option value="3">Last 3 days</option><option value="7">Last 7 days</option><option value="14">Last 14 days</option><option value="30">Last 30 days</option></select></label>
      </div>
      <details className="mt-3"><summary className="min-h-[32px] cursor-pointer text-xs font-medium text-text-secondary">More filters{[role, location, mode, experience].filter(Boolean).length ? " · " + [role, location, mode, experience].filter(Boolean).length + " active" : ""}</summary>
        <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs text-text-secondary">Role<input className={inputClass} value={role} onChange={(e) => setRole(e.target.value)} placeholder="Any role" /></label>
          <label className="text-xs text-text-secondary">Location<input className={inputClass} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Any location" /></label>
          <label className="text-xs text-text-secondary">Work mode<select className={inputClass} value={mode} onChange={(e) => setMode(e.target.value)}><option value="">Any / unspecified</option>{["Remote", "Hybrid", "On-site"].map((m) => <option key={m}>{m}</option>)}</select></label>
          <label className="text-xs text-text-secondary">Minimum experience requested<select className={inputClass} value={experience} onChange={(e) => setExperience(e.target.value)}><option value="">Any</option><option value="0">No experience required</option><option value="2">Up to 2 years</option><option value="5">Up to 5 years</option><option value="10">Up to 10 years</option><option value="unknown">Not specified</option></select></label>
        </div>
      </details>
      {[query, role, location, mode, experience, posted].some(Boolean) && <button className="mt-1 min-h-[36px] text-xs text-accent hover:underline" onClick={() => { setQuery(""); setRole(""); setLocation(""); setMode(""); setExperience(""); setPosted(""); setLimit(30); }}>Clear filters</button>}
    </div>
    {!personalized && discovering ? <div className="rounded-xl bg-surface p-8 text-center"><h2 className="text-lg font-semibold">Your next role starts here</h2><p className="mx-auto mt-2 max-w-md text-sm text-text-secondary">Choose a resume or add your skills and target role. We will show recent listings that clear your relevance threshold.</p><button className={primaryClass + " mt-5"} onClick={() => setEditing(true)}>Choose resume & preferences</button></div> : <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs text-text-muted"><span>{ranked.length} opportunities{discovering ? " · last " + ranking.maxAgeDays + " days · Fit " + ranking.minFit + "+" : ""}</span><button onClick={() => { setUnavailable([]); router.refresh(); }} className="min-h-[36px] text-accent hover:underline">Refresh listings</button></div>
      {discovering && <details className="mb-4 text-xs text-text-muted"><summary className="cursor-pointer">{view === "new" ? "Newest relevant listings first" : "Freshness first, then your match"}</summary><p className="mt-2 max-w-2xl leading-5">Best Matches prioritizes 0–7, 8–14, then 15–{ranking.maxAgeDays} days. Within each group, fit, role, skills, experience and location/work mode determine the order. New sorts qualifying jobs by posted date. Listings need recent source confirmation. Fit is alignment, never hiring probability.</p></details>}
      {!ranked.length && <div className="rounded-xl bg-surface p-7"><h2 className="font-semibold">{discovering ? "No fresh matches from these sources yet" : "No jobs in this view"}</h2><p className="mt-2 max-w-xl text-sm leading-6 text-text-secondary">{discovering ? "Try broader preferences or check back as employers publish new openings. Coverage is limited to the configured company boards; old or undated listings are not added to fill the page." : "Try clearing your filters. Saved jobs and unfinished applications stay here even after a listing leaves recommendations."}</p><button className="mt-3 min-h-[44px] text-sm text-accent hover:underline" onClick={() => setEditing(true)}>Review career preferences</button></div>}
      <div className="grid items-start gap-4 lg:grid-cols-2">{ranked.slice(0, limit).map((item) => <JobCard key={item.job.id} item={item} state={stateMap.get(item.job.id)} now={now} busy={busy} onView={() => { setSelected(item.job.id); setError(null); setNotice(null); }} onAction={(action) => void act(item.job.id, action)} />)}</div>
      {ranked.length > limit && <button className={buttonClass + " mt-5"} onClick={() => setLimit(limit + 30)}>Show more jobs</button>}
    </>}
    <p className="mt-5 text-xs leading-5 text-text-muted">Public employer listings via Greenhouse · checked {dateLabel(catalog.checkedAt)} · cached up to 15 minutes. Remote eligibility may be region-limited.</p>

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

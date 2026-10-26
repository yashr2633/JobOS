"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Catalog } from "@/lib/jobs/providers";
import { scoreJob } from "@/lib/jobs/matching";
import { safeJobUrl } from "@/lib/jobs/normalize";
import type { CareerProfile, Job, JobState, ResumeEvidence } from "@/lib/jobs/types";
import CareerProfileForm, { buttonClass, inputClass, primaryClass } from "./CareerProfileForm";
import { DEFAULT_RANKING, rankJob, compareRanked, isActiveRecommendation, type RankingConfig } from "@/lib/jobs/ranking";
import { selectedResume } from "@/lib/jobs/profile";
import JobCard from "./JobCard";
import { INDIAN_CITIES } from "@/lib/jobs/sources-india";
import { includeProfileMatch, matchesDateWindow, matchesIndiaLocation, matchesJobQuery } from "@/lib/jobs/browsing";

const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const dateLabel = (date: string | null) => date ? new Date(date).toLocaleDateString("en-GB", { timeZone: "UTC" }) : "Not provided";

export default function JobsWorkspace({ profile: initialProfile, states: initialStates, resumes, catalog, initialJobId, initialQuery = "", ranking = DEFAULT_RANKING, asOf }: {
  profile: CareerProfile; states: JobState[]; resumes: ResumeEvidence[]; catalog: Catalog; initialJobId?: string;
  ranking?: RankingConfig; asOf?: string; initialQuery?: string;
}) {
  const router = useRouter();
  const [profile, setProfile] = useState(initialProfile);
  const [states, setStates] = useState(initialStates);
  const [editing, setEditing] = useState(false);
  const [library, setLibrary] = useState(resumes);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const jobsStart = useRef<HTMLDivElement>(null), preferencesStart = useRef<HTMLDivElement>(null);
  const [clock, setClock] = useState(() => Date.parse(asOf ?? catalog.checkedAt));
  const now = asOf ? Date.parse(asOf) : clock;
  const [view, setView] = useState("latest");
  const [details, setDetails] = useState<Record<string, Job>>({});
  const [detailError, setDetailError] = useState<string | null>(null);
  const [query, setQuery] = useState(initialQuery.slice(0, 200)), [location, setLocation] = useState("India");
  const [mode, setMode] = useState(""), [experience, setExperience] = useState(""), [posted, setPosted] = useState("30");
  const [company, setCompany] = useState("");
  const [category, setCategory] = useState(""), [employment, setEmployment] = useState("");
  const [limit, setLimit] = useState(30);
  const [selected, setSelected] = useState<string | null>(initialJobId ?? null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [appliedDate, setAppliedDate] = useState(localDate);
  const dialog = useRef<HTMLDialogElement>(null);
  const stateMap = useMemo(() => new Map(states.map((s) => [s.job_id, s])), [states]);
  const allJobs = useMemo(() => {
    const map = new Map(states.map((s) => [s.job_id, s.snapshot]));
    for (const job of catalog.jobs) map.set(job.id, details[job.id] ?? job);
    return map;
  }, [catalog.jobs, states, details]);
  const resume = useMemo(() => selectedResume(library, profile.resumeId), [library, profile.resumeId]);
  const personalized = profile.roles.length > 0 || profile.skills.length > 0 || !!resume?.skills.length || !!resume?.suggestedRoles?.length;
  const discovering = view === "for-you" || view === "latest";
  const defaultPosted = discovering ? "30" : "";
  const job = selected ? details[selected] ?? allJobs.get(selected) : undefined;
  const state = selected ? stateMap.get(selected) : undefined;
  const fit = job ? scoreJob(job, profile, resume) : null;
  const pending = states.filter((s) => s.apply_started_at && !s.application_id && !s.hidden);

  useEffect(() => {
    if (asOf) return;
    const timer = setInterval(() => setClock(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [asOf]);

  useEffect(() => {
    if (selected && dialog.current && !dialog.current.open) dialog.current.showModal();
    if (!selected) dialog.current?.close();
  }, [selected]);

  useEffect(() => {
    if (!selected || !allJobs.get(selected)?.descriptionPending || details[selected]) return;
    const controller = new AbortController();
    void fetch(`/api/jobs/detail?id=${encodeURIComponent(selected)}`, { signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (response.status === 410 && !controller.signal.aborted) setUnavailable(ids => [...new Set([...ids, selected])]);
        if (!response.ok) throw new Error(data.error ?? "Could not load job details.");
        if (!controller.signal.aborted) setDetails(previous => ({ ...previous, [selected]: data.job }));
      }).catch(error => { if (!controller.signal.aborted) setDetailError(error instanceof Error ? error.message : "Could not load job details."); });
    return () => controller.abort();
  }, [selected, allJobs, details]);

  useEffect(() => { if (editing) preferencesStart.current?.querySelector("select")?.focus(); }, [editing]);
  function returnToJobs() { setEditing(false); jobsStart.current?.focus(); jobsStart.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }

  const ranked = useMemo(() => {
    const source = discovering ? catalog.jobs.map(job => details[job.id] ?? job) : [...allJobs.values()];
    return source.filter((job) => {
      const state = stateMap.get(job.id);
      if (discovering && !isActiveRecommendation(job, now, ranking)) return false;
      if (view === "hidden") { if (!state?.hidden) return false; }
      else if (state?.hidden) return false;
      if (view === "saved" && !state?.saved) return false;
      if (view === "pending" && (!state?.apply_started_at || state.application_id)) return false;
      if (discovering && (state?.application_id || unavailable.includes(job.id))) return false;
      
      // HARD India location filtering - exclude foreign-only jobs
      if (discovering && !matchesIndiaLocation(job, location)) return false;
      
      if (!matchesJobQuery(job, query)) return false;
      
      if (company && !job.company.toLowerCase().includes(company.toLowerCase())) return false;
      if (category && job.category !== category) return false;
      if (employment && job.employmentType !== employment) return false;
      if (!discovering && location !== "India" && !matchesIndiaLocation(job, location)) return false;
      if (mode && job.workMode !== mode) return false;
      if (experience === "unknown" && job.minYearsExperience !== null) return false;
      if (experience && experience !== "unknown" && (job.minYearsExperience === null || job.minYearsExperience > Number(experience))) return false;
      if (!matchesDateWindow(job, posted, now)) return false;
      return true;
    }).map((job) => rankJob(job, profile, resume, now, ranking))
      .filter((item) => includeProfileMatch(item, view, query, personalized))
      .sort((a, b) => compareRanked(a, b, view === "latest"));
  }, [view, discovering, unavailable, catalog.jobs, allJobs, details, stateMap, profile, resume, query, location, mode, experience, posted, company, category, employment, personalized, now, ranking]);

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
    <div className="mb-7 flex flex-wrap items-start justify-between gap-3"><div><p className="product-kicker">Find jobs</p><h1 className="text-2xl font-semibold tracking-tight">Find your next opportunity in India</h1><p className="mt-2 text-sm text-text-secondary">Showing the last 30 days by default. Choose For You for resume-based recommendations.</p></div><button aria-expanded={editing} aria-controls="career-preferences" className={buttonClass} onClick={() => editing ? returnToJobs() : setEditing(true)}>Edit search preferences</button></div>
    
    {!personalized && <div className="mb-5 rounded-lg bg-surface px-4 py-3 border border-accent/20"><p className="text-sm"><span className="font-medium">Get personalized recommendations:</span> <button className="text-accent hover:underline" onClick={() => setEditing(true)}>Upload or select a resume</button> to see job fit scores and matched skills</p></div>}
    
    {personalized && <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface px-4 py-3">
      <div className="min-w-0"><p className="truncate text-sm font-medium">{profile.roles.length ? profile.roles.slice(0, 3).join(" · ") : resume?.suggestedRoles?.join(" · ") || "Personalized recommendations enabled"}</p><p className="mt-1 truncate text-xs text-text-muted">{[profile.locations.join(", "), profile.workModes.join(" / "), resume?.fileName ?? resume?.label].filter(Boolean).join(" · ")}</p></div>
      <button className="min-h-[44px] text-sm font-medium text-accent hover:underline" onClick={() => setEditing(true)}>Edit</button>
    </div>}
    
    <div ref={preferencesStart}>{editing && <CareerProfileForm profile={profile} resumes={library} onResumesChange={setLibrary} onCancel={returnToJobs} onSave={(p) => { setProfile(p); setNotice("Preferences saved. Your matches are updated."); returnToJobs(); }} />}</div>
    {!selected && messages}
    {catalog.warnings.map((warning) => <p role="status" key={warning} className="mb-3 rounded-md bg-surface-2 p-3 text-sm text-text-secondary">{warning}</p>)}
    <div ref={jobsStart} tabIndex={-1} className="scroll-mt-5 outline-none">
      <div className="mb-5 flex gap-5 overflow-x-auto border-b border-border" aria-label="Job views">{[["latest", "All jobs · Latest"], ["for-you", "For You"], ["saved", "Saved"], ["pending", `Did you apply? (${pending.length})`], ["hidden", "Hidden"]].map(([value, label]) => <button key={value} aria-pressed={view === value} className={"min-h-[48px] shrink-0 whitespace-nowrap border-b-2 pb-3 pt-2 text-sm font-medium " + (view === value ? "border-accent text-accent" : "border-transparent text-text-muted hover:text-text")} onClick={() => { const browsing = value === "latest" || value === "for-you"; if (browsing !== discovering) setPosted(browsing ? "30" : ""); setView(value); setLimit(30); }}>{label}</button>)}</div>
    </div>
    <div className="mb-5 rounded-lg bg-surface p-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
        <label className="text-xs font-medium text-text-secondary">Search job title, skill, or company<input className={inputClass + " mt-1"} value={query} onChange={(e) => { setQuery(e.target.value); setLimit(30); }} placeholder="e.g. Data Analyst, Python, Deloitte" /></label>
        <label className="text-xs font-medium text-text-secondary">City or region in India<input list="india-job-locations" className={inputClass + " mt-1"} value={location} onChange={(e) => { setLocation(e.target.value); setLimit(30); }} placeholder="India or any city" /><datalist id="india-job-locations">{["India", ...INDIAN_CITIES].map(c => <option key={c} value={c} />)}</datalist></label>
      </div>
      <details className="mt-3"><summary className="min-h-[32px] cursor-pointer text-xs font-medium text-text-secondary">More filters{[company, category, employment, mode, experience, posted].filter(Boolean).length ? ` · ${[company, category, employment, mode, experience, posted].filter(Boolean).length} active` : ""}</summary>
        <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs text-text-secondary">Company<input className={inputClass} value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Any company" /></label>
          <label className="text-xs text-text-secondary">Category<select className={inputClass} value={category} onChange={e => { setCategory(e.target.value); setLimit(30); }}><option value="">Any category</option>{[...new Set(catalog.jobs.map(job => job.category).filter((value): value is string => !!value))].sort().map(value => <option key={value}>{value}</option>)}</select></label>
          <label className="text-xs text-text-secondary">Employment type<select className={inputClass} value={employment} onChange={e => { setEmployment(e.target.value); setLimit(30); }}><option value="">Any type</option>{[...new Set(catalog.jobs.map(job => job.employmentType).filter((value): value is string => !!value))].sort().map(value => <option key={value}>{value}</option>)}</select></label>
          <label className="text-xs text-text-secondary">Work mode<select className={inputClass} value={mode} onChange={(e) => setMode(e.target.value)}><option value="">Any</option>{["Remote", "Hybrid", "On-site"].map((m) => <option key={m}>{m}</option>)}</select></label>
          <label className="text-xs text-text-secondary">Experience<select className={inputClass} value={experience} onChange={(e) => setExperience(e.target.value)}><option value="">Any</option><option value="0">Fresher / 0 years</option><option value="2">Up to 2 years</option><option value="5">Up to 5 years</option><option value="10">Up to 10 years</option><option value="unknown">Not specified</option></select></label>
          <label className="text-xs text-text-secondary">Posted or source released<select className={inputClass} value={posted} onChange={(e) => { setPosted(e.target.value); setLimit(30); }}><option value="">All source-listed jobs</option><option value="1">Last 24 hours</option><option value="3">Last 3 days</option><option value="7">Last 7 days</option><option value="14">Last 14 days</option><option value="30">Last 30 days</option><option value="90">Last 3 months</option><option value="180">Last 6 months</option></select></label>
        </div>
      </details>
      {(experience || mode || category || employment) && <p className="mt-2 text-xs leading-5 text-text-muted">Filters use employer-supplied details. Missing experience, work mode or category is not assumed; open a job to check its full requirements.</p>}
      {[query, location !== "India", company, category, employment, mode, experience, posted !== defaultPosted].some(Boolean) && <button className="mt-1 min-h-[36px] text-xs text-accent hover:underline" onClick={() => { setQuery(""); setLocation("India"); setCompany(""); setCategory(""); setEmployment(""); setMode(""); setExperience(""); setPosted(defaultPosted); setLimit(30); }}>Reset filters</button>}
    </div>
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs text-text-muted"><span>{ranked.length} jobs found</span><button onClick={() => { setUnavailable([]); router.refresh(); }} className="min-h-[36px] text-accent hover:underline">Refresh</button></div>
      {!ranked.length && <div className="rounded-xl bg-surface p-7"><h2 className="font-semibold">No jobs match your search</h2><p className="mt-2 max-w-xl text-sm leading-6 text-text-secondary">Try adjusting your filters or search terms. New jobs are added as companies publish openings.</p></div>}
      <div className="grid items-start gap-4 lg:grid-cols-2">{ranked.slice(0, limit).map((item) => <JobCard key={item.job.id} item={item} state={stateMap.get(item.job.id)} now={now} busy={busy} hasResume={!!resume} onView={() => { setSelected(item.job.id); setDetailError(null); setError(null); setNotice(null); }} onAction={(action) => void act(item.job.id, action)} />)}</div>
      {ranked.length > limit && <button className={buttonClass + " mt-5"} onClick={() => setLimit(limit + 30)}>Show more jobs</button>}
    </>
    <p className="mt-5 text-xs leading-5 text-text-muted">{catalog.jobs.length} India listings in this feed · Sources: {[...new Set(catalog.jobs.map(job => job.source))].join(", ")} · Last check {new Date(catalog.checkedAt).toLocaleString("en-IN")}. Coverage is limited to connected employers. Source release dates can include republications; original posting dates are shown only when supplied.</p>
    {!!catalog.sources?.length && <details className="mt-2 text-xs text-text-muted"><summary className="cursor-pointer py-2">Source availability</summary><ul className="space-y-2">{catalog.sources.map(source => <li key={`${source.provider}:${source.board}`}>{source.board} · {source.provider} · {source.status === "ok" ? "Source responded" : "Unavailable; excluded from results"} · Checked {new Date(source.checkedAt).toLocaleString("en-IN")}</li>)}</ul></details>}

    <dialog ref={dialog} aria-label="Job details" onCancel={(e) => { if (busy) e.preventDefault(); else setSelected(null); }} onClose={() => setSelected(null)} className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-3xl overflow-y-auto rounded-lg border border-border bg-surface p-0 text-text shadow-xl backdrop:bg-black/60">
      {job && fit ? <div className="p-5 sm:p-7">
        <div className="flex items-start justify-between gap-3"><div><p className="text-sm text-text-secondary">{job.company}</p><h2 className="mt-1 text-xl font-semibold">{job.title}</h2></div><button aria-label="Close job details" className={buttonClass} disabled={busy} onClick={() => setSelected(null)}>Close</button></div>
        <p className="mt-3 text-sm">{job.location || "Location not provided"} · {job.workMode ?? "Work mode not specified"}</p>
        <div className="mt-3 grid gap-2 text-sm text-text-secondary sm:grid-cols-2"><p>Experience: {job.minYearsExperience === null ? "Not specified" : `${job.minYearsExperience}+ years`}</p><p>Employment: {job.employmentType ?? "Not specified"}</p><p>Salary: {job.salary ? `${job.salary.currency} ${job.salary.min ?? "?"}–${job.salary.max ?? "?"}` : "Not provided"}</p><p>Posted: {dateLabel(job.postedAt)}</p></div>
        {!catalog.jobs.some((j) => j.id === job.id) && <p className="mt-3 text-sm text-warning">Saved snapshot: this job is not in the current feed.</p>}
        {job.releasedAt && <p className="mt-2 text-xs text-text-muted">Source released: {dateLabel(job.releasedAt)}. May be a republication; original posting date unavailable.</p>}
        {resume && !job.descriptionPending && <section className="mt-5 rounded-md border border-border bg-surface-2 p-4"><h3 className="font-semibold">Job Fit: {fit.score}/100 · {fit.evidence} evidence</h3><p className="mt-1 text-xs text-text-muted">Match score based on your resume, not hiring probability.</p><div className="mt-4 grid gap-4 sm:grid-cols-2"><div><h4 className="text-sm font-semibold">Strengths</h4><ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-text-secondary">{fit.strengths.map((s) => <li key={s}>{s}</li>)}</ul><p className="mt-2 text-sm">Matched: {fit.matchedSkills.join(", ") || "No skills matched"}</p></div><div><h4 className="text-sm font-semibold">Gaps</h4><ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-text-secondary">{fit.gaps.map((s) => <li key={s}>{s}</li>)}</ul><p className="mt-2 text-sm">Not evidenced in resume: {fit.missingSkills.join(", ") || "None"}</p></div></div></section>}
        {!resume && <div className="mt-5 rounded-md border border-accent/20 bg-accent/5 p-4"><p className="text-sm"><span className="font-medium">Want to check your fit for this role?</span> <button className="text-accent hover:underline" onClick={() => { setSelected(null); setEditing(true); }}>Select a resume</button> to see match score, skills alignment, and gaps.</p></div>}
        {messages}
        <div className="mt-5 flex flex-wrap gap-2"><button disabled={busy} className={primaryClass} onClick={() => void act(job.id, "apply")}>{busy ? "Working…" : "Apply on employer site"}</button>{personalized && <Link className={buttonClass} href={`/resumes?job=${encodeURIComponent(job.id)}`}>Check Resume Match</Link>}<button disabled={busy} className={buttonClass} onClick={() => void act(job.id, state?.saved ? "unsave" : "save")}>{state?.saved ? "Unsave" : "Save"}</button><button disabled={busy} className={buttonClass} onClick={() => void act(job.id, state?.hidden ? "restore" : "hide")}>{state?.hidden ? "Restore" : "Not interested"}</button></div>
        {state?.apply_started_at && !state.application_id && <section className="mt-4 rounded-md border border-accent/40 p-4"><h3 className="font-semibold">Did you apply?</h3><p className="mt-2 text-sm text-text-secondary">Opening the employer page does not submit an application. Confirm when done.</p>{safeJobUrl(state.snapshot.applicationUrl) && <a href={safeJobUrl(state.snapshot.applicationUrl)!} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-sm font-semibold text-accent hover:underline">Open employer application ↗</a>}<div className="mt-4 flex flex-wrap items-end gap-3"><label className="text-sm">Date applied<input type="date" className={inputClass} value={appliedDate} max={localDate()} onChange={(e) => setAppliedDate(e.target.value)} /></label><button disabled={busy} className={primaryClass} onClick={() => void act(job.id, "confirm")}>Yes, I applied</button><button disabled={busy} className={buttonClass} onClick={() => void act(job.id, "dismiss")}>Not yet</button></div></section>}
        {state?.application_id && <p className="mt-4 text-sm text-success">Already in your tracker. <Link className="underline" href="/applications">View Applications</Link></p>}
        <section className="mt-5"><h3 className="text-sm font-semibold mb-2">Job Description</h3>{job.descriptionPending ? <p role="status" className="text-sm text-text-secondary">{detailError ?? "Loading full requirements from the employer…"} <a href={job.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-accent underline">Original listing ↗</a></p> : <div className="text-sm text-text-secondary whitespace-pre-wrap max-h-[400px] overflow-y-auto">{job.description}</div>}</section>
      </div> : null}
    </dialog>
  </>;
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { CareerIntent } from "@/lib/jobs/careerIntent";
import { careerSearchUrl } from "@/lib/jobs/careerIntent";
import type { CareerProfile, Job, ResumeEvidence } from "@/lib/jobs/types";
import { deduplicateJobs, safeJobUrl } from "@/lib/jobs/normalize";
import { scoreJob } from "@/lib/jobs/matching";
import { readJobJson } from "@/lib/jobs/response";
import { locationMatches, resolveLocation } from "@/lib/jobs/locations";
import { verificationTime } from "@/lib/jobs/browsing";
import ResumeFitScore from "@/app/jobs/ResumeFitScore";
import { educationCheck, postingLabel } from "@/lib/jobs/resultPresentation";
import { findCompany } from "@/lib/jobs/companies";
import { orderLoadedAssistantJobs } from "@/lib/jobs/assistantOrdering";

const button = "inline-flex min-h-[44px] items-center justify-center rounded-md border border-border-strong px-3 py-2 text-sm font-medium text-accent hover:bg-accent/5 disabled:opacity-50";
type Page = { jobs: Job[]; nextOffset: number | null; total: number; warnings: string[]; related?: { location: string; jobs: Job[] } | null; error?: string };
const validJob = (job: Job) => !!job && typeof job.id === "string" && typeof job.title === "string" && typeof job.company === "string" && typeof job.location === "string" && typeof job.description === "string" && Array.isArray(job.skills) && Array.isArray(job.requirements) && Number.isFinite(Date.parse(job.fetchedAt)) && safeJobUrl(job.applicationUrl) && safeJobUrl(job.sourceUrl);
function validPage(value: Page): boolean {
  return Array.isArray(value.jobs) && value.jobs.length <= 9 && value.jobs.every(validJob)
    && (!value.related || typeof value.related.location === "string" && Array.isArray(value.related.jobs) && value.related.jobs.length <= 3 && value.related.jobs.every(validJob))
    && (value.nextOffset === null || Number.isInteger(value.nextOffset) && value.nextOffset > 0) && Number.isInteger(value.total) && value.total >= 0 && Array.isArray(value.warnings) && value.warnings.every(text => typeof text === "string");
}
export default function AssistantJobResults({ intent, profile, resume, refreshKey, onLocationChange }: { intent: CareerIntent; profile: CareerProfile; resume?: ResumeEvidence; refreshKey: number; onLocationChange?: (location: string) => void }) {
  const [jobs, setJobs] = useState<Job[]>([]), [visible, setVisible] = useState(3), [nextOffset, setNextOffset] = useState<number | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [warnings, setWarnings] = useState<string[]>([]);
  const [related, setRelated] = useState<Page["related"]>(null);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Job | null>(null), [detail, setDetail] = useState<Job | null>(null), [detailError, setDetailError] = useState<string | null>(null), [detailBusy, setDetailBusy] = useState(false);
  const pending = useRef<AbortController | null>(null), dialog = useRef<HTMLDialogElement>(null), detailTrigger = useRef<HTMLButtonElement | null>(null);
  const load = useCallback(async (offset = 0) => {
    pending.current?.abort(); const controller = new AbortController(); pending.current = controller;
    const timer = setTimeout(() => controller.abort("timeout"), 38000);
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/jobs/assistant-results", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intent, offset }), signal: controller.signal });
      const data = await readJobJson<Page>(response, "Job feeds could not respond. Retry here; public-source search is separate.");
      if (!response.ok || !validPage(data)) throw new Error(data.error ?? "Job feeds returned an incomplete response. Please retry.");
      if (!controller.signal.aborted) { setJobs(existing => offset ? deduplicateJobs([...existing, ...data.jobs]) : data.jobs); setNextOffset(data.nextOffset); setTotal(data.total); setWarnings(data.warnings); setRelated(data.related ?? null); if (offset) setVisible(count => count + 6); }
    } catch (failure) {
      if (!controller.signal.aborted || controller.signal.reason === "timeout") setError(failure instanceof Error && !controller.signal.aborted ? failure.message : "Job feeds took too long. Try again; public-source results can still appear below.");
    } finally { clearTimeout(timer); if (pending.current === controller) { pending.current = null; setBusy(false); } }
  }, [intent]);
  useEffect(() => {
    const timer = setTimeout(() => { setJobs([]); setVisible(9); setNextOffset(null); setTotal(0); setWarnings([]); setRelated(null); void load(); }, 0);
    return () => { clearTimeout(timer); pending.current?.abort(); };
  }, [load, refreshKey]);
  useEffect(() => {
    // Refresh public feeds while this conversation is visible. This is not an
    // unattended global crawler and does not trigger paid web searches.
    const timer = setInterval(() => { if (document.visibilityState === "visible" && !dialog.current?.open && !pending.current) void load(); }, 300000);
    return () => clearInterval(timer);
  }, [load]);
  useEffect(() => {
    if (!selected) return;
    dialog.current?.showModal();
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 22000);
    void (async () => {
      try {
        const response = await fetch(`/api/jobs/detail?id=${encodeURIComponent(selected.id)}&source=${encodeURIComponent(selected.sourceUrl)}`, { signal: controller.signal });
        const data = await readJobJson<{ job?: Job; error?: string }>(response, "The original source could not be rechecked. Please retry.");
        if (!response.ok || !data.job || !safeJobUrl(data.job.applicationUrl)) throw new Error(data.error ?? "The full job description could not load.");
        if (!controller.signal.aborted) setDetail(data.job);
      } catch (failure) { if (!controller.signal.aborted) setDetailError(failure instanceof Error ? failure.message : "The source could not be rechecked."); else if (controller.signal.reason?.name === "AbortError") setDetailError("The source took too long to respond. Close and reopen this job to retry."); }
      finally { clearTimeout(timer); if (controller.signal.reason !== "cancelled") setDetailBusy(false); }
    })();
    return () => { clearTimeout(timer); controller.abort("cancelled"); };
  }, [selected]);
  const fit = useMemo(() => detail && resume?.usable !== false && resume ? scoreJob(detail, profile, resume) : null, [detail, profile, resume]);
  const orderedJobs = useMemo(() => orderLoadedAssistantJobs(jobs, profile, resume, intent.location), [jobs, profile, resume, intent.location]);
  function close() { dialog.current?.close(); setSelected(null); detailTrigger.current?.focus(); }
  function card(job: Job) {
      const ready = resume && resume.usable !== false && !job.descriptionPending, match = ready ? scoreJob(job, profile, resume) : null;
      return <article key={job.id} className="min-w-0 rounded-lg border border-border bg-surface p-4">
        <p className="mb-2 text-xs font-semibold text-accent">{job.remoteIndiaEligible && job.workMode === "Remote" ? "Remote · open to candidates in India" : locationMatches(job.location, intent.location) ? "Requested location" : "Regional alternative · " + job.location}</p>
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><h3 className="text-base font-semibold leading-6">{job.title}</h3><p className="mt-1 text-sm text-text-secondary">{job.company} · {job.location}{job.workMode ? " · " + job.workMode : ""}</p><p className="mt-1 text-xs leading-5 text-text-muted">{job.minYearsExperience === null ? "Experience not stated — check requirements" : job.minYearsExperience === 0 ? "Entry level" : `${job.minYearsExperience}+ years requested`}{job.employmentType ? ` · ${job.employmentType}` : ""}</p></div><button type="button" className={button} onClick={event => { detailTrigger.current = event.currentTarget; setDetail(null); setDetailError(null); setDetailBusy(true); setSelected(job); }}>View &amp; apply ↗</button></div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3"><a href={job.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-accent underline">{job.source} · original source ↗</a><span className="text-xs text-text-muted">{job.postedAt ? `Posted ${job.postedAt.slice(0, 10)}` : job.releasedAt ? `Source released ${job.releasedAt.slice(0, 10)}` : "Posting date not supplied"}</span></div>
        <p className="mt-2 text-xs text-text-muted">Source checked {verificationTime(job.fetchedAt)} · recheck before applying</p>
        {match ? <div className="mt-3 rounded-md bg-accent/10 px-3 py-2 text-sm"><strong className="text-accent">{match.score}% resume match</strong><span className="ml-2 text-xs text-text-secondary">{match.evidence} evidence · open strengths &amp; gaps</span></div> : resume && <p className="mt-2 text-xs font-medium text-accent">Open full requirements to assess resume match →</p>}
      </article>;
  }
  function resultTable(items: Job[]) {
    return <div className="assistant-results-table"><table><caption className="sr-only">Job opportunities, education requirements, resume fit and direct application links</caption><thead><tr>{["Role & company", "Location", "Education check", "Resume match", "Posted / source date", "Apply"].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{items.map(job => {
      const match = resume && resume.usable !== false && !job.descriptionPending ? scoreJob(job, profile, resume) : null;
      const education = educationCheck(job, resume), posted = postingLabel(job);
      return <tr key={job.id}>
        <td data-label="Role & company"><strong className="block text-sm leading-6">{job.title}</strong><span className="mt-1 block text-sm text-text-secondary">{job.company}</span><span className="mt-2 block text-xs text-text-secondary">{job.minYearsExperience === null ? "Experience not stated" : job.minYearsExperience === 0 ? "Entry level" : `${job.minYearsExperience}+ years requested`}{job.employmentType ? ` · ${job.employmentType}` : ""}</span></td>
        <td data-label="Location"><span className="text-sm">{job.location}</span><span className="mt-1 block text-xs text-text-secondary">{job.remoteIndiaEligible && job.workMode === "Remote" ? "Remote · India eligible" : job.workMode ?? "Work mode not supplied"}</span></td>
        <td data-label="Education check"><span className="text-xs font-semibold">{education.label}</span><span className="mt-1 block text-xs leading-5 text-text-secondary">{education.note}</span>{education.resume && <span className="mt-2 block text-xs text-accent">Resume: {education.resume}</span>}</td>
        <td data-label="Resume match">{match ? <><span className="inline-flex items-baseline gap-1 rounded-md bg-accent/10 px-2 py-1 font-semibold text-accent"><span className="text-2xl tabular-nums">{match.score}</span><span className="text-xs">/100</span></span><span className="mt-1 block text-xs text-text-secondary">{match.evidence} evidence</span></> : <span className="text-xs text-text-secondary">{resume ? "Full JD needed" : "Add resume to match"}</span>}<button type="button" className="mt-2 block min-h-[44px] text-left text-xs font-medium text-accent underline underline-offset-2" onClick={event => { detailTrigger.current = event.currentTarget; setDetail(null); setDetailError(null); setDetailBusy(true); setSelected(job); }}>Strengths & gaps</button></td>
        <td data-label="Posted / source date"><span className="text-xs font-medium">{posted.date}</span><span className="mt-1 block text-xs leading-5 text-text-secondary">{posted.label}</span></td>
        <td data-label="Apply"><a href={job.applicationUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-accent px-3 py-2 text-sm font-semibold text-accent-fg hover:bg-accent-hover">Apply ↗</a><a href={job.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-2 block text-xs text-accent underline">{job.source} · source ↗</a><button type="button" className="mt-1 min-h-[44px] text-left text-xs font-medium text-accent" onClick={event => { detailTrigger.current = event.currentTarget; setDetail(null); setDetailError(null); setDetailBusy(true); setSelected(job); }}>View full job</button><span className="mt-1 block text-xs leading-5 text-text-muted">Checked {verificationTime(job.fetchedAt)}</span></td>
      </tr>;
    })}</tbody></table></div>;
  }
  const state = resolveLocation(intent.location)?.state;
  const employer = intent.company ? findCompany(intent.company) : null;
  return <section aria-label="Matching employer listings" className="min-w-0">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-base font-semibold">Jobs matched to your search · {intent.location}</h2>{!!jobs.length && <p className="mt-1 text-xs text-text-secondary">Showing {Math.min(visible, jobs.length)} of {total} matching source listings{busy ? " · refreshing…" : ""}</p>}</div><Link href={careerSearchUrl(intent, resume?.id)} className="min-h-[36px] py-2 text-xs font-medium text-accent">All filters ↗</Link></div>
    {busy && !jobs.length && <p role="status" className="rounded-md bg-surface-2 p-4 text-sm text-text-secondary">Checking connected employer listings and additional feeds…</p>}
    {warnings.length > 0 && <details className="mb-3 text-xs leading-5 text-text-secondary"><summary className="cursor-pointer py-2">Source freshness and coverage notes</summary>{warnings.map(text => <p key={text} className="mt-2">{text}</p>)}</details>}
    {!busy && !error && !!jobs.length && !jobs.some(job => locationMatches(job.location, intent.location)) && intent.location !== "India" && <p className="mb-3 rounded-md border border-border bg-surface-2 p-3 text-sm leading-6 text-text-secondary">No exact-location listings were returned by these feeds. These remote roles explicitly accept candidates in India.</p>}
    {!!jobs.length && resume?.usable !== false && resume && <p className="mb-3 text-xs leading-5 text-text-secondary">Loaded results are ordered by resume fit within the requested location. Jobs needing a full description are shown afterwards.</p>}
    {!!jobs.length && resultTable(orderedJobs.slice(0, visible))}
    {!!jobs.length && <p className="mt-3 text-xs leading-5 text-text-secondary">Match /100 compares resume and profile evidence with the job. It is not a hiring probability or an employer ATS score. Opening Apply does not submit an application.</p>}
    {error && <div role="alert" className="mt-3 rounded-md border border-warning/30 bg-warning-bg p-4 text-sm text-warning"><p>{error}</p><button type="button" className={button + " mt-3 bg-surface"} disabled={busy} onClick={() => void load(jobs.length ? nextOffset ?? 0 : 0)}>Retry employer listings</button></div>}
    {!busy && !error && !jobs.length && <div className="rounded-md border border-border-strong bg-surface-2 p-4 text-sm leading-6"><p>No matching listings were returned by the connected feeds for these filters. This is not proof that no jobs exist.</p>{employer && !employer.connected && <p className="mt-2 text-text-secondary">{employer.name} is not currently connected to the job feed.{employer.careerUrl && <> <a className="font-medium text-accent underline" href={employer.careerUrl} target="_blank" rel="noopener noreferrer">Open its official careers page ↗</a></>}</p>}<p className="mt-2 text-xs text-text-secondary">Additional public-source research has its own availability and quota. Use All filters to change the date window or review jobs with unknown original posting dates.</p></div>}
    {(visible < jobs.length || nextOffset !== null) && <button type="button" className={button + " mt-4 w-full"} disabled={busy} onClick={() => visible < jobs.length ? setVisible(count => count + 6) : void load(nextOffset!)}>{busy ? "Loading more jobs…" : "Show more jobs ↓"}</button>}
    {!!related?.jobs.length && <section aria-label="Regional alternatives" className="mt-5 border-t border-border pt-4"><h3 className="text-sm font-semibold">Other locations in {related.location}</h3><p className="mb-3 mt-1 text-xs leading-5 text-text-secondary">Same role and experience filters. These jobs are outside your requested city; check travel or relocation requirements.</p><div className="grid gap-3">{related.jobs.map(card)}</div></section>}
    {!busy && !error && onLocationChange && intent.location !== "India" && <div className="mt-4 flex flex-wrap gap-2">{state && <button type="button" className={button} onClick={() => onLocationChange(state)}>Search all {state} →</button>}<button type="button" className={button} onClick={() => onLocationChange("India")}>Search across India →</button></div>}
    {!!jobs.length && <p className="mt-2 text-xs leading-5 text-text-muted">Source-listed opportunities. Review eligibility and availability on the original page before applying.</p>}
    <dialog ref={dialog} onCancel={event => { event.preventDefault(); close(); }} onClose={() => setSelected(null)} aria-labelledby="assistant-job-title" className="m-auto max-h-[88dvh] w-[calc(100%_-_24px)] max-w-3xl overflow-y-auto rounded-xl border border-border bg-surface p-5 text-text backdrop:bg-text/40 sm:p-7">
      {selected && <><div className="flex items-start justify-between gap-4"><div><p className="text-sm text-text-secondary">{selected.company}</p><h2 id="assistant-job-title" className="mt-1 text-xl font-semibold">{selected.title}</h2><p className="mt-2 text-sm text-text-secondary">{selected.location}</p></div><button type="button" className={button} onClick={close}>Close</button></div>
      {detailBusy && <p role="status" className="my-5 text-sm text-text-secondary">Rechecking the original listing and full requirements…</p>}
      {detailError && <p role="alert" className="my-5 rounded-md bg-warning-bg p-4 text-sm text-warning">{detailError} No current availability or match is confirmed.</p>}
      {detail && <><div className="my-5 whitespace-pre-wrap text-sm leading-7 text-text-secondary">{detail.description || "The source did not supply a full description. Review its original page."}</div>
      {fit && <section className="my-5 rounded-lg border border-border p-4"><ResumeFitScore score={fit.score} evidence={fit.evidence} /><p className="mt-4 text-sm"><strong>Matching skills: </strong>{fit.matchedSkills.join(", ") || "No matching skill evidence yet"}</p><p className="mt-2 text-sm"><strong>Not evidenced in your resume/profile: </strong>{fit.missingSkills.join(", ") || "No additional skill gaps detected from the available text"}</p>{fit.gaps.map(gap => <p key={gap} className="mt-2 text-xs leading-5 text-text-secondary">{gap}</p>)}</section>}
      <div className="flex flex-wrap gap-3"><a className="product-button product-button-primary" href={detail.applicationUrl} target="_blank" rel="noopener noreferrer">Apply on original site ↗</a><Link className={button} href={`/resumes?job=${encodeURIComponent(detail.id)}${detail.source === "Himalayas" ? `&jobSource=${encodeURIComponent(detail.sourceUrl)}` : ""}`}>Resume Match, tailor &amp; export →</Link><Link className={button} href={careerSearchUrl(intent, resume?.id) + `&job=${encodeURIComponent(detail.id)}&jobSource=${encodeURIComponent(detail.sourceUrl)}`}>Save or confirm application →</Link></div><p className="mt-3 text-xs leading-5 text-text-muted">Opening the source does not submit an application. Confirm your completed application in Find Jobs to add it to your tracker.</p></>}
      </>}
    </dialog>
  </section>;
}

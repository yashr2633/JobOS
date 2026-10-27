"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { CareerIntent } from "@/lib/jobs/careerIntent";
import { careerSearchUrl } from "@/lib/jobs/careerIntent";
import type { CareerProfile, Job, ResumeEvidence } from "@/lib/jobs/types";
import { deduplicateJobs, safeJobUrl } from "@/lib/jobs/normalize";
import { scoreJob } from "@/lib/jobs/matching";
import { readJobJson } from "@/lib/jobs/response";
import ResumeFitScore from "@/app/jobs/ResumeFitScore";

const button = "inline-flex min-h-[44px] items-center justify-center rounded-md border border-border-strong px-3 py-2 text-sm font-medium text-accent hover:bg-accent/5 disabled:opacity-50";
type Page = { jobs: Job[]; nextOffset: number | null; total: number; warnings: string[]; error?: string };
function validPage(value: Page): boolean {
  return Array.isArray(value.jobs) && value.jobs.length <= 9 && value.jobs.every(job => typeof job.id === "string" && typeof job.title === "string" && typeof job.company === "string" && typeof job.location === "string" && typeof job.description === "string" && Array.isArray(job.skills) && Array.isArray(job.requirements) && Number.isFinite(Date.parse(job.fetchedAt)) && safeJobUrl(job.applicationUrl) && safeJobUrl(job.sourceUrl))
    && (value.nextOffset === null || Number.isInteger(value.nextOffset) && value.nextOffset > 0) && Number.isInteger(value.total) && value.total >= 0 && Array.isArray(value.warnings) && value.warnings.every(text => typeof text === "string");
}
export default function AssistantJobResults({ intent, profile, resume, refreshKey }: { intent: CareerIntent; profile: CareerProfile; resume?: ResumeEvidence; refreshKey: number }) {
  const [jobs, setJobs] = useState<Job[]>([]), [visible, setVisible] = useState(3), [nextOffset, setNextOffset] = useState<number | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [warnings, setWarnings] = useState<string[]>([]);
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
      if (!controller.signal.aborted) { setJobs(existing => offset ? deduplicateJobs([...existing, ...data.jobs]) : data.jobs); setNextOffset(data.nextOffset); setWarnings(data.warnings); if (offset) setVisible(count => count + 6); }
    } catch (failure) {
      if (!controller.signal.aborted || controller.signal.reason === "timeout") setError(failure instanceof Error && !controller.signal.aborted ? failure.message : "Job feeds took too long. Try again; public-source results can still appear below.");
    } finally { clearTimeout(timer); if (pending.current === controller) { pending.current = null; setBusy(false); } }
  }, [intent]);
  useEffect(() => {
    const timer = setTimeout(() => { setJobs([]); setVisible(3); setNextOffset(null); setWarnings([]); void load(); }, 0);
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
  function close() { dialog.current?.close(); setSelected(null); detailTrigger.current?.focus(); }
  return <section aria-label="Matching employer listings" className="min-w-0">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="text-base font-semibold">{intent.experience === "entry" ? "Entry-level opportunities" : "Job opportunities"} · {intent.location}</h2><Link href={careerSearchUrl(intent, resume?.id)} className="min-h-[36px] py-2 text-xs font-medium text-accent">All filters ↗</Link></div>
    {busy && !jobs.length && <p role="status" className="rounded-md bg-surface-2 p-4 text-sm text-text-secondary">Checking connected employer listings and additional feeds…</p>}
    {warnings.map(text => <p key={text} className="mb-3 text-xs leading-5 text-warning">{text}</p>)}
    <div className="grid gap-3">{jobs.slice(0, visible).map(job => {
      const ready = resume && resume.usable !== false && !job.descriptionPending, match = ready ? scoreJob(job, profile, resume) : null;
      return <article key={job.id} className="min-w-0 rounded-lg border border-border bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><h3 className="text-base font-semibold leading-6">{job.title}</h3><p className="mt-1 text-sm text-text-secondary">{job.company} · {job.location}{job.workMode ? " · " + job.workMode : ""}</p><p className="mt-1 text-xs leading-5 text-text-muted">{job.minYearsExperience === null ? "Experience not stated — check requirements" : job.minYearsExperience === 0 ? "Entry level" : `${job.minYearsExperience}+ years requested`}{job.employmentType ? ` · ${job.employmentType}` : ""}</p></div><button type="button" className={button} onClick={event => { detailTrigger.current = event.currentTarget; setDetail(null); setDetailError(null); setDetailBusy(true); setSelected(job); }}>View &amp; apply ↗</button></div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3"><a href={job.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-accent underline">{job.source} · original source ↗</a><span className="text-xs text-text-muted">{job.postedAt ? `Posted ${job.postedAt.slice(0, 10)}` : job.releasedAt ? `Source released ${job.releasedAt.slice(0, 10)}` : "Posting date not supplied"}</span></div>
        {match ? <div className="mt-3 rounded-md bg-accent/10 px-3 py-2 text-sm"><strong className="text-accent">{match.score}% resume match</strong><span className="ml-2 text-xs text-text-secondary">{match.evidence} evidence · open strengths &amp; gaps</span></div> : resume && <p className="mt-2 text-xs font-medium text-accent">Open full requirements to assess resume match →</p>}
      </article>;
    })}</div>
    {error && <div role="alert" className="mt-3 rounded-md border border-warning/30 bg-warning-bg p-4 text-sm text-warning"><p>{error}</p><button type="button" className={button + " mt-3 bg-surface"} disabled={busy} onClick={() => void load(jobs.length ? nextOffset ?? 0 : 0)}>Retry employer listings</button></div>}
    {!busy && !error && !jobs.length && <p className="rounded-md border border-border bg-surface-2 p-4 text-sm leading-6 text-text-secondary">No matching jobs were returned by the connected feeds. The assistant is also checking public sources below. This does not mean there are no jobs in this location.</p>}
    {(visible < jobs.length || nextOffset !== null) && <button type="button" className={button + " mt-4 w-full"} disabled={busy} onClick={() => visible < jobs.length ? setVisible(count => count + 6) : void load(nextOffset!)}>{busy ? "Loading more jobs…" : "Show more jobs ↓"}</button>}
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

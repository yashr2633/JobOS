"use client";

import type { RankedJob } from "@/lib/jobs/ranking";
import { ageDays } from "@/lib/jobs/ranking";
import type { JobState } from "@/lib/jobs/types";
import ResumeFitScore from "./ResumeFitScore";

export default function JobCard({ item, state, now, busy, hasResume, onView, onAction }: {
  item: RankedJob; state?: JobState; now: number; busy: boolean; hasResume: boolean;
  onView: () => void; onAction: (action: string) => void;
}) {
  const { job, fit, badges } = item;
  const age = ageDays(job, now);
  const releaseAge = job.releasedAt ? (now - Date.parse(job.releasedAt)) / 86_400_000 : null;
  const posted = age === null ? job.releasedAt ? `Source released ${new Date(job.releasedAt).toLocaleDateString("en-GB", { timeZone: "UTC" })}` : job.updatedAt ? `Source updated ${new Date(job.updatedAt).toLocaleDateString("en-GB", { timeZone: "UTC" })}` : "Posted date unavailable" : age < 1 ? "Posted today" : `Posted ${Math.floor(age)}d ago`;
  const gap = fit.missingSkills.length ? `Check: ${fit.missingSkills.slice(0, 2).join(", ")}` : fit.gaps.find((g) => /differs|below|requested|eligibility/.test(g));
  return <article className="min-w-0 rounded-xl bg-surface p-5 shadow-sm ring-1 ring-border/50 transition-shadow hover:shadow-md">
    <div className="flex items-center justify-between gap-3"><p className="truncate text-xs font-medium text-text-secondary">{job.company}</p><span className="shrink-0 text-xs text-text-muted">{posted}</span></div>
    <h2 className="mt-2 text-base font-semibold leading-snug tracking-tight"><button className="text-left hover:text-accent" onClick={onView}>{job.title}</button></h2>
    <p className="mt-2 truncate text-sm text-text-secondary" title={job.location}>{job.location || "Location unspecified"}{job.workMode ? ` · ${job.workMode}` : ""}</p>
    {job.descriptionPending ? <button onClick={onView} className="mt-4 w-full rounded-lg border border-accent/20 bg-accent/5 px-3 py-3 text-left text-sm font-medium text-accent">Check your resume fit <span aria-hidden="true">→</span><span className="mt-1 block text-xs font-normal text-text-secondary">Open full requirements, matching skills and gaps.</span></button> : hasResume ? <ResumeFitScore score={fit.score} evidence={fit.evidence} compact /> : <p className="mt-4 text-xs text-text-muted">Select a resume to compare your fit.</p>}
    <p className="mt-2 text-xs text-text-muted">Source checked {new Date(job.fetchedAt).toLocaleDateString("en-GB", { timeZone: "UTC" })}{(age !== null && age > 30) || (releaseAge !== null && releaseAge > 30) ? " · Older listing, still listed on source" : ""}</p>
    {job.source === "Himalayas" && <p className="mt-2 text-xs leading-5 text-text-secondary"><a href={job.sourceUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-accent underline">Source: Himalayas ↗</a> · Daily feed · Original posting date unavailable</p>}
    {!!badges.length && <div className="mt-2 flex flex-wrap gap-1.5">{badges.filter(badge => (hasResume && !job.descriptionPending) || badge !== "Strong fit").map((badge) => <span key={badge} className="rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-text-secondary">{badge}</span>)}</div>}
    {hasResume && !job.descriptionPending && <p className="mt-3 truncate text-xs text-text-secondary" title={fit.matchedSkills.join(", ")}>{fit.matchedSkills.length ? fit.matchedSkills.slice(0, 4).join(" · ") : "No matching skill evidence yet"}</p>}
    {hasResume && !job.descriptionPending && gap && <p className="mt-1 truncate text-xs text-text-muted" title={gap}>{gap}</p>}
    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 pt-3">
      <button className="min-h-[44px] rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover" onClick={onView}>View job <span aria-hidden="true">↗</span></button>
      <button disabled={busy} className="min-h-[44px] text-sm font-medium text-text-secondary hover:text-accent disabled:opacity-50" onClick={() => onAction(state?.saved ? "unsave" : "save")}>{state?.saved ? "Saved · remove" : "Save"}</button>
      <button disabled={busy} className="min-h-[44px] text-xs text-text-muted hover:text-text disabled:opacity-50" onClick={() => onAction(state?.hidden ? "restore" : "hide")}>{state?.hidden ? "Restore" : "Not interested"}</button>
    </div>
  </article>;
}

"use client";

import type { RankedJob } from "@/lib/jobs/ranking";
import { ageDays } from "@/lib/jobs/ranking";
import type { JobState } from "@/lib/jobs/types";

export default function JobCard({ item, state, now, busy, onView, onAction }: {
  item: RankedJob; state?: JobState; now: number; busy: boolean;
  onView: () => void; onAction: (action: string) => void;
}) {
  const { job, fit, badges } = item;
  const age = ageDays(job, now);
  const posted = age === null ? "Posted date unavailable" : age < 1 ? "Posted today" : `Posted ${Math.floor(age)}d ago`;
  const gap = fit.missingSkills.length ? `Check: ${fit.missingSkills.slice(0, 2).join(", ")}` : fit.gaps.find((g) => /differs|below|requested|eligibility/.test(g));
  return <article className="min-w-0 rounded-xl bg-surface p-5 shadow-sm ring-1 ring-border/50 transition-shadow hover:shadow-md">
    <div className="flex items-center justify-between gap-3"><p className="truncate text-xs font-medium text-text-secondary">{job.company}</p><span className="shrink-0 text-xs text-text-muted">{posted}</span></div>
    <h2 className="mt-2 text-base font-semibold leading-snug tracking-tight"><button className="text-left hover:text-accent" onClick={onView}>{job.title}</button></h2>
    <p className="mt-2 truncate text-sm text-text-secondary" title={job.location}>{job.location || "Location unspecified"}{job.workMode ? ` · ${job.workMode}` : ""}</p>
    <div className="mt-4 flex items-center gap-3"><span className="text-lg font-semibold tabular-nums">{fit.score}<span className="ml-1 text-xs font-normal text-text-muted">/100 Fit</span></span><span className="text-xs text-text-muted">{fit.evidence} evidence</span></div>
    {!!badges.length && <div className="mt-2 flex flex-wrap gap-1.5">{badges.map((badge) => <span key={badge} className="rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-text-secondary">{badge}</span>)}</div>}
    <p className="mt-3 truncate text-xs text-text-secondary" title={fit.matchedSkills.join(", ")}>{fit.matchedSkills.length ? fit.matchedSkills.slice(0, 4).join(" · ") : "No matching skill evidence yet"}</p>
    {gap && <p className="mt-1 truncate text-xs text-text-muted" title={gap}>{gap}</p>}
    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 pt-3">
      <button className="min-h-[44px] rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover" onClick={onView}>View job <span aria-hidden="true">↗</span></button>
      <button disabled={busy} className="min-h-[44px] text-sm font-medium text-text-secondary hover:text-accent disabled:opacity-50" onClick={() => onAction(state?.saved ? "unsave" : "save")}>{state?.saved ? "Saved · remove" : "Save"}</button>
      <button disabled={busy} className="min-h-[44px] text-xs text-text-muted hover:text-text disabled:opacity-50" onClick={() => onAction(state?.hidden ? "restore" : "hide")}>{state?.hidden ? "Restore" : "Not interested"}</button>
    </div>
  </article>;
}

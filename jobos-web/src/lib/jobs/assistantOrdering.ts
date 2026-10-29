import { scoreJob } from "./matching.ts";
import { locationMatches } from "./locations.ts";
import type { CareerProfile, Job, ResumeEvidence } from "./types.ts";

/** Order only the loaded records. Never imply a global search-wide fit rank. */
export function orderLoadedAssistantJobs(jobs: Job[], profile: CareerProfile, resume: ResumeEvidence | undefined, location: string): Job[] {
  if (!resume || resume.usable === false) return jobs;
  return jobs.map((job, index) => ({ job, index,
    local: location === "India" ? 0 : Number(locationMatches(job.location, location)),
    score: job.descriptionPending ? -1 : scoreJob(job, profile, resume).score,
  })).sort((a, b) => b.local - a.local || b.score - a.score || a.index - b.index).map(item => item.job);
}

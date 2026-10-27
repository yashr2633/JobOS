import type { Job, ResumeEvidence } from "./types.ts";

/** Education evidence is separate from a numerical skills fit; never infer eligibility. */
export function educationCheck(job: Job, resume?: ResumeEvidence) {
  if (job.descriptionPending) return { label: "Open full requirements", note: "Education has not been assessed" };
  const text = job.requirements.join("\n") + "\n" + job.description;
  const requirement = text.match(/[^\n.!?]*(?:\bbachelor\b|\bmaster[’']?s?\s+(?:degree|of|in)\b|\b(?:doctorate|phd|graduation|graduates?|undergraduate|postgraduate|btech|bba|bcom|mba)\b|\b(?:academic|university|college)\s+degree|\bdegree\s+(?:in|from))[^\n.!?]*/i)?.[0]?.trim();
  if (!requirement) return { label: "Not stated clearly", note: "Review the original job description" };
  return { label: "Check degree requirement", note: requirement.slice(0, 170), resume: resume?.education?.join(" · ") };
}

export function postingLabel(job: Pick<Job, "postedAt" | "releasedAt" | "updatedAt">) {
  const date = job.postedAt ?? job.releasedAt ?? job.updatedAt;
  return { date: date?.slice(0, 10) ?? "Not supplied", label: job.postedAt ? "Original posted date" : job.releasedAt ? "Source release · not original posting" : job.updatedAt ? "Source update · not original posting" : "Original posting date unknown" };
}

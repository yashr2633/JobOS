import type { Job } from "./types.ts";
// Employer ATS checks keep their existing strict window. Himalayas publishes
// a daily snapshot; keep that separate, visibly labelled, and recheck on Apply.
export function sourceCheckWindow(job: Pick<Job, "source" | "board">, employerWindow = 20 * 60_000) {
  return job.source === "Himalayas" && job.board === "india" ? 24 * 60 * 60_000 : employerWindow;
}

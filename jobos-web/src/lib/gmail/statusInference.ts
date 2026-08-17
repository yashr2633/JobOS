/**
 * Map Gmail evidence onto the EXISTING application statuses.
 *
 * The authoritative status vocabulary is the applications table CHECK
 * constraint: Applied | Interview | Offer | Rejected | Ghosted. This module
 * introduces no new statuses and no parallel status system.
 *
 * Two invariants matter most:
 *  1. `Ghosted` is DERIVED from the absence of activity. It is never produced
 *     by classifying a message, and the AI can never assign it.
 *  2. Status only ever advances by evidence recency, so processing an old
 *     confirmation email after a newer offer cannot downgrade the application.
 *
 * Pure functions: no network, no AI, no database.
 */

import type { EmailCategory } from "./heuristics.ts";

/** The five statuses already allowed by the applications table. */
export type ApplicationStatusValue =
  | "Applied"
  | "Interview"
  | "Offer"
  | "Rejected"
  | "Ghosted";

/** Statuses a single email can imply. Excludes the derived-only Ghosted. */
export type InferredStatus = Exclude<ApplicationStatusValue, "Ghosted">;

/**
 * Days of silence after which an application is considered ghosted.
 *
 * Named constant so the policy can be tuned without hunting through logic.
 */
export const GHOSTED_THRESHOLD_DAYS = 30;

/**
 * Category → status. Categories absent from this map are activity-only: they
 * are recorded on the timeline but must not move the application's status.
 *
 * `INTERVIEW_INVITATION` deliberately covers BOTH conversational interview
 * invitations and assessment invitations — online assessments, coding
 * challenges, and take-home exercises tied to an application. The Evidence Gate
 * classifies both shapes into that one category, so both resolve to `Interview`
 * here.
 *
 * That is a decision, not an accident. An `ASSESSMENT` category would require
 * altering the `gmail_activity.category` CHECK constraint and an `Assessment`
 * status would require altering the `applications.status` CHECK constraint;
 * both are frozen. `Interview` is also the correct pipeline stage: an
 * assessment invitation means the employer is actively evaluating the
 * candidate. The forensic distinction survives on the activity row's evidence
 * reason code, not in the status vocabulary.
 */
const CATEGORY_STATUS: Partial<Record<EmailCategory, InferredStatus>> = {
  APPLICATION_CONFIRMATION: "Applied",
  APPLICATION_RECEIVED: "Applied",
  /** Interview, screening call, AND assessment invitations. See above. */
  INTERVIEW_INVITATION: "Interview",
  INTERVIEW_UPDATE: "Interview",
  OFFER: "Offer",
  REJECTION: "Rejected",
  // Deliberately unmapped (activity only):
  //   APPLICATION_UPDATE, RECRUITER_CONTACT, FOLLOW_UP, OTHER_JOB_RELATED,
  //   WITHDRAWAL (V1), NOT_JOB_RELATED
};

/** The status a single email implies, or null when it implies none. */
export function inferStatusFromCategory(
  category: EmailCategory
): InferredStatus | null {
  return CATEGORY_STATUS[category] ?? null;
}

/** True when this category should appear on the activity timeline. */
export function isJobRelated(category: EmailCategory): boolean {
  return category !== "NOT_JOB_RELATED";
}

/**
 * Progress ranking used to resolve same-day conflicts.
 *
 * Rejected and Offer are both terminal and rank highest: once an outcome is
 * known, an earlier-stage email must not pull the status backwards.
 */
const STATUS_RANK: Record<ApplicationStatusValue, number> = {
  Ghosted: 0,
  Applied: 1,
  Interview: 2,
  Offer: 3,
  Rejected: 3,
};

export interface StatusEvidence {
  category: EmailCategory;
  /** ISO timestamp. Evidence without a date cannot be ordered and is ignored. */
  emailDate: string | null;
}

/**
 * Resolve the current status from all evidence for one application.
 *
 * Evidence is ordered by `emailDate`, and the most recent status-bearing email
 * wins. When two land on the same timestamp, the higher-ranked (further along)
 * status wins, so a same-moment confirmation cannot override a rejection.
 *
 * Returns null when no evidence implies a status at all.
 */
export function resolveStatus(
  evidence: StatusEvidence[]
): InferredStatus | null {
  const dated = evidence
    .map((item) => ({
      status: inferStatusFromCategory(item.category),
      time: item.emailDate ? Date.parse(item.emailDate) : Number.NaN,
    }))
    .filter(
      (item): item is { status: InferredStatus; time: number } =>
        item.status !== null && Number.isFinite(item.time)
    );

  if (dated.length === 0) return null;

  // Latest evidence wins; ties broken by how far along the status is.
  dated.sort((a, b) =>
    a.time !== b.time
      ? a.time - b.time
      : STATUS_RANK[a.status] - STATUS_RANK[b.status]
  );

  return dated[dated.length - 1].status;
}

/**
 * Should a stored status be replaced by newly resolved evidence?
 *
 * Guards the monotonicity invariant: a *newer* email may move the status in any
 * direction (a rejection can follow an interview), but evidence that is not
 * newer than what produced the current status must never change it.
 */
export function shouldUpdateStatus(args: {
  currentStatus: ApplicationStatusValue | null;
  currentStatusAt: string | null;
  nextStatus: InferredStatus;
  nextStatusAt: string | null;
}): boolean {
  const { currentStatus, currentStatusAt, nextStatus, nextStatusAt } = args;

  if (!currentStatus) return true;
  if (currentStatus === nextStatus) return false;

  // Ghosted is derived, so any real evidence supersedes it.
  if (currentStatus === "Ghosted") return true;

  const nextTime = nextStatusAt ? Date.parse(nextStatusAt) : Number.NaN;
  const currentTime = currentStatusAt ? Date.parse(currentStatusAt) : Number.NaN;

  // Undated evidence can never override a dated status.
  if (!Number.isFinite(nextTime)) return false;
  // No timestamp on the current status: accept the dated evidence.
  if (!Number.isFinite(currentTime)) return true;

  return nextTime > currentTime;
}

export interface GhostedInput {
  status: ApplicationStatusValue;
  /** Most recent meaningful inbound activity, or the applied date. */
  lastActivityAt: string | null;
  /** True when any interview/offer/rejection evidence exists. */
  hasOutcomeEvidence: boolean;
}

/**
 * Derive whether an application counts as ghosted right now.
 *
 * Strictly: still `Applied`, no interview/offer/rejection evidence, and no
 * meaningful inbound activity for at least the threshold. Because this is
 * recomputed from current evidence, a late reply automatically clears it.
 */
export function isGhosted(
  input: GhostedInput,
  now: number = Date.now(),
  thresholdDays: number = GHOSTED_THRESHOLD_DAYS
): boolean {
  if (input.status !== "Applied") return false;
  if (input.hasOutcomeEvidence) return false;
  if (!input.lastActivityAt) return false;

  const lastActivity = Date.parse(input.lastActivityAt);
  if (!Number.isFinite(lastActivity)) return false;

  const elapsedDays = (now - lastActivity) / 86_400_000;
  return elapsedDays >= thresholdDays;
}

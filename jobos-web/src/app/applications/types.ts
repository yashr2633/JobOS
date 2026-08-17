export type ApplicationStatus =
  | "Applied"
  | "Interview"
  | "Offer"
  | "Rejected"
  | "Ghosted";

export type ApplicationStatusFilter = ApplicationStatus | "All";

/**
 * Who or what set a status.
 *
 * A closed vocabulary, mirrored by the `application_status_history.source`
 * CHECK constraint:
 *   `manual` a person changed it in the UI,
 *   `gmail`  Gmail evidence moved it,
 *   `system` this application's own deterministic logic moved it.
 *
 * Never a free-form string: the column would accept one, and then "where did
 * this status come from" would stop being answerable.
 */
export type ApplicationStatusSource = "manual" | "gmail" | "system";

/**
 * One recorded status change, as stored in `application_status_history`.
 *
 * `fromStatus` is nullable because a first recorded event genuinely has no
 * prior status. It is NEVER filled in by inference — an application that
 * existed before history was recorded simply has no rows here.
 */
export interface ApplicationStatusHistory {
  id: string;
  applicationId: string;
  /** The status the application left. `null` when nothing preceded this event. */
  fromStatus: ApplicationStatus | null;
  /** The status the application moved to. Always recorded. */
  toStatus: ApplicationStatus;
  /** Real `changed_at` timestamp. Never derived from `applied_date`. */
  changedAt: string;
  source: ApplicationStatusSource;
  note: string | null;
}

export interface Application {
  id: string;
  company: string;
  role: string;
  location: string;
  jobPortal: string;
  appliedDate: string;
  status: ApplicationStatus;
  salary?: string;
  /** Job description text, if provided during application tracking (Sprint 5) */
  jobDescription?: string;
  /** Gmail message ID for applications imported from Gmail, enables direct email link */
  gmailMessageId?: string | null;
  /** Gmail account email for applications imported from Gmail, enables account-specific link */
  gmailAddress?: string | null;
}

/**
 * The Applications page summary.
 *
 * Re-exported from the canonical `StatusSummary` rather than declared here, so
 * this page cannot describe a different set of figures from the Dashboard. The
 * previous local shape carried only total/active/interviews/rejected, which made
 * Offer and Ghosted unrepresentable on this screen — the counts a user with a
 * list full of Ghosted applications most needed to see.
 */
export type { StatusSummary as ApplicationStats } from "../dashboard/metrics.ts";

export interface ApplicationFormData {
  company: string;
  role: string;
  location: string;
  jobPortal: string;
  appliedDate: string;
  status: ApplicationStatus;
  salary: string;
  /** Optional JD text. Empty string means "none", stored as NULL. */
  jobDescription: string;
}

/**
 * Display labels for the Gmail tracking vocabularies.
 *
 * Display-only: nothing here is persisted, and the stored codes are untouched.
 * The maps are typed as total records over the REAL unions, so tsc fails if the
 * gate or the importer gains a code and this file is not updated — which is
 * what stops a raw `snake_case` code from reaching the UI by default.
 *
 * The union imports are type-only, so no Gmail module is pulled into the client
 * bundle by this file.
 */

import type { EvidenceReason } from "@/lib/gmail/applicationEvidence";
import type { AutoImportReason } from "@/lib/gmail/autoImport";
import type { EmailCategory } from "@/lib/gmail/heuristics";

/** Shown for a code this build does not know about. Never the raw code. */
export const UNKNOWN_LABEL = "Other";

/** Shown when the column is genuinely null — an absence, not an unknown code. */
export const NO_REASON_LABEL = "no reason recorded";

/** Every reason code that can reach the UI: the gate's plus the importer's. */
export type ReasonCode = EvidenceReason | AutoImportReason;

/**
 * Phrased lowercase because these render inline inside a sentence-like row
 * ("… same employer, different role").
 */
export const REASON_LABELS: Record<ReasonCode, string> = {
  // --- Evidence Gate: hard exclusions ---
  excluded_gmail_label: "excluded by a Gmail label",
  excluded_job_alert: "job alert, not an application",
  excluded_social_notification: "social network notification",
  excluded_financial_application: "financial or loan application",
  excluded_marketing: "marketing email",
  excluded_hiring_announcement: "hiring announcement, not your application",
  // --- Evidence Gate: strong lifecycle evidence ---
  lifecycle_subject_match: "lifecycle email (subject)",
  lifecycle_body_match: "lifecycle email (body)",
  // --- Evidence Gate: medium tier ---
  ats_sender_with_candidate_language: "applicant tracking system email",
  application_url_with_candidate_language: "application link",
  application_url_only: "application link only",
  // --- Evidence Gate: weak / none ---
  keyword_only: "job-related wording only",
  no_application_evidence: "no application evidence",
  // --- Auto importer decisions ---
  matched_existing_application: "matched an application you already track",
  match_company_only: "same employer, different role",
  match_target_not_owned: "matched an application we could not verify",
  strong_lifecycle_evidence: "strong lifecycle evidence",
  strong_evidence_unresolved_employer:
    "strong evidence — created with employer to be resolved",
  no_strong_evidence: "evidence too weak to organize on its own",
  employer_unresolved: "no employer name in the email",
  employer_resolved_to_portal: "only a job board name was available",
};

/** The 12 classification codes, as words. */
export const CATEGORY_LABELS: Record<EmailCategory, string> = {
  APPLICATION_CONFIRMATION: "Application confirmation",
  APPLICATION_RECEIVED: "Application received",
  APPLICATION_UPDATE: "Application update",
  INTERVIEW_INVITATION: "Interview invitation",
  INTERVIEW_UPDATE: "Interview update",
  RECRUITER_CONTACT: "Recruiter contact",
  REJECTION: "Rejection",
  OFFER: "Offer",
  WITHDRAWAL: "Withdrawal",
  FOLLOW_UP: "Follow-up",
  JOB_OPPORTUNITY: "Job opportunity",
  OTHER_JOB_RELATED: "Other job-related",
  NOT_JOB_RELATED: "Not job related",
};

/**
 * Label for a stored reason code.
 *
 * The column is free text at the database level, so the parameter is a string:
 * a code written by an older build resolves to "Other" rather than leaking as
 * `snake_case`.
 */
export function reasonLabel(reason: string | null): string {
  if (!reason) return NO_REASON_LABEL;
  return REASON_LABELS[reason as ReasonCode] ?? UNKNOWN_LABEL;
}

/** Label for a stored category code. Unknown codes resolve to "Other". */
export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category as EmailCategory] ?? UNKNOWN_LABEL;
}

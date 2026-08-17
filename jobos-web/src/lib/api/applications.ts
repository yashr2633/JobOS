import type {
  Application,
  ApplicationFormData,
  ApplicationStatus,
  ApplicationStatusHistory,
  ApplicationStatusSource,
} from "@/app/applications/types";
import type { SupabaseClient } from "@supabase/supabase-js";
// Relative + .ts extension so this module chain stays runnable under
// `node --test`, matching the convention in lib/gmail/ and lib/api/gmailActivity.ts.
import {
  classifyTransition,
  describeRefusedTransition,
  isApplicationStatus,
  isApplicationStatusSource,
  normalizeStatusNote,
  STATUS_CORRECTION_NOTE,
} from "../applications/lifecycle.ts";
import { getGmailConnection } from "./gmail.ts";

/**
 * The row shape this module reads back. `select("*")` returns more columns than
 * the UI needs (the `parsed_jd` cache, timestamps); only these are mapped.
 */
interface ApplicationRow {
  id: string;
  company: string;
  role: string;
  location: string;
  job_portal: string;
  applied_date: string;
  status: Application["status"];
  salary: string | null;
  job_description?: string | null;
  gmail_message_id?: string | null;
  gmail_address?: string | null;
}

/** One mapper, so every read returns the same shape. */
function mapApplication(row: ApplicationRow): Application {
  return {
    id: row.id,
    company: row.company,
    role: row.role,
    location: row.location,
    jobPortal: row.job_portal,
    appliedDate: row.applied_date,
    status: row.status,
    salary: row.salary || undefined,
    jobDescription: row.job_description || undefined,
    gmailMessageId: row.gmail_message_id || undefined,
    gmailAddress: row.gmail_address || undefined,
  };
}

/** Empty text is stored as NULL so "absent" has exactly one representation. */
function normalizeJobDescription(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** The acting user's id, or a readable throw. */
async function requireUserId(supabase: SupabaseClient): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("User not authenticated");
  }

  return user.id;
}

// ---------------------------------------------------------------------------
// Status lifecycle
// ---------------------------------------------------------------------------

/** The row shape `application_status_history` reads back. */
interface StatusHistoryRow {
  id: string;
  application_id: string;
  from_status: string | null;
  to_status: string;
  changed_at: string;
  source: string;
  note: string | null;
}

/** Columns read from the history table. Named, so no later column joins by accident. */
const STATUS_HISTORY_COLUMNS =
  "id, application_id, from_status, to_status, changed_at, source, note";

/**
 * Map a stored history row, or `null` when it carries a status or source outside
 * the allowed vocabulary.
 *
 * Both columns are TEXT with a CHECK behind them, so an out-of-vocabulary value
 * should be impossible — but reading it back as a typed union without checking
 * would be a cast, not a guarantee. An unrecognised row is dropped rather than
 * shown as something it is not.
 */
function mapStatusHistory(row: StatusHistoryRow): ApplicationStatusHistory | null {
  if (!isApplicationStatus(row.to_status)) return null;
  if (!isApplicationStatusSource(row.source)) return null;

  const fromStatus =
    row.from_status !== null && isApplicationStatus(row.from_status)
      ? row.from_status
      : null;

  return {
    id: row.id,
    applicationId: row.application_id,
    fromStatus,
    toStatus: row.to_status,
    changedAt: row.changed_at,
    source: row.source,
    note: row.note,
  };
}

export interface UpdateApplicationStatusInput {
  /** The acting user. Checked against the session, then against the row. */
  userId: string;
  applicationId: string;
  status: ApplicationStatus;
  source: ApplicationStatusSource;
  /** Optional explanation, stored verbatim (trimmed and bounded). */
  note?: string | null;
  /**
   * Permit a change the forward table does not allow.
   *
   * Default false. This is the ONLY way a status moves backwards, and it exists
   * so a user fixing a mis-set status is a deliberate act that is recorded in
   * history like any other event — never a widening of the forward rules.
   */
  allowCorrection?: boolean;
}

/**
 * THE authoritative status write. Every status change goes through here.
 *
 * Delegates to the `update_application_status` Postgres function, because the
 * read-validate-update-append sequence has to be atomic and the Supabase client
 * has no transaction. Inside that one call the application row is locked, its
 * current status is read, a no-op is detected, the transition is validated
 * against the same table as `lifecycle.ts`, `applications.status` is updated and
 * exactly one `application_status_history` row is appended.
 *
 * The checks below are not a substitute for that — the function is authoritative
 * and re-does all of them under the lock. They are here so a no-op costs no
 * write at all, and so a refused transition fails with a sentence a person can
 * read instead of a database error.
 *
 * Returns the status the application ends up with. For a no-op that is the
 * status it already had, and NO history row is created.
 */
export async function updateApplicationStatus(
  supabase: SupabaseClient,
  input: UpdateApplicationStatusInput
): Promise<ApplicationStatus> {
  const { userId, applicationId, status, source } = input;

  const actingUserId = await requireUserId(supabase);
  if (actingUserId !== userId) {
    // A caller passing someone else's id is a bug, not a permission prompt.
    throw new Error("You can only change your own applications.");
  }

  if (!isApplicationStatus(status)) {
    throw new Error("That is not an application status.");
  }
  if (!isApplicationStatusSource(source)) {
    throw new Error("That is not a recognised status source.");
  }

  // Ownership is verified in the statement, not only by RLS.
  const { data: existing, error: readError } = await supabase
    .from("applications")
    .select("id, status")
    .eq("id", applicationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (readError) {
    console.error("Error reading application status:", readError);
    throw readError;
  }
  if (!existing) {
    throw new Error("That application could not be found.");
  }

  const currentStatus: unknown = existing.status;
  if (!isApplicationStatus(currentStatus)) {
    throw new Error("This application's current status could not be read.");
  }

  const outcome = classifyTransition(currentStatus, status);

  // Unchanged: nothing happened, so nothing is recorded.
  if (outcome === "no_op") return currentStatus;

  const allowCorrection = input.allowCorrection === true;
  if (outcome === "requires_correction" && !allowCorrection) {
    throw new Error(describeRefusedTransition(currentStatus, status));
  }

  const { data, error } = await supabase.rpc("update_application_status", {
    p_application_id: applicationId,
    p_status: status,
    p_source: source,
    p_note: normalizeStatusNote(input.note),
    p_allow_correction: allowCorrection,
  });

  if (error) {
    console.error("Error updating application status:", error);
    throw error;
  }

  // The function returns the resulting status. Anything else means the schema
  // and this module disagree, which must not be reported as success.
  if (!isApplicationStatus(data)) {
    throw new Error("The status change could not be confirmed.");
  }

  return data;
}

/**
 * One application's recorded status changes, OLDEST FIRST — the order the
 * detail view reads them in.
 *
 * User-scoped in the statement as well as by RLS, so another user's history is
 * unreachable even with a known application id.
 */
export async function fetchApplicationStatusHistory(
  supabase: SupabaseClient,
  userId: string,
  applicationId: string
): Promise<ApplicationStatusHistory[]> {
  const { data, error } = await supabase
    .from("application_status_history")
    .select(STATUS_HISTORY_COLUMNS)
    .eq("user_id", userId)
    .eq("application_id", applicationId)
    .order("changed_at", { ascending: true })
    .returns<StatusHistoryRow[]>();

  if (error) {
    console.error("Error fetching application status history:", error);
    throw error;
  }

  return (data ?? [])
    .map(mapStatusHistory)
    .filter((row): row is ApplicationStatusHistory => row !== null);
}

/**
 * The acting user's most recent status changes across all their applications,
 * NEWEST FIRST. Feeds the dashboard's recent activity.
 *
 * Returns only what is recorded. With no recorded changes it returns an empty
 * array, and the dashboard says so rather than deriving events from
 * `applied_date` or from the current status.
 */
export async function fetchRecentStatusHistory(
  supabase: SupabaseClient,
  userId: string,
  limit: number
): Promise<ApplicationStatusHistory[]> {
  const { data, error } = await supabase
    .from("application_status_history")
    .select(STATUS_HISTORY_COLUMNS)
    .eq("user_id", userId)
    .order("changed_at", { ascending: false })
    .limit(Math.max(0, limit))
    .returns<StatusHistoryRow[]>();

  if (error) {
    console.error("Error fetching recent status history:", error);
    throw error;
  }

  return (data ?? [])
    .map(mapStatusHistory)
    .filter((row): row is ApplicationStatusHistory => row !== null);
}

export async function fetchApplications(
  supabase: SupabaseClient
): Promise<Application[]> {
  const { data, error } = await supabase
    .from("applications")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching applications:", error);
    throw error;
  }

  // Transform database format to Application interface
  const applications = (data || []).map(mapApplication);

  // The connected mailbox address is a per-user connection fact (one Gmail
  // connection per user), shared by all of that user's Gmail-imported
  // applications. It is NOT stored on the applications table, so it is read
  // once from the existing gmail_connections model and attached to the rows
  // that carry a Gmail message id. This lets the detail view open the source
  // email in the CORRECT Google account (authuser=<address>) instead of
  // whichever account is the browser's default. Applications without a Gmail
  // message id are untouched, so non-Gmail applications never gain a link.
  const needsAddress = applications.some((app) => app.gmailMessageId);
  if (!needsAddress) return applications;

  let emailAddress: string | null = null;
  try {
    const connection = await getGmailConnection(supabase);
    emailAddress = connection?.emailAddress ?? null;
  } catch (connectionError) {
    // A failure to read the connection must never break the applications list.
    // The link then falls back to no explicit account targeting.
    console.error(
      "Error fetching Gmail connection for source link:",
      connectionError
    );
  }

  if (!emailAddress) return applications;

  return applications.map((app) =>
    app.gmailMessageId ? { ...app, gmailAddress: emailAddress } : app
  );
}

export async function createApplication(
  supabase: SupabaseClient,
  formData: ApplicationFormData
): Promise<Application> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("User not authenticated");
  }

  const { data, error } = await supabase
    .from("applications")
    .insert({
      user_id: user.id,
      company: formData.company,
      role: formData.role,
      location: formData.location,
      job_portal: formData.jobPortal,
      applied_date: formData.appliedDate,
      status: formData.status,
      salary: formData.salary || null,
      // A new row has no parse cache to invalidate.
      job_description: normalizeJobDescription(formData.jobDescription),
      // Created by a person, so the Gmail reset must never touch it.
      source: "manual",
    })
    .select()
    .single();

  if (error) {
    console.error("Error creating application:", error);
    throw error;
  }

  return mapApplication(data);
}

export interface UpdateApplicationOptions {
  /**
   * Permit a status change the forward table does not allow, recorded as a
   * deliberate correction. Default false — see `updateApplicationStatus`.
   */
  allowCorrection?: boolean;
}

/**
 * Save the form.
 *
 * `status` is DELIBERATELY absent from the general update statement. It is the
 * one field with a lifecycle, so it is routed through
 * `updateApplicationStatus`, which is the only place that validates a transition
 * and records history. That is what makes it impossible for the form to move a
 * status without leaving a trail:
 *
 *   - status changed  -> the general update runs, then the lifecycle write,
 *                        producing exactly one history row with source 'manual'
 *   - status the same -> the general update runs and NO history row is written
 *
 * The transition is validated BEFORE the general update, so a refused status
 * change does not half-apply the rest of the form.
 */
export async function updateApplication(
  supabase: SupabaseClient,
  id: string,
  formData: ApplicationFormData,
  options: UpdateApplicationOptions = {}
): Promise<Application> {
  const userId = await requireUserId(supabase);

  const jobDescription = normalizeJobDescription(formData.jobDescription);

  // The stored `parsed_jd` is derived from the stored `job_description`, so
  // rewriting the text without clearing the cache would leave Resume Match
  // scoring against the OLD parse. `saveJobDescription` in the analyze path
  // invalidates it the same way; this read tells us whether it has to happen.
  // The current status is read in the same statement, because the lifecycle
  // write below needs to know whether the form actually changed it.
  const { data: existing, error: readError } = await supabase
    .from("applications")
    .select("job_description, status")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (readError) {
    console.error("Error reading application before update:", readError);
    throw readError;
  }

  const storedJobDescription: string | null = existing?.job_description ?? null;
  const jobDescriptionChanged = storedJobDescription !== jobDescription;

  const storedStatus: unknown = existing?.status;
  const currentStatus = isApplicationStatus(storedStatus) ? storedStatus : null;
  const statusChanged =
    currentStatus !== null && currentStatus !== formData.status;
  const allowCorrection = options.allowCorrection === true;

  // Fail before anything is written when the requested transition is refused.
  if (
    statusChanged &&
    !allowCorrection &&
    classifyTransition(currentStatus, formData.status) ===
      "requires_correction"
  ) {
    throw new Error(
      describeRefusedTransition(currentStatus, formData.status)
    );
  }

  const { data, error } = await supabase
    .from("applications")
    .update({
      company: formData.company,
      role: formData.role,
      location: formData.location,
      job_portal: formData.jobPortal,
      applied_date: formData.appliedDate,
      salary: formData.salary || null,
      job_description: jobDescription,
      ...(jobDescriptionChanged ? { parsed_jd: null, parsed_jd_at: null } : {}),
    })
    .eq("id", id)
    .eq("user_id", userId)
    .select()
    .single();

  if (error) {
    console.error("Error updating application:", error);
    throw error;
  }

  const application = mapApplication(data);
  if (!statusChanged) return application;

  const status = await updateApplicationStatus(supabase, {
    userId,
    applicationId: id,
    status: formData.status,
    source: "manual",
    note: allowCorrection ? STATUS_CORRECTION_NOTE : null,
    allowCorrection,
  });

  // The general update did not write `status`, so the mapped row still carries
  // the old one. Report what the lifecycle write actually settled on.
  return { ...application, status };
}

export async function deleteApplication(
  supabase: SupabaseClient,
  id: string
): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("User not authenticated");
  }

  const { error } = await supabase
    .from("applications")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    console.error("Error deleting application:", error);
    throw error;
  }
}

export async function duplicateApplication(
  supabase: SupabaseClient,
  application: Application
): Promise<Application> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("User not authenticated");
  }

  const { data, error } = await supabase
    .from("applications")
    .insert({
      user_id: user.id,
      company: `${application.company} (Copy)`,
      role: application.role,
      location: application.location,
      job_portal: application.jobPortal,
      applied_date: application.appliedDate,
      status: application.status,
      salary: application.salary || null,
      // The JD text is copied; the parse cache is not, so the copy starts with
      // no `parsed_jd` and is parsed fresh on its first analysis.
      job_description: normalizeJobDescription(application.jobDescription),
      // Created by a person, so the Gmail reset must never touch it.
      source: "manual",
    })
    .select()
    .single();

  if (error) {
    console.error("Error duplicating application:", error);
    throw error;
  }

  return mapApplication(data);
}

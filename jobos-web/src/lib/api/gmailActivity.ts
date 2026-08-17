/**
 * Data access for Gmail tracking: sync jobs and the activity ledger.
 *
 * SERVER ONLY. Follows the conventions in applications.ts / resumes.ts: the
 * Supabase client is passed in, every statement is constrained by user_id, and
 * RLS backs it as a second layer.
 *
 * No email body is ever written by this module.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
// Relative + .ts extension so this module chain stays runnable under
// `node --test`, matching the convention in lib/ai/.
import {
  LIFECYCLE_CATEGORIES,
  type EvidenceReason,
  type EvidenceStrength,
} from "../gmail/applicationEvidence.ts";
import type { EmailCategory } from "../gmail/heuristics.ts";
import type { InferredStatus } from "../gmail/statusInference.ts";

export type SyncJobStatus =
  | "pending"
  | "running"
  | "paused"
  | "complete"
  | "failed";

export type SyncMode = "full" | "incremental";

export interface GmailSyncJob {
  id: string;
  userId: string;
  connectionId: string;
  status: SyncJobStatus;
  /** 'full' = date-windowed scan; 'incremental' = history.list since anchor. */
  syncMode: SyncMode;
  /** Anchor this incremental job started from. Null for a full scan. */
  startHistoryId: string | null;
  /** Anchor to promote once the scan completes. */
  resultHistoryId: string | null;
  windowStart: string;
  windowEnd: string;
  pageToken: string | null;
  messagesSeen: number;
  candidates: number;
  classified: number;
  /** Applications the Auto_Importer CREATED during this job. */
  applicationsFound: number;
  /**
   * Existing applications whose status this job's Auto_Importer advanced.
   *
   * Persisted per job, so what a scan did outlives the request that ran it. A
   * job that finished before this counter was mapped reads as 0, which is
   * honest: nothing was recorded for it.
   */
  applicationsUpdated: number;
  error: string | null;
  startedAt: string | null;
  updatedAt: string;
  createdAt: string;
}

interface SyncJobRow {
  id: string;
  user_id: string;
  connection_id: string;
  status: SyncJobStatus;
  sync_mode: SyncMode;
  start_history_id: string | null;
  result_history_id: string | null;
  window_start: string;
  window_end: string;
  page_token: string | null;
  messages_seen: number;
  candidates: number;
  classified: number;
  applications_found: number;
  applications_updated: number;
  error: string | null;
  started_at: string | null;
  updated_at: string;
  created_at: string;
}

function mapJob(row: SyncJobRow): GmailSyncJob {
  return {
    id: row.id,
    userId: row.user_id,
    connectionId: row.connection_id,
    status: row.status,
    syncMode: row.sync_mode ?? "full",
    startHistoryId: row.start_history_id ?? null,
    resultHistoryId: row.result_history_id ?? null,
    windowStart: row.window_start,
    windowEnd: row.window_end,
    pageToken: row.page_token,
    messagesSeen: row.messages_seen,
    candidates: row.candidates,
    classified: row.classified,
    applicationsFound: row.applications_found,
    // Rows written before this column was mapped carry no value; read that as
    // 0 rather than as undefined leaking into a number field.
    applicationsUpdated: row.applications_updated ?? 0,
    error: row.error,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

/** The user's resumable job, if one exists. */
export async function getOpenSyncJob(
  supabase: SupabaseClient,
  userId: string
): Promise<GmailSyncJob | null> {
  const { data, error } = await supabase
    .from("gmail_sync_jobs")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["pending", "running", "paused"])
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    console.error("Error loading open Gmail sync job:", error);
    throw error;
  }

  const row = data?.[0] as SyncJobRow | undefined;
  return row ? mapJob(row) : null;
}

/** Most recent job of any status, for the dashboard's last-sync summary. */
export async function getLatestSyncJob(
  supabase: SupabaseClient,
  userId: string
): Promise<GmailSyncJob | null> {
  const { data, error } = await supabase
    .from("gmail_sync_jobs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    console.error("Error loading latest Gmail sync job:", error);
    throw error;
  }

  const row = data?.[0] as SyncJobRow | undefined;
  return row ? mapJob(row) : null;
}

/**
 * The most recent COMPLETED job, or null when no scan has ever finished.
 *
 * Read-only, and used for one thing: the dashboard's default reporting window is
 * recovered from this job's persisted `window_start` / `window_end`, so the page
 * opens on the period that was actually read. `getLatestSyncJob` cannot answer
 * that — its newest row may be a failed or still-running job, whose bounds
 * describe a window nothing was reported for.
 */
export async function getLatestCompletedSyncJob(
  supabase: SupabaseClient,
  userId: string
): Promise<GmailSyncJob | null> {
  const { data, error } = await supabase
    .from("gmail_sync_jobs")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "complete")
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    console.error("Error loading latest completed Gmail sync job:", error);
    throw error;
  }

  const row = data?.[0] as SyncJobRow | undefined;
  return row ? mapJob(row) : null;
}

/**
 * Earliest `window_start` among this user's COMPLETED full scans, or null when
 * no full scan has ever completed.
 *
 * This is the "how far back has this mailbox actually been read" fact the sync
 * route needs to choose a mode: a requested window at or inside the covered
 * start is already covered, so the history anchor alone is enough and the scan
 * stays incremental. A request that reaches further back than this needs one
 * bounded full scan over the wider window.
 *
 * Only completed jobs count. An interrupted wide scan must not be mistaken for
 * coverage, or the mail it never reached would be skipped forever.
 */
export async function getCompletedFullScanWindowStart(
  supabase: SupabaseClient,
  userId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("gmail_sync_jobs")
    .select("window_start")
    .eq("user_id", userId)
    .eq("status", "complete")
    .eq("sync_mode", "full")
    .order("window_start", { ascending: true })
    .limit(1);

  if (error) {
    console.error("Error loading completed Gmail scan coverage:", error);
    throw error;
  }

  const row = data?.[0] as { window_start: string | null } | undefined;
  return row?.window_start ?? null;
}

export async function getSyncJobById(
  supabase: SupabaseClient,
  userId: string,
  jobId: string
): Promise<GmailSyncJob | null> {
  const { data, error } = await supabase
    .from("gmail_sync_jobs")
    .select("*")
    .eq("id", jobId)
    // Ownership is enforced in the statement, not just by RLS.
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("Error loading Gmail sync job:", error);
    throw error;
  }

  return data ? mapJob(data as SyncJobRow) : null;
}

/**
 * Start a scan, reusing any already-open job.
 *
 * A partial unique index allows only one open job per user, so this is the
 * single entry point that guarantees two concurrent batch loops cannot race the
 * same page_token.
 */
export async function startSyncJob(
  supabase: SupabaseClient,
  userId: string,
  input: {
    connectionId: string;
    windowStart: string;
    windowEnd: string;
    syncMode?: SyncMode;
    /** Required for an incremental job; ignored for a full scan. */
    startHistoryId?: string | null;
  }
): Promise<GmailSyncJob> {
  const existing = await getOpenSyncJob(supabase, userId);
  if (existing) return existing;

  const { data, error } = await supabase
    .from("gmail_sync_jobs")
    .insert({
      user_id: userId,
      connection_id: input.connectionId,
      status: "running",
      sync_mode: input.syncMode ?? "full",
      start_history_id: input.startHistoryId ?? null,
      window_start: input.windowStart,
      window_end: input.windowEnd,
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    // 23505 = another request created the job first. Return theirs.
    if ((error as { code?: string }).code === "23505") {
      const raced = await getOpenSyncJob(supabase, userId);
      if (raced) return raced;
    }
    console.error("Error starting Gmail sync job:", error);
    throw error;
  }

  return mapJob(data as SyncJobRow);
}

/** Persist batch progress. Called after every batch so a crash loses nothing. */
export async function updateSyncJobProgress(
  supabase: SupabaseClient,
  userId: string,
  jobId: string,
  patch: {
    status?: SyncJobStatus;
    pageToken?: string | null;
    messagesSeen?: number;
    candidates?: number;
    classified?: number;
    applicationsFound?: number;
    applicationsUpdated?: number;
    error?: string | null;
    resultHistoryId?: string | null;
  }
): Promise<void> {
  const row: Record<string, unknown> = {};

  if (patch.status !== undefined) row.status = patch.status;
  if (patch.pageToken !== undefined) row.page_token = patch.pageToken;
  if (patch.resultHistoryId !== undefined) {
    row.result_history_id = patch.resultHistoryId;
  }
  if (patch.messagesSeen !== undefined) row.messages_seen = patch.messagesSeen;
  if (patch.candidates !== undefined) row.candidates = patch.candidates;
  if (patch.classified !== undefined) row.classified = patch.classified;
  if (patch.applicationsFound !== undefined) {
    row.applications_found = patch.applicationsFound;
  }
  if (patch.applicationsUpdated !== undefined) {
    row.applications_updated = patch.applicationsUpdated;
  }
  if (patch.error !== undefined) row.error = patch.error;

  if (Object.keys(row).length === 0) return;

  const { error } = await supabase
    .from("gmail_sync_jobs")
    .update(row)
    .eq("id", jobId)
    .eq("user_id", userId);

  if (error) {
    console.error("Error updating Gmail sync job:", error);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Activity ledger
// ---------------------------------------------------------------------------

/**
 * The two strengths the ledger stores. The gate's third verdict, `none`, is
 * stored as NULL, which the Sprint 9 CHECK constraint also allows and which
 * every pre-migration row already carries. NULL always reads as "not strong".
 */
export type StoredEvidenceStrength = Exclude<EvidenceStrength, "none">;

export interface GmailActivityRecord {
  gmailMessageId: string;
  gmailThreadId: string | null;
  connectionId: string | null;
  category: EmailCategory;
  company: string | null;
  jobTitle: string | null;
  jobUrl: string | null;
  location: string | null;
  emailDate: string | null;
  sender: string | null;
  senderDomain: string | null;
  inferredStatus: InferredStatus | null;
  confidence: number | null;
  /** Why this row may (or may not) be organized without asking the user. */
  evidenceStrength: StoredEvidenceStrength | null;
  /**
   * Fixed reason code from the gate's vocabulary. Typed as the union rather
   * than as a string so no email text can ever be routed into this column.
   */
  evidenceReason: EvidenceReason | null;
}

export interface GmailActivityRow {
  id: string;
  gmail_message_id: string;
  gmail_thread_id: string | null;
  application_id: string | null;
  category: EmailCategory;
  company: string | null;
  job_title: string | null;
  job_url: string | null;
  location: string | null;
  email_date: string | null;
  sender: string | null;
  sender_domain: string | null;
  inferred_status: InferredStatus | null;
  confidence: number | null;
  evidence_strength: StoredEvidenceStrength | null;
  /** Free text at the database level, so read back as text. */
  evidence_reason: string | null;
}

/**
 * The full `GmailActivityRow` column list, named explicitly rather than `*` so
 * that a column added to this table later cannot join a read by accident.
 */
const ACTIVITY_COLUMNS =
  "id, gmail_message_id, gmail_thread_id, application_id, category, company, " +
  "job_title, job_url, location, email_date, sender, sender_domain, " +
  "inferred_status, confidence, evidence_strength, evidence_reason";

/**
 * The Lifecycle_Category values, as an array for PostgREST `in` filters.
 *
 * Derived from the gate's set so the two can never drift: a category is a
 * lifecycle stage in exactly one place in the codebase.
 */
const LIFECYCLE_CATEGORY_LIST: readonly EmailCategory[] = [...LIFECYCLE_CATEGORIES];

/**
 * Which of these message ids have already been processed.
 *
 * Called BEFORE any messages.get or AI call, so previously seen messages cost
 * nothing on a re-sync. This is the primary idempotency and cost control.
 */
export async function findProcessedMessageIds(
  supabase: SupabaseClient,
  userId: string,
  messageIds: string[]
): Promise<Set<string>> {
  if (messageIds.length === 0) return new Set();

  const { data, error } = await supabase
    .from("gmail_activity")
    .select("gmail_message_id")
    .eq("user_id", userId)
    .in("gmail_message_id", messageIds);

  if (error) {
    console.error("Error checking processed Gmail messages:", error);
    throw error;
  }

  return new Set(
    (data ?? []).map((row) => (row as { gmail_message_id: string }).gmail_message_id)
  );
}

/**
 * Insert activity rows, ignoring any that already exist.
 *
 * Relies on UNIQUE(user_id, gmail_message_id): a duplicate is not an error, it
 * is the expected outcome of a retried batch.
 *
 * Returns the number of rows actually inserted.
 */
export async function insertGmailActivity(
  supabase: SupabaseClient,
  userId: string,
  records: GmailActivityRecord[]
): Promise<number> {
  if (records.length === 0) return 0;

  const rows = records.map((record) => ({
    user_id: userId,
    connection_id: record.connectionId,
    gmail_message_id: record.gmailMessageId,
    gmail_thread_id: record.gmailThreadId,
    category: record.category,
    company: record.company,
    job_title: record.jobTitle,
    job_url: record.jobUrl,
    location: record.location,
    email_date: record.emailDate,
    sender: record.sender,
    sender_domain: record.senderDomain,
    inferred_status: record.inferredStatus,
    confidence: record.confidence,
    evidence_strength: record.evidenceStrength,
    evidence_reason: record.evidenceReason,
    processed_at: new Date().toISOString(),
  }));

  const { data, error } = await supabase
    .from("gmail_activity")
    // ignoreDuplicates makes a replayed batch a no-op rather than a failure.
    .upsert(rows, {
      onConflict: "user_id,gmail_message_id",
      ignoreDuplicates: true,
    })
    .select("id");

  if (error) {
    console.error("Error inserting Gmail activity:", error);
    throw error;
  }

  return data?.length ?? 0;
}

/** Thread → application links already established, for tier-1 matching. */
export async function getThreadApplicationLinks(
  supabase: SupabaseClient,
  userId: string,
  threadIds: string[]
): Promise<Map<string, string>> {
  const unique = [...new Set(threadIds.filter(Boolean))];
  if (unique.length === 0) return new Map();

  const { data, error } = await supabase
    .from("gmail_activity")
    .select("gmail_thread_id, application_id")
    .eq("user_id", userId)
    .in("gmail_thread_id", unique)
    .not("application_id", "is", null);

  if (error) {
    console.error("Error loading Gmail thread links:", error);
    throw error;
  }

  const links = new Map<string, string>();
  for (const row of data ?? []) {
    const typed = row as { gmail_thread_id: string | null; application_id: string | null };
    if (typed.gmail_thread_id && typed.application_id) {
      links.set(typed.gmail_thread_id, typed.application_id);
    }
  }
  return links;
}

/** Job-related activity not yet linked to an application — the review queue. */
export async function fetchUnlinkedActivity(
  supabase: SupabaseClient,
  userId: string,
  limit = 500
): Promise<GmailActivityRow[]> {
  const { data, error } = await supabase
    .from("gmail_activity")
    .select("*")
    .eq("user_id", userId)
    .is("application_id", null)
    .neq("category", "NOT_JOB_RELATED")
    .order("email_date", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("Error loading unlinked Gmail activity:", error);
    throw error;
  }

  return (data ?? []) as GmailActivityRow[];
}

/**
 * Unlinked activity that evidences an application lifecycle stage — the input
 * the Auto_Importer groups into proposals.
 *
 * Narrower than `fetchUnlinkedActivity`, which excludes only NOT_JOB_RELATED
 * and therefore also returns rows the model could not resolve to a stage. Those
 * can never satisfy the auto-create precondition, so fetching them here would
 * only cost rows.
 */
export async function fetchLifecycleActivityForAutoImport(
  supabase: SupabaseClient,
  userId: string,
  limit = 500
): Promise<GmailActivityRow[]> {
  const { data, error } = await supabase
    .from("gmail_activity")
    .select(ACTIVITY_COLUMNS)
    .eq("user_id", userId)
    .is("application_id", null)
    .in("category", LIFECYCLE_CATEGORY_LIST)
    .order("email_date", { ascending: false })
    .limit(limit)
    .returns<GmailActivityRow[]>();

  if (error) {
    console.error("Error loading lifecycle Gmail activity:", error);
    throw error;
  }

  return data ?? [];
}

/**
 * The Unknown_Bucket predicate, as a pure function.
 *
 * Exists so the exact condition behind `fetchUnknownBucket` can be asserted
 * without a database, and so the query and the UI cannot drift apart: a row is
 * in the bucket when it is still unlinked, evidences a lifecycle stage, and no
 * employer could be determined for it.
 *
 * `company === null` is the whole membership test on the employer side. There is
 * no placeholder employer name to look for — the automatic path never writes
 * one, precisely so that "we do not know" stays distinguishable from a real
 * company called anything at all.
 */
export function isUnknownBucketRow(row: {
  application_id: string | null;
  company: string | null;
  category: EmailCategory;
}): boolean {
  return (
    row.application_id === null &&
    row.company === null &&
    LIFECYCLE_CATEGORIES.has(row.category)
  );
}

/**
 * Lifecycle evidence whose employer could not be determined — derived, not
 * stored (Requirement 8.2).
 *
 * `application_id IS NULL AND company IS NULL` matches the Sprint 9 partial
 * index `idx_gmail_activity_unknown_employer`, and ordering by `email_date`
 * descending under `user_id` matches that index's column order, so the
 * lifecycle category list is the only part applied on top of it.
 */
export async function fetchUnknownBucket(
  supabase: SupabaseClient,
  userId: string,
  limit = 200
): Promise<GmailActivityRow[]> {
  const { data, error } = await supabase
    .from("gmail_activity")
    .select(ACTIVITY_COLUMNS)
    .eq("user_id", userId)
    .is("application_id", null)
    .is("company", null)
    .in("category", LIFECYCLE_CATEGORY_LIST)
    .order("email_date", { ascending: false })
    .limit(limit)
    .returns<GmailActivityRow[]>();

  if (error) {
    console.error("Error loading the unknown-employer Gmail activity:", error);
    throw error;
  }

  return data ?? [];
}

/**
 * How many rows are in the Unknown_Bucket.
 *
 * The `View unknown applications (N)` entry points need N and nothing else, so
 * this counts in the database instead of shipping the rows to a caller that
 * would only measure their length.
 */
export async function countUnknownBucket(
  supabase: SupabaseClient,
  userId: string
): Promise<number> {
  const { count, error } = await supabase
    .from("gmail_activity")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("application_id", null)
    .is("company", null)
    .in("category", LIFECYCLE_CATEGORY_LIST);

  if (error) {
    console.error("Error counting the unknown-employer Gmail activity:", error);
    throw error;
  }

  return count ?? 0;
}

/**
 * How many messages this user's ledger has processed in total.
 *
 * The honest answer to "how much mail has JobTrackOS read": one row per message ever
 * processed, including the ones the gate excluded, so it does not collapse to 0
 * when the most recent scan found nothing fresh to do. Counted in the database
 * with a head request — the same idiom as `countUnknownBucket` — because the
 * caller needs the number and never the rows.
 */
export async function countActivityRows(
  supabase: SupabaseClient,
  userId: string
): Promise<number> {
  const { count, error } = await supabase
    .from("gmail_activity")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  if (error) {
    console.error("Error counting Gmail activity rows:", error);
    throw error;
  }

  return count ?? 0;
}

/**
 * How many messages in a date window this user's ledger holds as job-related.
 *
 * The honest answer to "how much of what was scanned is application-related",
 * and NOT the same question as the scan's per-batch `candidates` counter. That
 * counter is incremented inside `classifyParsedEmails`, which only ever sees the
 * FRESH messages of one batch, so a repeat scan — where dedup correctly absorbs
 * every listed message — reports 0 even though the ledger holds the verdicts
 * reached when those same messages were first classified. Presenting that 0 next
 * to "528 messages read" claims none of the 528 were application-related, which
 * is false.
 *
 * Counted over `email_date`, the date the window itself is defined on, and in the
 * database with a head request because the caller needs the number, not the rows.
 * `NOT_JOB_RELATED` is excluded, so this counts evidence the gate kept — it never
 * re-derives a verdict and never widens what counts as job-related.
 */
export async function countJobRelatedActivityInWindow(
  supabase: SupabaseClient,
  userId: string,
  windowStart: string,
  windowEnd: string
): Promise<number> {
  const { count, error } = await supabase
    .from("gmail_activity")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .neq("category", "NOT_JOB_RELATED")
    .gte("email_date", windowStart)
    // The stored window end is an inclusive calendar day, so compare against the
    // end of that day rather than its midnight, which would drop the final day.
    .lte("email_date", `${windowEnd}T23:59:59.999Z`);

  if (error) {
    console.error("Error counting job-related Gmail activity:", error);
    throw error;
  }

  return count ?? 0;
}

/**
 * How many job OPPORTUNITIES this user's ledger holds — alerts and
 * recommendations, never applications.
 *
 * A `JOB_OPPORTUNITY` row is job-related mail with no evidence the user applied.
 * It is counted here for the dashboard's separate opportunities figure and is
 * NEVER part of any application KPI: the category is absent from
 * `LIFECYCLE_CATEGORIES`, so `computeWindowReport` (which counts `applications`
 * rows) cannot see it and the Auto_Importer never reads it. Counted with a head
 * request against the Sprint 11 partial index.
 */
export async function countJobOpportunities(
  supabase: SupabaseClient,
  userId: string
): Promise<number> {
  const { count, error } = await supabase
    .from("gmail_activity")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("category", "JOB_OPPORTUNITY");

  if (error) {
    console.error("Error counting Gmail job opportunities:", error);
    throw error;
  }

  return count ?? 0;
}

/** Rows per page while tallying reason codes. PostgREST caps a page at 1000. */
const REASON_PAGE_SIZE = 1000;
/** Ceiling on the tally, so one user's ledger cannot pull an unbounded read. */
const REASON_MAX_PAGES = 20;

/**
 * How many ledger rows carry each evidence reason code, optionally limited to
 * rows processed at or after `since`.
 *
 * This is the precision audit: grouping by reason code shows exactly why mail
 * was excluded or escalated, for any user, without reading a single subject
 * line. Reason codes are a fixed vocabulary, never email text.
 *
 * PostgREST has no group-by, so the codes are read and tallied here. The read is
 * paged and capped; a mailbox larger than the cap yields a tally over the most
 * recently processed rows rather than an unbounded query.
 */
export async function countEvidenceByReason(
  supabase: SupabaseClient,
  userId: string,
  since?: string
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};

  for (let page = 0; page < REASON_MAX_PAGES; page += 1) {
    let query = supabase
      .from("gmail_activity")
      .select("evidence_reason")
      .eq("user_id", userId);

    if (since !== undefined) {
      query = query.gte("processed_at", since);
    }

    const { data, error } = await query
      .order("processed_at", { ascending: false })
      .range(page * REASON_PAGE_SIZE, (page + 1) * REASON_PAGE_SIZE - 1)
      .returns<{ evidence_reason: string | null }[]>();

    if (error) {
      console.error("Error counting Gmail evidence reasons:", error);
      throw error;
    }

    const rows = data ?? [];
    for (const row of rows) {
      const reason = row.evidence_reason ?? "unrecorded";
      counts[reason] = (counts[reason] ?? 0) + 1;
    }

    if (rows.length < REASON_PAGE_SIZE) break;
  }

  return counts;
}

/**
 * Activity that is already attached to an application — the "organized" side of
 * the ledger.
 *
 * The results-first workspace needs this to list what the importer created or
 * linked, and to offer "Not mine" on those rows: the `reject` decision takes the
 * activity ids, so the ids have to be read alongside the link. One query for the
 * whole list, rather than `fetchActivityForApplication` per application.
 */
export async function fetchOrganizedActivity(
  supabase: SupabaseClient,
  userId: string,
  limit = 200
): Promise<GmailActivityRow[]> {
  const { data, error } = await supabase
    .from("gmail_activity")
    .select(ACTIVITY_COLUMNS)
    .eq("user_id", userId)
    .not("application_id", "is", null)
    .order("email_date", { ascending: false })
    .limit(limit)
    .returns<GmailActivityRow[]>();

  if (error) {
    console.error("Error loading organized Gmail activity:", error);
    throw error;
  }

  return data ?? [];
}

/** All activity for one application, oldest first, for the timeline. */
export async function fetchActivityForApplication(
  supabase: SupabaseClient,
  userId: string,
  applicationId: string
): Promise<GmailActivityRow[]> {
  const { data, error } = await supabase
    .from("gmail_activity")
    .select("*")
    .eq("user_id", userId)
    .eq("application_id", applicationId)
    .order("email_date", { ascending: true });

  if (error) {
    console.error("Error loading application activity:", error);
    throw error;
  }

  return (data ?? []) as GmailActivityRow[];
}

/** Link activity rows to an application after the user approves an import. */
export async function linkActivityToApplication(
  supabase: SupabaseClient,
  userId: string,
  activityIds: string[],
  applicationId: string
): Promise<void> {
  if (activityIds.length === 0) return;

  const { error } = await supabase
    .from("gmail_activity")
    .update({ application_id: applicationId })
    .eq("user_id", userId)
    .in("id", activityIds);

  if (error) {
    console.error("Error linking Gmail activity to application:", error);
    throw error;
  }
}

/**
 * Detach activity rows from their application WITHOUT deleting any evidence.
 *
 * The "not mine" correction path: the ledger row survives, so a later re-scan
 * still sees the message as already processed and costs nothing, and the
 * evidence remains available to reconciliation.
 *
 * Pass `applicationId` to scope the update to one relationship, so a stale
 * client cannot unlink a row that has since been linked elsewhere. Idempotent:
 * a row that is already detached simply matches nothing.
 */
export async function unlinkActivityFromApplication(
  supabase: SupabaseClient,
  userId: string,
  activityIds: string[],
  applicationId?: string
): Promise<void> {
  if (activityIds.length === 0) return;

  let query = supabase
    .from("gmail_activity")
    .update({ application_id: null })
    .eq("user_id", userId)
    .in("id", activityIds);

  if (applicationId !== undefined) {
    query = query.eq("application_id", applicationId);
  }

  const { error } = await query;

  if (error) {
    console.error("Error unlinking Gmail activity from application:", error);
    throw error;
  }
}

/** Mark activity as reviewed-and-dismissed without linking it. */
export async function ignoreActivity(
  supabase: SupabaseClient,
  userId: string,
  activityIds: string[]
): Promise<void> {
  if (activityIds.length === 0) return;

  const { error } = await supabase
    .from("gmail_activity")
    .update({ category: "NOT_JOB_RELATED" })
    .eq("user_id", userId)
    .in("id", activityIds);

  if (error) {
    console.error("Error ignoring Gmail activity:", error);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Legacy re-gate (rows ledgered before the gate verdict was stored)
// ---------------------------------------------------------------------------

/**
 * A legacy ledger row, as the re-gate reads it.
 *
 * Deliberately narrow: the id to write back to, the message id to re-fetch, the
 * thread id (which the re-gate never touches, and which is read only so a test
 * can prove it was not touched), and the current category — needed because a
 * row that ends `weak` keeps the category it already had.
 */
export interface LegacyActivityRow {
  id: string;
  gmail_message_id: string;
  gmail_thread_id: string | null;
  category: EmailCategory;
}

const LEGACY_REGATE_COLUMNS = "id, gmail_message_id, gmail_thread_id, category";

/**
 * The re-gate predicate, applied identically by the fetch and the count below.
 *
 * It is written out in both statements — exactly as `fetchUnknownBucket` and
 * `countUnknownBucket` already do — because the two builders have different
 * result types and a shared generic wrapper would obscure them for no gain.
 * They must be read as one predicate and changed together.
 *
 * The predicate is NOT-STRONG AND UNLINKED, which is the definition of a stuck
 * row. It deliberately covers two populations:
 *
 *   `evidence_strength IS NULL` — pre-task-5.3 rows, ledgered before the gate
 *     verdict was stored.
 *
 *   `evidence_strength = 'weak'` — rows the CURRENT pipeline wrote. These were
 *     the real reason "Needs your input" never drained, and the reason a scan
 *     reported `application-related > 0, created 0` indefinitely. A weak row can
 *     never be auto-imported (`decideProposal` requires strong), can never be
 *     re-classified by a scan (`findProcessedMessageIds` deduplicates it away
 *     before any fetch), and — while this predicate matched only NULL — could
 *     never be re-gated either. It was stranded permanently, in all three
 *     directions at once.
 *
 * Most of those weak verdicts were an artefact of truncated input: the scan
 * fetched headers only, so the gate could not see lifecycle phrasing further down
 * the message. The re-gate re-fetches the whole message, so a genuine application
 * confirmation now resolves to `strong`, leaves this predicate, and is imported.
 *
 * Termination: a row that ends `strong` leaves via the strength test, and a row
 * the gate rejects is written back as NOT_JOB_RELATED and leaves via the category
 * test. A row that is genuinely still ambiguous stays `weak` and remains matched,
 * so callers order NULLs first (below) to exhaust never-gated rows before
 * re-examining ones already seen, and every caller is bounded per batch.
 *
 * `gmail_message_id NOT NULL` because a row with no message id cannot be
 * re-fetched from Gmail, so it can never be re-gated.
 *
 * `category <> 'NOT_JOB_RELATED'` is a DELIBERATE narrowing of that predicate,
 * and it is a safety rule rather than an optimization. "Ignore" sets a row's
 * category to NOT_JOB_RELATED and leaves its strength NULL, so an ignored row is
 * indistinguishable from a legacy row on strength alone. Re-gating it would
 * silently resurrect mail the user explicitly dismissed. Excluding the category
 * also guarantees the client's batch loop terminates: a row the gate rejects is
 * written back as NOT_JOB_RELATED with a NULL strength, which is exactly this
 * exclusion, so it leaves the predicate instead of being re-fetched forever.
 */

/**
 * One bounded, deterministically ordered batch of legacy rows to re-gate.
 *
 * Ordered by `id` ascending: stable across batches, so a client loop reads the
 * ledger in a fixed order and a row that could not be re-gated (a deleted Gmail
 * message) always reappears in the same place rather than shuffling the batch.
 */
export async function fetchLegacyActivityForRegate(
  supabase: SupabaseClient,
  userId: string,
  limit = 100
): Promise<LegacyActivityRow[]> {
  const { data, error } = await supabase
    .from("gmail_activity")
    .select(LEGACY_REGATE_COLUMNS)
    .eq("user_id", userId)
    // Not strong: never gated, or gated to weak. Both are stuck.
    .or("evidence_strength.is.null,evidence_strength.eq.weak")
    .is("application_id", null)
    .not("gmail_message_id", "is", null)
    .neq("category", "NOT_JOB_RELATED")
    // Never-gated rows first, so a bounded batch spends its Gmail fetches on rows
    // that have never been evaluated with a body before re-examining weak ones.
    .order("evidence_strength", { ascending: true, nullsFirst: true })
    .order("id", { ascending: true })
    .limit(limit)
    .returns<LegacyActivityRow[]>();

  if (error) {
    console.error("Error loading legacy Gmail activity to re-gate:", error);
    throw error;
  }

  return data ?? [];
}

/**
 * How many legacy rows are still waiting to be re-gated.
 *
 * A head count with the identical predicate, so the number the UI shows and the
 * rows the re-gate reads can never disagree. This is also what lets the client
 * loop know whether another batch is worth sending.
 */
export async function countLegacyActivityForRegate(
  supabase: SupabaseClient,
  userId: string
): Promise<number> {
  const { count, error } = await supabase
    .from("gmail_activity")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    // The IDENTICAL predicate the fetch above applies. Changed together, always.
    .or("evidence_strength.is.null,evidence_strength.eq.weak")
    .is("application_id", null)
    .not("gmail_message_id", "is", null)
    .neq("category", "NOT_JOB_RELATED");

  if (error) {
    console.error("Error counting legacy Gmail activity to re-gate:", error);
    throw error;
  }

  return count ?? 0;
}

/** The fields a re-gate may write back. Anything omitted is left as it is. */
export interface ActivityEvidencePatch {
  evidenceStrength?: StoredEvidenceStrength | null;
  evidenceReason?: EvidenceReason | null;
  category?: EmailCategory;
  company?: string | null;
  jobTitle?: string | null;
  jobUrl?: string | null;
  inferredStatus?: InferredStatus | null;
  confidence?: number | null;
}

/**
 * Write a gate verdict onto an EXISTING ledger row.
 *
 * UPDATE only — never an insert, never an upsert. That is the whole point: the
 * legacy rows are the user's history, and re-gating them must not delete,
 * duplicate, or re-create a single one. The statement is filtered by both row id
 * and `user_id`, so ownership is enforced in the statement and not only by RLS.
 *
 * The identity columns are deliberately not writable through this function:
 * `gmail_message_id` and `gmail_thread_id` are what make the row that message's
 * row, `application_id` belongs to the importer and the user's own decisions,
 * and `user_id` is ownership. A patch can only ever change what the gate
 * actually decided.
 */
export async function updateActivityEvidence(
  supabase: SupabaseClient,
  userId: string,
  activityId: string,
  patch: ActivityEvidencePatch
): Promise<void> {
  const row: Record<string, unknown> = {};

  if (patch.evidenceStrength !== undefined) {
    row.evidence_strength = patch.evidenceStrength;
  }
  if (patch.evidenceReason !== undefined) {
    row.evidence_reason = patch.evidenceReason;
  }
  if (patch.category !== undefined) row.category = patch.category;
  if (patch.company !== undefined) row.company = patch.company;
  if (patch.jobTitle !== undefined) row.job_title = patch.jobTitle;
  if (patch.jobUrl !== undefined) row.job_url = patch.jobUrl;
  if (patch.inferredStatus !== undefined) {
    row.inferred_status = patch.inferredStatus;
  }
  if (patch.confidence !== undefined) row.confidence = patch.confidence;

  if (Object.keys(row).length === 0) return;

  const { error } = await supabase
    .from("gmail_activity")
    .update(row)
    .eq("id", activityId)
    .eq("user_id", userId);

  if (error) {
    console.error("Error updating Gmail activity evidence:", error);
    throw error;
  }
}

/**
 * How many of these rows are still unlinked.
 *
 * The re-gate's honest "awaiting review" figure: after the Auto_Importer has run,
 * a re-gated row either belongs to an application or it does not, and the ledger
 * is the only place that knows which. Counting it here avoids attributing the
 * importer's own hold counters — which also cover rows this batch never touched —
 * to this batch's work.
 */
export async function countUnlinkedActivityByIds(
  supabase: SupabaseClient,
  userId: string,
  activityIds: string[]
): Promise<number> {
  if (activityIds.length === 0) return 0;

  const { count, error } = await supabase
    .from("gmail_activity")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("id", activityIds)
    .is("application_id", null);

  if (error) {
    console.error("Error counting unlinked Gmail activity:", error);
    throw error;
  }

  return count ?? 0;
}

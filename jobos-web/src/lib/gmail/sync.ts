/**
 * One bounded batch of the historical Gmail scan.
 *
 * SERVER ONLY.
 *
 * Bounded by design: each call processes at most BATCH_MESSAGE_LIMIT messages
 * or BATCH_TIME_BUDGET_MS of wall clock, then persists its cursor and returns.
 * The client drives the loop. That keeps every request well inside the route's
 * maxDuration, makes the scan resumable after a closed browser or a failed
 * request, and needs no cron, queue, or worker infrastructure.
 *
 * Cost funnel, in order — each stage must reduce volume before the next:
 *   Gmail q= narrowing -> ledger dedup -> metadata fetch -> deterministic
 *   parse -> heuristics -> AI only for ambiguous candidates
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { getValidAccessToken, forceRefreshAccessToken } from "./tokens.ts";
import {
  GmailApiError,
  GmailHistoryExpiredError,
  getMessageFull,
  getMessageMetadata,
  listHistory,
  listMessages,
} from "./client.ts";
import { buildGmailQuery, type HistoryRange } from "./query.ts";
import { parseGmailMessage, type ParsedEmail } from "./parse.ts";
import {
  companyFromDomain,
  evaluateEmailWithEvidence,
  sanitizeCompanyName,
  EMAIL_CATEGORIES,
  type EmailCategory,
} from "./heuristics.ts";
import type {
  EvidenceReason,
  EvidenceStrength,
} from "./applicationEvidence.ts";
import { resolveEmployer } from "./employer.ts";
import { inferStatusFromCategory } from "./statusInference.ts";
import {
  findProcessedMessageIds,
  insertGmailActivity,
  updateSyncJobProgress,
  type GmailActivityRecord,
  type GmailSyncJob,
  type StoredEvidenceStrength,
} from "../api/gmailActivity.ts";
import { runAutoImport } from "./autoImport.ts";
import { generateStructured, AiGatewayError } from "../ai/gateway.ts";
import {
  EMAIL_CLASSIFY_SYSTEM,
  buildEmailClassifyPrompt,
  type EmailClassifyInput,
} from "../ai/prompts.ts";
import { validateEmailClassification } from "../ai/schemas.ts";

/**
 * Ids requested per `messages.list` / `history.list` call.
 *
 * Previously this was the same constant as the processing limit (25), which
 * conflated two unrelated things. Gmail allows up to 500 ids per list call and
 * charges the same 5 quota units regardless, so listing 25 at a time meant
 * ~20x more list round-trips than necessary — and, worse, ~20x more
 * client->server request cycles, each paying Next.js routing, an auth
 * `getUser()`, a token read and several Supabase round-trips.
 */
export const GMAIL_LIST_PAGE_SIZE = 200;

/**
 * Messages fully processed per request.
 *
 * Independent of the list page size. When a page contains more fresh messages
 * than this, the cursor is deliberately NOT advanced and the remainder is
 * picked up by the next batch — safe because the ledger's
 * UNIQUE(user_id, gmail_message_id) makes re-listing a partially processed page
 * a no-op for anything already stored.
 */
export const BATCH_MESSAGE_LIMIT = 60;

/** Wall-clock budget per batch, well under the route's 60s maxDuration. */
export const BATCH_TIME_BUDGET_MS = 25_000;

/** Max ambiguous emails sent to the model in a single call. */
const AI_BATCH_SIZE = 10;

/**
 * Concurrent AI classification calls per batch.
 *
 * This was the single largest latency term: `classifyAmbiguous` awaited each
 * `generateStructured` call in sequence AND ran entirely outside the batch time
 * budget, so a batch could take far longer than the 15s it advertised. Each
 * call covers a disjoint set of emails, so they are independent and safe to
 * overlap. Bounded at 3 to stay within provider rate limits and to keep the
 * gateway's own retry/backoff behaviour meaningful.
 */
const AI_CONCURRENCY = 3;

/**
 * How many messages.get calls run concurrently within ONE batch.
 *
 * This is the actual fix for slow scans: metadata fetches were previously
 * awaited one at a time, so a batch's wall-clock time was (message count ×
 * Gmail round-trip latency) even though every fetch is for a different,
 * independent message id. Running them in bounded parallel chunks cuts that by
 * roughly this factor with no change to correctness:
 *  - the Gmail cursor (page_token) still only advances once, after the whole
 *    batch finishes, so there is still exactly one sequential cursor
 *  - dedup against gmail_activity still happens before any fetch
 *  - persistence still happens once, after all fetches complete
 * 5 is chosen to stay comfortably inside Gmail's 250 quota-units/user/second
 * limit (5 concurrent messages.get at 5 units each = 25 units in flight).
 */
const METADATA_FETCH_CONCURRENCY = 5;

/**
 * Wall clock that must still be left in the batch budget before the
 * Auto_Importer is allowed to start.
 *
 * The importer runs on the same request as the scan, after the scan has already
 * persisted everything and written its cursor, so skipping it costs nothing: the
 * unlinked evidence is still in the ledger and the next batch (or the next sync)
 * organizes it. Starting it with almost no budget left, on the other hand, would
 * push the request towards the route's maxDuration for no gain.
 */
export const AUTO_IMPORT_MIN_BUDGET_MS = 5_000;

/**
 * Proposals the Auto_Importer may apply in one batch.
 *
 * Each applied proposal is two user-scoped reads plus a write, so this is the
 * bound on how much database work a single scan request can add. Anything over
 * the cap is simply left unlinked for the next batch.
 */
export const AUTO_IMPORT_BATCH_CAP = 50;

/** Whether the Auto_Importer may run in this batch, and with what cap. */
export interface AutoImportPlan {
  run: boolean;
  maxProposals: number;
}

/**
 * Decide whether the batch has enough budget left to organize applications.
 *
 * Pure, and measured against the same `BATCH_TIME_BUDGET_MS` the fetch and AI
 * stages use, so there is one budget for the whole request rather than a second
 * private one for the importer.
 */
export function resolveAutoImportPlan(args: {
  elapsedMs: number;
}): AutoImportPlan {
  const remainingMs = BATCH_TIME_BUDGET_MS - args.elapsedMs;

  return {
    run: remainingMs > AUTO_IMPORT_MIN_BUDGET_MS,
    maxProposals: AUTO_IMPORT_BATCH_CAP,
  };
}

/**
 * What the Auto_Importer contributed to this batch's result.
 *
 * The counters beyond created/updated are reported because their absence is what
 * made "28 application-related, 0 created" impossible to explain from the
 * outside. `examined === 0` means no unlinked lifecycle evidence was even read;
 * `held*` means evidence was read and deliberately not acted on; `proposalsFailed`
 * means writes were attempted and rejected. Those are three completely different
 * situations that all used to surface as a bare 0.
 */
export interface BatchAutoImportOutcome {
  applicationsCreated: number;
  applicationsUpdated: number;
  /** Proposals the importer considered. Zero means nothing qualified to read. */
  examined: number;
  /** Evidence attached to an existing application. */
  linked: number;
  heldAmbiguous: number;
  heldUnknownEmployer: number;
  /** Proposals whose write was attempted and failed. */
  proposalsFailed: number;
  /** True when the importer itself threw and was absorbed. */
  failed: boolean;
}

/** A run in which the importer contributed nothing, for the skip/failure paths. */
const NO_AUTO_IMPORT: BatchAutoImportOutcome = {
  applicationsCreated: 0,
  applicationsUpdated: 0,
  examined: 0,
  linked: 0,
  heldAmbiguous: 0,
  heldUnknownEmployer: 0,
  proposalsFailed: 0,
  failed: false,
};

/**
 * Run the Auto_Importer for one batch and absorb anything it throws.
 *
 * Total by construction: it never rejects, so the scan's own result — cursor,
 * ledger counts, error taxonomy — cannot be changed by the importer. A failure
 * leaves both counts at 0 and the evidence unlinked, which is exactly the state
 * the next run retries from.
 *
 * The runner is injected so the wiring itself (budget skip, cap pass-through,
 * failure absorption) is testable without a Gmail or Supabase harness.
 */
export async function runBatchAutoImport(
  plan: AutoImportPlan,
  run: (maxProposals: number) => Promise<{
    created: number;
    updated: number;
    examined?: number;
    linked?: number;
    heldAmbiguous?: number;
    heldUnknownEmployer?: number;
    failed?: number;
  }>
): Promise<BatchAutoImportOutcome> {
  if (!plan.run) return { ...NO_AUTO_IMPORT };

  try {
    const result = await run(plan.maxProposals);
    return {
      applicationsCreated: result.created,
      applicationsUpdated: result.updated,
      examined: result.examined ?? 0,
      linked: result.linked ?? 0,
      heldAmbiguous: result.heldAmbiguous ?? 0,
      heldUnknownEmployer: result.heldUnknownEmployer ?? 0,
      // `AutoImportResult.failed` counts per-proposal write failures, which are
      // absorbed individually inside the importer and would otherwise be
      // invisible: a batch where every insert was rejected looked exactly like a
      // batch where nothing qualified.
      proposalsFailed: result.failed ?? 0,
      failed: false,
    };
  } catch (error: unknown) {
    // Reason codes and error messages only — never email content.
    console.error(
      "[gmail/sync] Auto import failed; scan results were kept:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { ...NO_AUTO_IMPORT, failed: true };
  }
}

/**
 * Run `fn` over `items` with at most `limit` calls in flight at once,
 * preserving input order in the returned array.
 *
 * Exported so the concurrency bound itself is directly testable — an unbounded
 * `Promise.all` over a whole page would breach Gmail's per-user rate limit.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index]);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}

/**
 * Outcome of the deterministic classification stage for one batch.
 *
 * `records` are ready to insert; `ambiguous` is exactly the set the model is
 * allowed to see. Every parsed email lands in precisely one of the two, so the
 * two sets are a partition of the batch and nothing can be silently dropped.
 */
export interface ClassificationResult {
  records: GmailActivityRecord[];
  ambiguous: ParsedEmail[];
  /**
   * The gate reason that made each ambiguous message ambiguous, by Gmail message
   * id.
   *
   * The gate is evaluated once per message, here. An ambiguous message is stored
   * later — after the model answers, or after the AI stage is skipped — and the
   * row still has to carry the reason code that escalated it. Carrying it in a
   * side map keeps `ambiguous` a plain `ParsedEmail[]`, which is exactly what
   * the AI stage is allowed to see.
   */
  ambiguousReasons: Map<string, EvidenceReason>;
  /** Emails the heuristic layer accepted as candidates, ambiguous ones included. */
  candidates: number;
}

/**
 * The gate's verdict as the ledger stores it.
 *
 * `none` becomes NULL: the Sprint 9 CHECK allows only NULL / 'strong' / 'weak',
 * and NULL is what every pre-migration row carries. The reason code is stored
 * either way, so a rejection is still fully explained — and still ledgered, so a
 * re-scan never re-examines it.
 *
 * Exported so the legacy re-gate path writes the verdict back through the SAME
 * mapping the scan uses, rather than keeping a second copy of it. There is one
 * place in the codebase that decides how a gate strength becomes a stored
 * strength, and this is it.
 */
export function storedStrength(
  strength: EvidenceStrength
): StoredEvidenceStrength | null {
  return strength === "none" ? null : strength;
}

const EMAIL_CATEGORY_SET: ReadonlySet<string> = new Set(EMAIL_CATEGORIES);

/**
 * True only for a string that is already in the shared category vocabulary.
 *
 * The AI schema validates the category too, but this is the pipeline's own
 * boundary check: a category reaches the ledger through a type guard rather than
 * through a cast, so no model-supplied string can ever be written to the
 * `category` column on trust alone.
 */
function isEmailCategory(value: string): value is EmailCategory {
  return EMAIL_CATEGORY_SET.has(value);
}

/**
 * Step 4 of the funnel, extracted verbatim: apply the heuristic layer to each
 * parsed email and split the batch into rows to store and emails to ask the
 * model about.
 *
 * Pure — no network, no AI, no database — so the partition invariant is
 * directly testable. Nulls (messages whose metadata fetch failed and was
 * skipped) carry no message id and contribute to neither set.
 */
/**
 * A ledger row for a message the gate resolved DETERMINISTICALLY.
 *
 * Extracted so the metadata pass and the body-escalation pass below build an
 * identical row from an identical verdict. There is one place in this file that
 * turns a gate verdict into a candidate row, which is what stops the two passes
 * drifting into storing different things for the same evidence.
 *
 * This is the only shape that may carry `"strong"`, because the gate is the only
 * authority that produces it.
 */
function deterministicActivityRecord(
  email: ParsedEmail,
  connectionId: string | null,
  verdict: { category: EmailCategory | null; confidence: number | null },
  evidence: { strength: EvidenceStrength; reason: EvidenceReason }
): GmailActivityRecord {
  const category = verdict.category ?? "OTHER_JOB_RELATED";

  return {
    gmailMessageId: email.gmailMessageId,
    gmailThreadId: email.gmailThreadId,
    connectionId,
    category,
    // Content first, sender domain second. A portal-relayed confirmation names
    // the employer in its subject or body while its domain names only the portal,
    // and `companyFromDomain` correctly refuses a portal — so relying on the
    // domain alone left every portal application with no employer, which
    // `decideProposal` then held instead of creating. `resolveEmployer` reads the
    // name that is actually there; `sanitizeCompanyName` inside it still refuses
    // the platform, so nothing is invented.
    company: resolveEmployer(email, companyFromDomain(email.senderRootDomain)),
    jobTitle: null,
    jobUrl: email.jobUrl,
    location: null,
    emailDate: email.emailDate,
    sender: email.sender,
    senderDomain: email.senderRootDomain,
    inferredStatus: inferStatusFromCategory(category),
    confidence: verdict.confidence,
    evidenceStrength: storedStrength(evidence.strength),
    evidenceReason: evidence.reason,
  };
}

export function classifyParsedEmails(
  emails: readonly (ParsedEmail | null)[],
  connectionId: string | null
): ClassificationResult {
  const records: GmailActivityRecord[] = [];
  const ambiguous: ParsedEmail[] = [];
  const ambiguousReasons = new Map<string, EvidenceReason>();
  let candidates = 0;

  for (const email of emails) {
    // The gate runs exactly once per message, here, and its verdict is carried
    // forward from this point on — never re-derived from the email text.
    if (email === null) continue;

    const { evidence, verdict } = evaluateEmailWithEvidence(email);

    if (!verdict.candidate) {
      // A job ALERT/recommendation is real job-related mail, but it is NOT
      // evidence the user applied — so it is stored under its own
      // `JOB_OPPORTUNITY` category rather than as NOT_JOB_RELATED. The gate's own
      // verdict is unchanged (strength `none`, not a candidate), so this row can
      // never be a lifecycle event, never auto-imported, and never a KPI; it is
      // simply countable separately. Everything else the gate excluded stays
      // NOT_JOB_RELATED.
      const rejectionCategory: EmailCategory =
        evidence.reason === "excluded_job_alert"
          ? "JOB_OPPORTUNITY"
          : "NOT_JOB_RELATED";

      // Recorded so a re-sync never re-examines it. Costs one row, saves a
      // fetch and a possible AI call every future run. The reason code is what
      // makes that row auditable: it says WHY the message was rejected without
      // storing a single word of the message.
      records.push({
        gmailMessageId: email.gmailMessageId,
        gmailThreadId: email.gmailThreadId,
        connectionId,
        category: rejectionCategory,
        company: null,
        jobTitle: null,
        jobUrl: null,
        location: null,
        emailDate: email.emailDate,
        sender: email.sender,
        senderDomain: email.senderRootDomain,
        inferredStatus: null,
        confidence: verdict.confidence,
        evidenceStrength: storedStrength(evidence.strength),
        evidenceReason: evidence.reason,
      });
      continue;
    }

    candidates += 1;

    if (verdict.needsAI) {
      ambiguous.push(email);
      ambiguousReasons.set(email.gmailMessageId, evidence.reason);
      continue;
    }

    // Free, deterministic classification: the gate resolved a lifecycle stage
    // itself, so this is the only path that may store "strong".
    records.push(
      deterministicActivityRecord(email, connectionId, verdict, evidence)
    );
  }

  return { records, ambiguous, ambiguousReasons, candidates };
}

/**
 * Messages re-fetched WITH their body per batch, to settle an ambiguous verdict.
 *
 * Bounded because a full fetch returns the whole MIME tree, which is the dominant
 * payload cost in the pipeline. The Gmail quota charge is identical to a metadata
 * fetch (5 units), so this bound is about bandwidth and latency, not quota.
 */
export const BODY_ESCALATION_LIMIT = 40;

/** What the body-escalation pass resolved. */
export interface BodyEscalationOutcome {
  /** Rows the fuller input settled deterministically. May carry `"strong"`. */
  records: GmailActivityRecord[];
  /** Messages still ambiguous, to be sent to the model. */
  ambiguous: ParsedEmail[];
  /** Escalation reasons for the messages still ambiguous. */
  ambiguousReasons: Map<string, EvidenceReason>;
  /** Messages re-fetched with a body. */
  escalated: number;
  /** Of those, how many the gate then resolved without the model. */
  resolved: number;
}

/**
 * Re-gate ambiguous messages against their FULL body.
 *
 * THE DEFECT THIS CLOSES — the cause of "97 processed, 28 application-related,
 * 0 created, 0 updated".
 *
 * The scan fetched every message with `getMessageMetadata`, i.e. Gmail's
 * `format=metadata`, which returns headers and the ~200-character snippet and NO
 * body parts. `parseGmailMessage` says so itself: `bodyText` is documented
 * "Empty for metadata-only fetches". The Evidence Gate searches
 * subject + snippet + bodyText, so it was reading a truncated message.
 *
 * That matters because the gate only returns `"strong"` on a lifecycle pattern
 * match, and real lifecycle phrasing — "Thank you for applying", "we have
 * received your application", "we regret to inform you" — very often sits below
 * the snippet, past a greeting, a logo table, or a tracking header. With no body:
 *
 *   no lifecycle match -> not strong -> `needsAI` -> stored `weak` with whatever
 *   category the model returned, commonly OTHER_JOB_RELATED
 *   -> `fetchLifecycleActivityForAutoImport` filters on Lifecycle_Categories, so
 *      the row is not even read
 *   -> `runAutoImport` returns at `rows.length === 0`
 *   -> created 0, updated 0, and no error, because nothing failed.
 *
 * `client.ts` has always exported `getMessageFull` for exactly this escalation —
 * its own docstring reserves it for "messages that survived heuristics and still
 * could not be classified from metadata alone" — but it had NO callers. The
 * escalation was designed and never wired. This is that wire.
 *
 * Deliberately NOT a widening of what counts as an application. The same gate
 * decides, on the same rules; it is simply given the input it was written to
 * read. A message with no lifecycle evidence in its body stays ambiguous and
 * still goes to the model, and still cannot create an application.
 *
 * `fetchFull` is injected so the pass is testable without Gmail. A fetch that
 * fails returns null and the message stays ambiguous — a re-fetch problem must
 * never lose a message.
 */
export async function escalateAmbiguousWithBody(args: {
  ambiguous: readonly ParsedEmail[];
  ambiguousReasons: ReadonlyMap<string, EvidenceReason>;
  connectionId: string | null;
  fetchFull: (messageId: string) => Promise<ParsedEmail | null>;
  concurrency?: number;
  maxMessages?: number;
}): Promise<BodyEscalationOutcome> {
  const limit = args.maxMessages ?? BODY_ESCALATION_LIMIT;
  const escalating = args.ambiguous.slice(0, limit);
  // Anything over the cap keeps its metadata verdict and goes to the model, so a
  // large batch degrades in cost rather than in correctness.
  const deferred = args.ambiguous.slice(limit);

  const records: GmailActivityRecord[] = [];
  const stillAmbiguous: ParsedEmail[] = [];
  const reasons = new Map<string, EvidenceReason>();

  const carry = (email: ParsedEmail) => {
    stillAmbiguous.push(email);
    const reason = args.ambiguousReasons.get(email.gmailMessageId);
    if (reason) reasons.set(email.gmailMessageId, reason);
  };

  const settled = await mapWithConcurrency(
    escalating,
    args.concurrency ?? METADATA_FETCH_CONCURRENCY,
    async (email) => {
      const full = await fetchFull(args.fetchFull, email);
      if (full === null) return { email, record: null };

      // The gate runs once more, on the fuller input. Its answer replaces the
      // metadata answer entirely — including its reason code, which now
      // describes what was actually read.
      const { evidence, verdict } = evaluateEmailWithEvidence(full);

      // Only a decisive candidate verdict produces a row here. A rejection is
      // left alone: the metadata pass already declined to reject this message,
      // and a body-driven rejection is the model's call, not a silent drop.
      if (!verdict.candidate || verdict.needsAI) {
        return { email, record: null };
      }

      return {
        email,
        record: deterministicActivityRecord(
          full,
          args.connectionId,
          verdict,
          evidence
        ),
      };
    }
  );

  for (const { email, record } of settled) {
    if (record === null) carry(email);
    else records.push(record);
  }

  for (const email of deferred) carry(email);

  return {
    records,
    ambiguous: stillAmbiguous,
    ambiguousReasons: reasons,
    escalated: escalating.length,
    resolved: records.length,
  };
}

/** Re-fetch one message with its body, absorbing any failure as "unavailable". */
async function fetchFull(
  fetcher: (messageId: string) => Promise<ParsedEmail | null>,
  email: ParsedEmail
): Promise<ParsedEmail | null> {
  try {
    return await fetcher(email.gmailMessageId);
  } catch {
    // The metadata verdict still stands and the message stays ambiguous.
    return null;
  }
}

/**
 * The three distinct facts about what a listing produced, plus the cursor rule
 * that follows from them.
 *
 * These are deliberately three separate numbers because they answer three
 * different questions, and collapsing them was the reporting bug: a scan that
 * lists 2,272 messages and finds every one of them already ledgered did real
 * work (it read a page of Gmail and proved there is nothing new) yet reported
 * "0 messages", which reads as "Gmail is empty".
 */
export interface ListingSummary {
  /** Listed ids this user has already ledgered. */
  deduplicated: number;
  /** Ids this batch will actually process, after the per-batch cap. */
  fresh: number;
  /**
   * True when every fresh id on this page is being processed now, which is the
   * only condition under which the page cursor may advance.
   */
  pageFullyProcessed: boolean;
}

/**
 * Step 2 of the funnel as arithmetic: turn "what Gmail listed" and "what the
 * ledger already had" into the batch's fresh count and the cursor rule.
 *
 * Pure — no Supabase, no Gmail, no Date, no network — so the accounting that
 * drives both the cursor hold-back and everything the user is told is directly
 * testable. `findProcessedMessageIds` is called with exactly the listed ids, so
 * `listed` and `alreadyProcessed` are always measured over the same set.
 */
export function summarizeListing(args: {
  listed: number;
  alreadyProcessed: number;
  batchLimit: number;
}): ListingSummary {
  const deduplicated = args.alreadyProcessed;
  const allFresh = args.listed - args.alreadyProcessed;
  // Process at most `batchLimit` of them. If the page holds more, the cursor is
  // held back so the remainder is handled next batch. Re-listing the same page
  // is cheap and the ledger makes reprocessing a no-op.
  const fresh = Math.min(allFresh, args.batchLimit);

  return { deduplicated, fresh, pageFullyProcessed: fresh === allFresh };
}

/** The cursor decision for one batch: where to resume, and whether to stop. */
export interface CursorResolution {
  pageToken: string | null;
  done: boolean;
}

/**
 * Step 6 of the funnel, extracted verbatim: decide the stored cursor for the
 * next batch.
 *
 * Cursor safety: only advance past this page once every fresh message in it has
 * been processed. Holding the cursor back re-lists the page next batch, which
 * the ledger dedup then reduces to just the unprocessed remainder — so nothing
 * is skipped and nothing is processed twice.
 */
export function resolveNextCursor(args: {
  pageFullyProcessed: boolean;
  nextPageToken: string | null;
  storedPageToken: string | null;
}): CursorResolution {
  const pageToken = args.pageFullyProcessed
    ? args.nextPageToken
    : args.storedPageToken;

  return {
    pageToken,
    done: args.pageFullyProcessed && args.nextPageToken === null,
  };
}

export interface BatchResult {
  done: boolean;
  pageToken: string | null;
  /**
   * Ids Gmail returned for THIS batch's page, before any dedup.
   *
   * The only number that can distinguish "Gmail matched nothing in this window"
   * from "Gmail matched plenty and we had already read all of it". `messagesSeen`
   * cannot: it is counted after dedup, so both cases collapse to 0 there.
   */
  messagesListed: number;
  /** How many of `messagesListed` were already in this user's ledger. */
  messagesDeduplicated: number;
  /**
   * Ids this batch actually processed: the fresh remainder after dedup, capped
   * at BATCH_MESSAGE_LIMIT. Per batch, unlike the cumulative `messagesSeen`.
   */
  messagesFresh: number;
  /** Cumulative fresh messages across the whole job, unchanged. */
  messagesSeen: number;
  /**
   * Whether every fresh message on this page was processed, straight from
   * `summarizeListing`.
   *
   * Surfaced rather than left implicit so a caller can tell "the window is still
   * being walked" from "this page is done" WITHOUT recomputing
   * `fresh === listed - deduplicated` for itself. The cursor rule already depends
   * on this value; exposing it keeps that arithmetic in exactly one place.
   */
  pageFullyProcessed: boolean;
  candidates: number;
  classified: number;
  activityInserted: number;
  /**
   * Applications the Auto_Importer created, and existing ones whose status it
   * advanced, during this batch.
   *
   * Reported by the same object that reports what was ledgered, because both
   * happen on the same request: the importer runs after persistence, inside the
   * remaining time budget. Both stay 0 when the budget was already spent or the
   * importer failed — a scan never reports work it did not do.
   */
  applicationsCreated: number;
  applicationsUpdated: number;
  /**
   * The importer's full outcome, so a zero is always explainable.
   *
   * Without this, `created: 0` covered three unrelated situations: no unlinked
   * lifecycle evidence was read at all, evidence was read and deliberately held,
   * or writes were attempted and rejected. That ambiguity is what hid the
   * body-less-input defect for as long as it did.
   */
  autoImport: BatchAutoImportOutcome;
  /** Ambiguous messages re-fetched with their body so the gate could re-decide. */
  bodyEscalated: number;
  /** Of those, how many the gate then resolved without a model call. */
  bodyResolved: number;
  /**
   * How many rows this batch ledgered under each evidence reason code, plus
   * `unrecorded` for any row with no reason.
   *
   * This is the precision audit at batch granularity — the same tally
   * `countEvidenceByReason` computes over the whole ledger, for just this batch,
   * without a second read. Reason codes are a fixed vocabulary, never email text.
   */
  evidenceReasonCounts: Record<string, number>;
  /**
   * New anchor reported by Gmail, present only on the final batch. The caller
   * promotes it to the connection once the whole scan is complete.
   */
  historyId: string | null;
  /** Non-fatal, user-safe note (e.g. AI unavailable, results still saved). */
  notice: string | null;
}

/** Tally the reason codes of the rows this batch wrote. */
function tallyEvidenceReasons(
  records: readonly GmailActivityRecord[]
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const record of records) {
    // Same "unrecorded" bucket name the ledger-wide tally uses, so a batch
    // tally and a ledger tally are directly comparable.
    const key = record.evidenceReason ?? "unrecorded";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/**
 * Ask the model to classify only the emails heuristics could not resolve.
 *
 * A gateway failure is deliberately NOT fatal: deterministic results from this
 * batch are still persisted, the ambiguous ones are recorded as
 * OTHER_JOB_RELATED, and the user keeps their progress.
 */
async function classifyAmbiguous(
  emails: ParsedEmail[]
): Promise<Map<string, { category: EmailCategory; company: string | null; jobTitle: string | null; location: string | null; jobUrl: string | null; confidence: number }>> {
  const resolved = new Map<
    string,
    {
      category: EmailCategory;
      company: string | null;
      jobTitle: string | null;
      location: string | null;
      jobUrl: string | null;
      confidence: number;
    }
  >();

  if (emails.length === 0) return resolved;

  // Split into disjoint slices first, then classify the slices concurrently.
  // Each slice covers a different set of emails, so there is no ordering
  // dependency and no risk of double-charging: one AI call per slice, exactly
  // as before — the calls simply overlap instead of queueing.
  const slices: ParsedEmail[][] = [];
  for (let start = 0; start < emails.length; start += AI_BATCH_SIZE) {
    slices.push(emails.slice(start, start + AI_BATCH_SIZE));
  }

  const sliceResults = await mapWithConcurrency(
    slices,
    AI_CONCURRENCY,
    async (slice) => {
      // Correlate by opaque index, never by Gmail message id: the id must not
      // be sent to a third-party provider.
      const idToEmail = new Map<string, ParsedEmail>();
      const inputs: EmailClassifyInput[] = slice.map((email, index) => {
        const opaqueId = `e${index}`;
        idToEmail.set(opaqueId, email);
        return {
          id: opaqueId,
          subject: email.subject,
          senderDomain: email.senderRootDomain,
          // Snippet only. Full bodies are never sent.
          excerpt: email.snippet,
        };
      });

      const result = await generateStructured({
        systemPrompt: EMAIL_CLASSIFY_SYSTEM,
        userContent: buildEmailClassifyPrompt(inputs),
        task: "lightweight",
        validate: validateEmailClassification,
        label: "gmail_classify",
      });

      return { idToEmail, results: result.value.results };
    }
  );

  for (const { idToEmail, results } of sliceResults) {
    for (const entry of results) {
      const email = idToEmail.get(entry.id);
      if (!email) continue; // model echoed an id we never sent; ignore it.

      // Re-gate the category against the shared vocabulary. Anything else is
      // dropped rather than coerced, and the caller's OTHER_JOB_RELATED
      // fallback applies, so an off-vocabulary reply costs review instead of
      // writing an unknown category to the ledger.
      if (!isEmailCategory(entry.category)) continue;

      resolved.set(email.gmailMessageId, {
        category: entry.category,
        company: entry.company,
        jobTitle: entry.jobTitle,
        location: entry.location,
        jobUrl: entry.jobUrl,
        confidence: entry.confidence,
      });
    }
  }

  return resolved;
}

/**
 * The reference instant a full scan's query must be built against: the job's
 * OWN stored window end, not "now".
 *
 * Every batch of one scan continues a Gmail page token that was minted against
 * the query the first batch issued. `buildGmailQuery` defaults its `now` to the
 * current clock, so a multi-batch scan that crossed midnight (or any day
 * boundary) issued a query with different `after:`/`before:` bounds while
 * continuing a cursor that belongs to the previous query. Deriving the instant
 * from `windowEnd` — which `resolveWindow` then turns back into the same
 * `start = end - days` pair the job was created with — makes the query identical
 * for every batch of one scan.
 *
 * Returns null for bounds that cannot be parsed, so the caller falls back to the
 * previous behaviour rather than throwing: a slightly shifted window is a far
 * smaller problem than a failed scan.
 */
export function resolveJobQueryInstant(windowEnd: string): Date | null {
  // Stored as `YYYY-MM-DD`; pinned to UTC midnight so the instant is machine
  // independent, exactly like `toGmailDate`.
  const parsed = Date.parse(`${windowEnd}T00:00:00.000Z`);
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}

/**
 * Process one batch of the scan.
 *
 * Never throws for transient Gmail trouble: it persists what it achieved and
 * lets the caller retry the same cursor. Only unrecoverable conditions
 * (reconnect required) propagate.
 */
export async function runSyncBatch(
  supabase: SupabaseClient,
  userId: string,
  job: GmailSyncJob,
  range: HistoryRange = "6m"
): Promise<BatchResult> {
  const startedAt = Date.now();
  let notice: string | null = null;

  let accessToken = await getValidAccessToken(supabase, userId);

  const isIncremental = job.syncMode === "incremental";

  // ---- 1. List ids for this page (no content, cheap) --------------------
  //
  // Two modes share everything downstream:
  //  - full:        query-narrowed messages.list over the date window
  //  - incremental: history.list for messages added since the stored anchor,
  //                 which is proportional to what CHANGED rather than to the
  //                 size of the mailbox
  let page: {
    messages: { id: string; threadId: string }[];
    nextPageToken: string | null;
    historyId?: string | null;
  };

  const listPage = async () => {
    if (isIncremental) {
      if (!job.startHistoryId) {
        throw new GmailHistoryExpiredError(
          "Incremental sync started without an anchor."
        );
      }
      return listHistory(accessToken, {
        startHistoryId: job.startHistoryId,
        pageToken: job.pageToken ?? undefined,
        maxResults: GMAIL_LIST_PAGE_SIZE,
      });
    }

    // The job's own window end is the reference instant, so batch 2 of a scan
    // that started yesterday still lists the page its cursor belongs to. An
    // unparseable bound resolves to null and `buildGmailQuery` falls back to the
    // clock, which is exactly the previous behaviour.
    const queryInstant = resolveJobQueryInstant(job.windowEnd);

    return listMessages(accessToken, {
      query: buildGmailQuery({
        range,
        ...(queryInstant ? { now: queryInstant } : {}),
      }),
      pageToken: job.pageToken ?? undefined,
      maxResults: GMAIL_LIST_PAGE_SIZE,
    });
  };

  try {
    page = await listPage();
  } catch (error: unknown) {
    if (error instanceof GmailApiError && error.kind === "unauthorized") {
      // Stored expiry claimed the token was fine; Gmail disagreed. Refresh
      // once, retry once, then give up for this batch.
      accessToken = await forceRefreshAccessToken(supabase, userId);
      page = await listPage();
    } else {
      throw error;
    }
  }

  const messageRefs = page.messages;

  // ---- 2. Ledger dedup BEFORE any fetch or AI spend ---------------------
  const alreadyProcessed = await findProcessedMessageIds(
    supabase,
    userId,
    messageRefs.map((ref) => ref.id)
  );

  // All of the batch's accounting comes from one pure helper, so the numbers the
  // cursor rule uses and the numbers the user is shown cannot drift apart.
  const listing = summarizeListing({
    listed: messageRefs.length,
    alreadyProcessed: alreadyProcessed.size,
    batchLimit: BATCH_MESSAGE_LIMIT,
  });

  const fresh = messageRefs
    .filter((ref) => !alreadyProcessed.has(ref.id))
    .slice(0, listing.fresh);
  const pageFullyProcessed = listing.pageFullyProcessed;

  // ---- 3. Metadata fetch (bounded concurrency) --------------------------
  //
  // Each messages.get is for a distinct, independent message id, so there is
  // no ordering dependency between them. Fetching METADATA_FETCH_CONCURRENCY
  // at a time is the main speed fix for this batch: it was previously one
  // fetch at a time, making batch latency scale linearly with message count
  // instead of with round-trips. The Gmail page cursor still only advances
  // once per whole batch, after this step and persistence complete, so
  // resumability and idempotency are unaffected.
  //
  // A 401 during this phase refreshes the token once and retries that single
  // fetch; any other failure drops just that message so one bad email cannot
  // fail the whole batch.
  let refreshedDuringFetch = false;

  const fetchOne = async (
    ref: { id: string; threadId: string }
  ): Promise<ParsedEmail | null> => {
    try {
      const message = await getMessageMetadata(accessToken, ref.id);
      return parseGmailMessage(message);
    } catch (error: unknown) {
      if (
        error instanceof GmailApiError &&
        error.kind === "unauthorized" &&
        !refreshedDuringFetch
      ) {
        // Refresh once for the whole batch, not once per message: concurrent
        // fetches would otherwise all race a refresh independently.
        refreshedDuringFetch = true;
        accessToken = await forceRefreshAccessToken(supabase, userId);
      }

      try {
        const message = await getMessageMetadata(accessToken, ref.id);
        return parseGmailMessage(message);
      } catch {
        // Retried once and still failing. Skip this message rather than
        // failing the whole scan; it will be retried on the next sync.
        return null;
      }
    }
  };

  // Respect the time budget for the fetch phase as a whole, not per message:
  // concurrent fetches make a per-message check meaningless.
  const withinBudget = Date.now() - startedAt <= BATCH_TIME_BUDGET_MS;
  const parsedEmails = withinBudget
    ? await mapWithConcurrency(fresh, METADATA_FETCH_CONCURRENCY, fetchOne)
    : [];

  if (!withinBudget) {
    notice = "Batch paused early to stay responsive; progress was saved.";
  }

  // ---- 4. Deterministic parse + heuristics (fast, in-memory, sequential) -
  const classification = classifyParsedEmails(parsedEmails, job.connectionId);
  const records = classification.records;
  const candidates = classification.candidates;

  // ---- 4b. Body escalation for ambiguous messages -----------------------
  //
  // The metadata fetch above carries no body, so the Evidence Gate has only
  // subject + snippet to work with and cannot see lifecycle phrasing that sits
  // further down the message. Re-fetch just the ambiguous ones WITH their body
  // and let the same gate decide again. This is what turns a genuine
  // "Thank you for applying" into strong lifecycle evidence — and therefore into
  // an application — instead of an OTHER_JOB_RELATED row the importer never reads.
  //
  // Only the ambiguous subset pays the larger payload; anything the gate already
  // resolved from metadata is untouched.
  let ambiguous = classification.ambiguous;
  let ambiguousReasons: ReadonlyMap<string, EvidenceReason> =
    classification.ambiguousReasons;
  let bodyEscalated = 0;
  let bodyResolved = 0;

  if (ambiguous.length > 0 && Date.now() - startedAt < BATCH_TIME_BUDGET_MS) {
    const escalation = await escalateAmbiguousWithBody({
      ambiguous,
      ambiguousReasons,
      connectionId: job.connectionId,
      fetchFull: async (messageId) => {
        const message = await getMessageFull(accessToken, messageId);
        return parseGmailMessage(message);
      },
    });

    records.push(...escalation.records);
    ambiguous = escalation.ambiguous;
    ambiguousReasons = escalation.ambiguousReasons;
    bodyEscalated = escalation.escalated;
    bodyResolved = escalation.resolved;
  }

  /**
   * The reason code that escalated this message, reused verbatim on the row.
   *
   * Every ambiguous message was put in `ambiguousReasons` by the same pass that
   * produced it, so this is a lookup, not a re-decision — the AI paths below
   * never invent a reason code of their own.
   */
  const escalationReason = (email: ParsedEmail): EvidenceReason | null =>
    ambiguousReasons.get(email.gmailMessageId) ?? null;

  // ---- 5. AI only for what heuristics could not decide ------------------
  //
  // The AI stage is now INSIDE the time budget. Previously it ran after the
  // only budget check, so a batch advertising a 15s bound could spend far
  // longer here — the main reason observed batches took ~47s. When the budget
  // is already spent, the ambiguous emails are recorded as OTHER_JOB_RELATED
  // and remain fully reviewable; they are not dropped and not silently skipped.
  let classified = 0;
  const budgetLeftForAi = Date.now() - startedAt < BATCH_TIME_BUDGET_MS;

  if (ambiguous.length > 0 && !budgetLeftForAi) {
    notice =
      "Some emails were saved for review without automatic analysis to keep the scan responsive.";
    for (const email of ambiguous) {
      records.push({
        gmailMessageId: email.gmailMessageId,
        gmailThreadId: email.gmailThreadId,
        connectionId: job.connectionId,
        category: "OTHER_JOB_RELATED",
        company: companyFromDomain(email.senderRootDomain),
        jobTitle: null,
        jobUrl: email.jobUrl,
        location: null,
        emailDate: email.emailDate,
        sender: email.sender,
        senderDomain: email.senderRootDomain,
        inferredStatus: null,
        confidence: null,
        // The gate's own verdict was weak, and skipping the model cannot make
        // it any stronger. The row stays reviewable and never auto-importable.
        evidenceStrength: "weak",
        evidenceReason: escalationReason(email),
      });
    }
  } else if (ambiguous.length > 0) {
    try {
      const aiResults = await classifyAmbiguous(ambiguous);
      classified = aiResults.size;

      for (const email of ambiguous) {
        const result = aiResults.get(email.gmailMessageId);
        // Already re-gated against the vocabulary inside `classifyAmbiguous`;
        // an unusable or missing answer falls back to review.
        const category: EmailCategory = result?.category ?? "OTHER_JOB_RELATED";

        // The AI-supplied company is sanitized before it can ever be stored:
        // the system prompt instructs the model never to name the sending
        // platform as the employer, but a weaker fallback provider is not
        // guaranteed to obey that, and this is the deterministic backstop for
        // when it doesn't. Falling back to companyFromDomain (which already
        // refuses ATS/portal domains) rather than fabricating a value.
        const aiCompany = sanitizeCompanyName(
          result?.company ?? null,
          email.senderRootDomain
        );

        records.push({
          gmailMessageId: email.gmailMessageId,
          gmailThreadId: email.gmailThreadId,
          connectionId: job.connectionId,
          category,
          company: aiCompany ?? companyFromDomain(email.senderRootDomain),
          jobTitle: result?.jobTitle ?? null,
          // Deterministic URL wins: it came from the message, not a model.
          jobUrl: email.jobUrl ?? result?.jobUrl ?? null,
          location: result?.location ?? null,
          emailDate: email.emailDate,
          sender: email.sender,
          senderDomain: email.senderRootDomain,
          inferredStatus: inferStatusFromCategory(category),
          confidence: result?.confidence ?? null,
          // A category that came from the MODEL is never strong, not even when
          // the model names a lifecycle stage. The gate is the only authority
          // that can produce "strong", and for this message it said "weak" —
          // which is precisely why the message was sent to the model at all.
          // Storing "weak" here is what keeps a model verdict out of the
          // auto-create path and in front of the user.
          evidenceStrength: "weak",
          // The originating gate reason, reused rather than replaced: the code
          // records why the message was escalated, which is still true.
          evidenceReason: escalationReason(email),
        });
      }
    } catch (error: unknown) {
      // AI unavailable is not fatal to the scan.
      if (error instanceof AiGatewayError) {
        notice =
          "Some emails could not be analysed automatically and were saved for review.";
      } else {
        notice = "Some emails could not be analysed and were saved for review.";
      }

      for (const email of ambiguous) {
        records.push({
          gmailMessageId: email.gmailMessageId,
          gmailThreadId: email.gmailThreadId,
          connectionId: job.connectionId,
          category: "OTHER_JOB_RELATED",
          company: companyFromDomain(email.senderRootDomain),
          jobTitle: null,
          jobUrl: email.jobUrl,
          location: null,
          emailDate: email.emailDate,
          sender: email.sender,
          senderDomain: email.senderRootDomain,
          inferredStatus: null,
          confidence: null,
          // The gate said weak and the model never answered, so weak is still
          // the whole of what is known about this message.
          evidenceStrength: "weak",
          evidenceReason: escalationReason(email),
        });
      }
    }
  }

  // ---- 6. Persist, then advance the cursor ------------------------------
  // Insert first: if this fails, the cursor is untouched and the batch replays
  // harmlessly thanks to UNIQUE(user_id, gmail_message_id).
  const activityInserted = await insertGmailActivity(supabase, userId, records);

  const { pageToken: nextPageToken, done } = resolveNextCursor({
    pageFullyProcessed,
    nextPageToken: page.nextPageToken,
    storedPageToken: job.pageToken,
  });

  const messagesSeen = job.messagesSeen + fresh.length;

  await updateSyncJobProgress(supabase, userId, job.id, {
    status: done ? "complete" : "running",
    pageToken: nextPageToken,
    messagesSeen,
    candidates: job.candidates + candidates,
    classified: job.classified + classified,
    error: null,
    // Recorded on the job, not the connection: the anchor may only be promoted
    // once the whole scan finishes, otherwise an interrupted scan would skip
    // every message between the old and new anchor forever.
    ...(done && page.historyId ? { resultHistoryId: page.historyId } : {}),
  });

  // ---- 7. Auto_Importer, strictly last ----------------------------------
  //
  // Runs only after the ledger write AND the cursor/progress write, for two
  // reasons: it reads the evidence this batch just persisted, and running it
  // last means it cannot influence what was stored or where the scan resumes.
  // `runBatchAutoImport` never throws, so the batch's cursor, counts, and error
  // taxonomy are untouched by anything that happens inside the importer.
  const autoImport = await runBatchAutoImport(
    resolveAutoImportPlan({ elapsedMs: Date.now() - startedAt }),
    (maxProposals) => runAutoImport(supabase, userId, { maxProposals })
  );

  // The importer's contribution is written in its own small patch, AFTER the
  // importer has run, because the cursor/status write above necessarily happens
  // before it and must stay exactly where it is. Without this write the counts
  // would exist only in the HTTP response and die with the request, which is why
  // a reloaded page reported nothing for a scan that had organized applications.
  await updateSyncJobProgress(supabase, userId, job.id, {
    applicationsFound: job.applicationsFound + autoImport.applicationsCreated,
    applicationsUpdated: job.applicationsUpdated + autoImport.applicationsUpdated,
  });

  if (autoImport.failed) {
    // Non-content note, and only when nothing more important is already being
    // reported: the scan itself succeeded.
    notice =
      notice ??
      "Your emails were saved, but organizing them into applications will finish on the next sync.";
  }

  // One line per batch, operational facts only — no subject, snippet, body,
  // token, or any Gmail content. This is what makes the three cases readable in
  // production logs: listed=0 (Gmail matched nothing), listed>0 with fresh=0
  // (everything was already tracked), and fresh>0 (new mail was processed).
  console.info(
    `[gmail/sync] batch mode=${job.syncMode} listed=${messageRefs.length}` +
      ` deduplicated=${listing.deduplicated} fresh=${fresh.length}` +
      ` inserted=${activityInserted} done=${done}` +
      ` status=${done ? "complete" : "running"}` +
      // The escalation and import outcome, so "0 created" always states why.
      ` bodyEscalated=${bodyEscalated} bodyResolved=${bodyResolved}` +
      ` examined=${autoImport.examined} created=${autoImport.applicationsCreated}` +
      ` linked=${autoImport.linked} updated=${autoImport.applicationsUpdated}` +
      ` heldAmbiguous=${autoImport.heldAmbiguous}` +
      ` heldUnknownEmployer=${autoImport.heldUnknownEmployer}` +
      ` proposalsFailed=${autoImport.proposalsFailed}`
  );

  return {
    done,
    pageToken: nextPageToken,
    messagesListed: messageRefs.length,
    messagesDeduplicated: listing.deduplicated,
    messagesFresh: fresh.length,
    messagesSeen,
    pageFullyProcessed,
    candidates,
    classified,
    activityInserted,
    applicationsCreated: autoImport.applicationsCreated,
    applicationsUpdated: autoImport.applicationsUpdated,
    autoImport,
    bodyEscalated,
    bodyResolved,
    evidenceReasonCounts: tallyEvidenceReasons(records),
    historyId: done ? page.historyId ?? null : null,
    notice,
  };
}

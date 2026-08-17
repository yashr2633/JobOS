/**
 * Re-gate legacy Gmail activity — IN PLACE.
 *
 * SERVER ONLY.
 *
 * The problem this exists for: ledger rows written before the Evidence Gate
 * verdict was persisted carry `evidence_strength IS NULL`. `proposals.ts` reads
 * NULL as not-strong, so those rows can never be organized automatically and sit
 * under "Needs your input" indefinitely — and a normal sync can never fix them,
 * because `findProcessedMessageIds` deduplicates an already-ledgered message
 * away before anything is fetched. The only way out is to re-fetch each message
 * by its stored `gmail_message_id`, run the gate once, and write the verdict back
 * onto the row that is already there.
 *
 * Non-negotiables:
 *  - UPDATE only. Nothing is deleted, inserted, or upserted. `gmail_message_id`,
 *    `gmail_thread_id`, `application_id` and `user_id` are never written.
 *  - The gate is the only authority on strength, and it runs exactly once per
 *    message via `evaluateEmailWithEvidence`. NULL is never treated as strong.
 *  - No employer or job data is ever fabricated: a null company stays null.
 *  - Reason codes and counts only. No subject, snippet, or body reaches a log
 *    line or the returned result.
 *  - Every read and write is scoped to the acting user in the statement itself.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { getValidAccessToken } from "./tokens.ts";
import { GmailApiError, getMessageFull } from "./client.ts";
import { parseGmailMessage, type ParsedEmail } from "./parse.ts";
import {
  companyFromDomain,
  evaluateEmailWithEvidence,
  type EmailCategory,
} from "./heuristics.ts";
import { inferStatusFromCategory } from "./statusInference.ts";
import { resolveEmployer } from "./employer.ts";
import { mapWithConcurrency, storedStrength } from "./sync.ts";
import { runAutoImport } from "./autoImport.ts";
import {
  countLegacyActivityForRegate,
  countUnlinkedActivityByIds,
  fetchLegacyActivityForRegate,
  updateActivityEvidence,
  type ActivityEvidencePatch,
  type LegacyActivityRow,
} from "../api/gmailActivity.ts";

/**
 * Legacy rows re-gated per request.
 *
 * One `messages.get` per row at `REGATE_METADATA_CONCURRENCY` in flight, so 100
 * rows is ~20 sequential Gmail round-trips plus one write each — comfortably
 * inside the route's 60s maxDuration, and the client drives the loop for the
 * rest.
 */
export const REGATE_BATCH_LIMIT = 100;

/** Hard ceiling on a caller-supplied limit, so one request cannot run long. */
export const REGATE_MAX_BATCH_LIMIT = 150;

/**
 * Concurrent `messages.get` calls.
 *
 * The SAME bound the scan uses (`METADATA_FETCH_CONCURRENCY` in sync.ts): 5
 * concurrent metadata fetches at 5 quota units each keeps 25 units in flight,
 * well inside Gmail's 250 units/user/second limit. It is not raised here — the
 * re-gate competes for the same per-user quota as a sync.
 */
export const REGATE_METADATA_CONCURRENCY = 5;

/** Proposals the Auto_Importer may apply for one re-gated batch. */
export const REGATE_AUTO_IMPORT_CAP = 50;

export interface LegacyRegateOptions {
  /** Rows to re-gate in this batch. Clamped to `REGATE_MAX_BATCH_LIMIT`. */
  limit?: number;
  /** Cap passed to the Auto_Importer. Defaults to `REGATE_AUTO_IMPORT_CAP`. */
  maxProposals?: number;
  now?: number;
}

export interface LegacyRegateResult {
  /** Legacy rows this batch read. */
  scannedLegacy: number;
  /** Rows whose gate verdict was written back. */
  reclassified: number;
  applicationsCreated: number;
  applicationsUpdated: number;
  /** Re-gated rows that ended weak or were held — still unlinked afterwards. */
  awaitingReview: number;
  /** Rows left untouched because their Gmail message no longer exists. */
  skipped: number;
  /** Rows left untouched because re-gating them failed. */
  failed: number;
  /** Legacy rows still matching the predicate, so the client can loop. */
  remaining: number;
}

/** What one row's re-gate did. Counts and non-content codes only. */
type RowOutcome =
  | { kind: "reclassified"; id: string; strength: "strong" | "weak" | "none" }
  | { kind: "skipped" }
  | { kind: "failed" };

/**
 * The verdict, mapped to a patch exactly as `classifyParsedEmails` maps it to a
 * new row today.
 *
 *  - `none`   -> strength NULL (via `storedStrength`) and NOT_JOB_RELATED, with
 *               no employer or job data, matching the scan's rejected-row shape.
 *               This is also what removes the row from the re-gate predicate.
 *  - `strong` -> strength "strong", the gate's own category, an employer only
 *               from `companyFromDomain` (which refuses ATS/portal and freemail
 *               domains, so nothing is invented), and the status that category
 *               implies.
 *  - `weak`   -> strength "weak" and nothing else. Review-only by construction:
 *               the category the row already carries is left alone rather than
 *               replaced, because no model runs on this path and there is
 *               nothing better to put there. Weak can never create an
 *               application — `decideProposal` requires strong evidence.
 */
function patchForVerdict(email: ParsedEmail): {
  patch: ActivityEvidencePatch;
  strength: "strong" | "weak" | "none";
} {
  // The gate runs ONCE per message, here.
  const { evidence, verdict } = evaluateEmailWithEvidence(email);

  if (!verdict.candidate) {
    return {
      strength: evidence.strength,
      patch: {
        evidenceStrength: storedStrength(evidence.strength),
        evidenceReason: evidence.reason,
        category: "NOT_JOB_RELATED",
        company: null,
        jobTitle: null,
        jobUrl: null,
        inferredStatus: null,
        confidence: verdict.confidence,
      },
    };
  }

  if (verdict.needsAI) {
    return {
      strength: evidence.strength,
      patch: {
        evidenceStrength: storedStrength(evidence.strength),
        evidenceReason: evidence.reason,
      },
    };
  }

  const category: EmailCategory = verdict.category ?? "OTHER_JOB_RELATED";

  return {
    strength: evidence.strength,
    patch: {
      evidenceStrength: storedStrength(evidence.strength),
      evidenceReason: evidence.reason,
      category,
      // Now that the whole message is fetched, the employer named in the text is
      // readable. This is what lets a stranded portal confirmation resolve to a
      // real employer instead of staying in the unknown bucket forever.
      company: resolveEmployer(email, companyFromDomain(email.senderRootDomain)),
      // Only written when the message actually yielded one: a null here would
      // erase a URL the row already has, and the re-gate never destroys data.
      ...(email.jobUrl === null ? {} : { jobUrl: email.jobUrl }),
      inferredStatus: inferStatusFromCategory(category),
      confidence: verdict.confidence,
    },
  };
}

/**
 * Re-gate one bounded batch of this user's legacy activity.
 *
 * Bounded and resumable: it reads at most `limit` rows, reports how many still
 * match afterwards, and the client sends another request while that number is
 * above zero. A row whose Gmail message has been deleted is counted as `skipped`
 * and left exactly as it was, so it never blocks the batch — a batch that can
 * only skip reclassifies nothing, which is the client's signal to stop.
 */
export async function runLegacyRegate(
  supabase: SupabaseClient,
  userId: string,
  options: LegacyRegateOptions = {}
): Promise<LegacyRegateResult> {
  const limit = Math.max(
    1,
    Math.min(options.limit ?? REGATE_BATCH_LIMIT, REGATE_MAX_BATCH_LIMIT)
  );

  const rows = await fetchLegacyActivityForRegate(supabase, userId, limit);

  if (rows.length === 0) {
    // The count would run the identical predicate the fetch just ran, so there
    // is nothing left to report and no reason to touch Gmail at all.
    return {
      scannedLegacy: 0,
      reclassified: 0,
      applicationsCreated: 0,
      applicationsUpdated: 0,
      awaitingReview: 0,
      skipped: 0,
      failed: 0,
      remaining: 0,
    };
  }

  const accessToken = await getValidAccessToken(supabase, userId);

  const regateOne = async (row: LegacyActivityRow): Promise<RowOutcome> => {
    // Own try/catch per row: one unreadable message must never abandon the rest
    // of the batch or lose the work already written.
    try {
      // FULL, not metadata. The gate searches subject + snippet + bodyText, and a
      // metadata fetch leaves `bodyText` empty, so re-gating from metadata would
      // reproduce exactly the weak verdict that stranded the row in the first
      // place. Reading the body is what lets a genuine "Thank you for applying"
      // resolve to strong and leave the queue.
      const message = await getMessageFull(accessToken, row.gmail_message_id);
      const email = parseGmailMessage(message);
      const { patch, strength } = patchForVerdict(email);

      // UPDATE only, filtered by row id AND user id.
      await updateActivityEvidence(supabase, userId, row.id, patch);

      return { kind: "reclassified", id: row.id, strength };
    } catch (error: unknown) {
      // The message is gone from the mailbox. There is nothing to re-gate and
      // nothing is wrong, so the row is left untouched and merely skipped.
      if (error instanceof GmailApiError && error.status === 404) {
        return { kind: "skipped" };
      }

      console.error(
        "[gmail/regate] Row could not be re-gated:",
        error instanceof GmailApiError
          ? `gmail_${error.kind}`
          : error instanceof Error
            ? error.message
            : "unknown error"
      );
      return { kind: "failed" };
    }
  };

  const outcomes = await mapWithConcurrency(
    rows,
    REGATE_METADATA_CONCURRENCY,
    regateOne
  );

  const written = outcomes.filter(
    (
      outcome
    ): outcome is {
      kind: "reclassified";
      id: string;
      strength: "strong" | "weak" | "none";
    } => outcome.kind === "reclassified"
  );

  const reclassifiedIds = written.map((outcome) => outcome.id);
  /**
   * Rows the gate kept as job evidence. A `none` verdict was rejected, not held
   * for review, so it must not be counted as work waiting on the user.
   */
  const reviewableIds = written
    .filter((outcome) => outcome.strength !== "none")
    .map((outcome) => outcome.id);

  const skipped = outcomes.filter((outcome) => outcome.kind === "skipped").length;
  const failed = outcomes.filter((outcome) => outcome.kind === "failed").length;

  // ONCE per batch, after every verdict is persisted — not once per row. The
  // importer reads unlinked lifecycle evidence itself, so it sees everything
  // this batch just wrote, and its own idempotency (creation links its evidence
  // in the same step) is what stops a second run duplicating anything.
  let applicationsCreated = 0;
  let applicationsUpdated = 0;

  if (reclassifiedIds.length > 0) {
    try {
      const imported = await runAutoImport(supabase, userId, {
        maxProposals: options.maxProposals ?? REGATE_AUTO_IMPORT_CAP,
        now: options.now,
      });
      applicationsCreated = imported.created;
      applicationsUpdated = imported.updated;
    } catch (error: unknown) {
      // The verdicts are already written, so a failed import costs nothing: the
      // evidence stays in the ledger and the next run organizes it.
      console.error(
        "[gmail/regate] Auto import failed; re-gated verdicts were kept:",
        error instanceof Error ? error.message : "unknown error"
      );
    }
  }

  // Measured from the ledger rather than from the importer's hold counters,
  // which also cover rows this batch never touched.
  const awaitingReview = await countUnlinkedActivityByIds(
    supabase,
    userId,
    reviewableIds
  );

  const remaining = await countLegacyActivityForRegate(supabase, userId);

  return {
    scannedLegacy: rows.length,
    reclassified: reclassifiedIds.length,
    applicationsCreated,
    applicationsUpdated,
    awaitingReview,
    skipped,
    failed,
    remaining,
  };
}

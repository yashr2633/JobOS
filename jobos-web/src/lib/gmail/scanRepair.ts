/**
 * Whether a scan batch should spend its leftover budget repairing legacy
 * evidence, and how much of it.
 *
 * THE DEFECT THIS CLOSES
 *
 * Ledger rows written before the Evidence Gate verdict was persisted carry
 * `evidence_strength IS NULL`. `proposals.ts` computes
 *
 *     hasStrongEvidence = row.evidence_strength === "strong" && isLifecycle(row)
 *
 * so NULL reads as not-strong, and `decideProposal`'s only create path
 *
 *     employer !== null && proposal.hasStrongEvidence && proposal.isLifecycleEvent
 *
 * is unreachable for every one of them. They all fall through to
 * `hold_ambiguous` with reason `no_strong_evidence`. That is why a mailbox with
 * hundreds of genuine application emails reported `created 0, updated 0` on every
 * scan, and why the user was pushed into approving each one by hand under "Needs
 * your input" — the manual gate the product contract forbids as a normal flow.
 *
 * A normal scan can never fix this by itself: `findProcessedMessageIds`
 * deduplicates an already-ledgered message away before anything is fetched, so
 * those rows are never re-examined. `runLegacyRegate` is the designed remedy —
 * re-fetch by stored `gmail_message_id`, run the SAME gate once, write the
 * verdict back in place — but it was only reachable through a manual
 * `/api/gmail/regate` call that nothing in the Dashboard flow ever made.
 *
 * This planner is what connects the two. It does NOT loosen the gate: the same
 * `evaluateEmailWithEvidence` decides, `weak` and `none` still never create, and
 * no employer is invented. It only ensures rows that never reached the gate
 * finally do, automatically, using budget the batch would otherwise waste.
 *
 * Pure: no Supabase, no Gmail, no clock of its own. Budget is passed in, so the
 * policy is decided from arguments alone and can be pinned by tests.
 */

/**
 * Wall clock that must remain in the batch budget before a repair pass starts.
 *
 * Higher than the Auto_Importer's threshold because a repair pass costs one
 * `messages.get` per row, where the importer's work is database-only. Skipping is
 * free: the rows stay exactly as they are and the next batch retries them.
 */
export const REGATE_MIN_BUDGET_MS = 8_000;

/**
 * Legacy rows repaired per scan batch.
 *
 * Deliberately far below `REGATE_BATCH_LIMIT` (100), which is sized for a
 * dedicated request that has the whole 60s to itself. Here the repair shares a
 * batch with listing, metadata fetches, classification, persistence and the
 * importer, so it takes a small slice and lets the client's next batch continue.
 * At 5 concurrent fetches this is ~5 sequential Gmail round-trips.
 */
export const SCAN_REGATE_BATCH_CAP = 25;

/** Whether this batch repairs legacy evidence, and how many rows. */
export interface LegacyRepairPlan {
  run: boolean;
  /** Rows to repair. Zero whenever `run` is false. */
  limit: number;
  /** Why, as a stable code for logs and tests. Never user-facing text. */
  reason:
    | "budget_available"
    | "insufficient_budget"
    | "nothing_to_repair"
    | "batch_still_paginating";
}

/**
 * Decide whether to repair legacy evidence in this batch.
 *
 * Three conditions, in order:
 *
 *   1. Nothing to repair — no legacy rows remain, so there is nothing to do and
 *      no Gmail call is made.
 *   2. Still paginating — the batch held its cursor back because the page had
 *      more fresh mail than it could process. Fresh mail is the higher-value work
 *      and the user is waiting on it, so repair yields to it and picks up once
 *      the window has been walked.
 *   3. Budget — a repair pass costs real Gmail round-trips, so it only starts
 *      with meaningful time left.
 *
 * Ordering matters: 1 before 3 means a user with nothing to repair never has the
 * decision framed as a budget problem, which would be misleading in logs.
 */
export function resolveLegacyRepairPlan(args: {
  /** Milliseconds already spent in this batch. */
  elapsedMs: number;
  /** The batch's total wall-clock budget. */
  budgetMs: number;
  /** Legacy rows known to still need a verdict. */
  legacyRemaining: number;
  /**
   * True when the batch processed every fresh message on its page. False means
   * the cursor was held back and more fresh mail is waiting.
   */
  pageFullyProcessed: boolean;
}): LegacyRepairPlan {
  if (args.legacyRemaining <= 0) {
    return { run: false, limit: 0, reason: "nothing_to_repair" };
  }

  if (!args.pageFullyProcessed) {
    return { run: false, limit: 0, reason: "batch_still_paginating" };
  }

  const remainingMs = args.budgetMs - args.elapsedMs;
  if (remainingMs <= REGATE_MIN_BUDGET_MS) {
    return { run: false, limit: 0, reason: "insufficient_budget" };
  }

  return {
    run: true,
    // Never ask for more rows than actually need repairing.
    limit: Math.min(SCAN_REGATE_BATCH_CAP, args.legacyRemaining),
    reason: "budget_available",
  };
}

/**
 * What a scan reports as application-related for its window.
 *
 * The per-batch `candidates` counter answers "how many did I classify just now",
 * which is 0 for any repeat scan because dedup correctly absorbed the listing.
 * The ledger count answers "how much of this window is application-related",
 * which is the question the label actually asks. The ledger figure wins whenever
 * it is available; the batch figure is the fallback for when the ledger could not
 * be counted, and null stays null rather than becoming a zero.
 *
 * Pure so the precedence is testable, and so no caller has to re-derive it.
 */
export function resolveApplicationRelatedCount(args: {
  /** Job-related ledger rows in the scanned window, or null if uncounted. */
  ledgerWindowCount: number | null;
  /** Messages this batch newly classified as candidates. */
  batchCandidates: number | null;
}): number | null {
  return args.ledgerWindowCount ?? args.batchCandidates;
}

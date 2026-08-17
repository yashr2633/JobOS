/**
 * The two boundaries where "528 messages read" became "0 application-related,
 * 0 created, 0 updated".
 *
 * BOUNDARY 1 — reporting. `candidates` is incremented inside
 * `classifyParsedEmails`, which only sees a batch's FRESH messages. A repeat scan
 * deduplicates the whole listing, so the counter is structurally 0 while the
 * ledger still holds the verdicts reached when those messages were first
 * classified. Presenting that 0 beside 528 claims none of the 528 carried
 * application evidence.
 *
 * BOUNDARY 2 — import. Rows ledgered before the gate persisted its verdict carry
 * `evidence_strength IS NULL`, which `proposals.ts` reads as not-strong, so
 * `decideProposal`'s only create path is unreachable and every one of them is
 * held as `no_strong_evidence`. Dedup means a normal scan never re-examines them,
 * so `created`/`updated` stayed 0 permanently and the user was forced to approve
 * each application by hand.
 *
 * These tests pin the repair policy and the reporting precedence. They do NOT
 * relax the gate: `weak` and `none` still never create, which is asserted here
 * against the real `decideProposal`.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import {
  REGATE_MIN_BUDGET_MS,
  SCAN_REGATE_BATCH_CAP,
  resolveApplicationRelatedCount,
  resolveLegacyRepairPlan,
} from "./scanRepair.ts";
import { decideProposal } from "./autoImport.ts";
import { buildProposals } from "./proposals.ts";
import { BATCH_TIME_BUDGET_MS } from "./sync.ts";

// ===========================================================================
// Boundary 2: legacy evidence is repaired automatically
// ===========================================================================

test("a batch with budget and legacy rows repairs them", () => {
  const plan = resolveLegacyRepairPlan({
    elapsedMs: 1_000,
    budgetMs: BATCH_TIME_BUDGET_MS,
    legacyRemaining: 500,
    pageFullyProcessed: true,
  });

  assert.equal(plan.run, true);
  assert.equal(plan.reason, "budget_available");
  // Bounded, because the repair shares the batch with the scan itself.
  assert.equal(plan.limit, SCAN_REGATE_BATCH_CAP);
});

test("the repair never asks for more rows than actually need it", () => {
  const plan = resolveLegacyRepairPlan({
    elapsedMs: 0,
    budgetMs: BATCH_TIME_BUDGET_MS,
    legacyRemaining: 3,
    pageFullyProcessed: true,
  });

  assert.equal(plan.run, true);
  assert.equal(plan.limit, 3);
});

test("nothing to repair is reported as such, not as a budget problem", () => {
  const plan = resolveLegacyRepairPlan({
    elapsedMs: 0,
    budgetMs: BATCH_TIME_BUDGET_MS,
    legacyRemaining: 0,
    pageFullyProcessed: true,
  });

  assert.deepEqual(plan, {
    run: false,
    limit: 0,
    reason: "nothing_to_repair",
  });
});

test("fresh mail outranks repair work", () => {
  // The cursor was held back, so more fresh mail is waiting and the user is
  // waiting on it. Repair yields and resumes once the window has been walked.
  const plan = resolveLegacyRepairPlan({
    elapsedMs: 0,
    budgetMs: BATCH_TIME_BUDGET_MS,
    legacyRemaining: 500,
    pageFullyProcessed: false,
  });

  assert.equal(plan.run, false);
  assert.equal(plan.reason, "batch_still_paginating");
});

test("a nearly spent batch does not start Gmail round-trips", () => {
  const plan = resolveLegacyRepairPlan({
    elapsedMs: BATCH_TIME_BUDGET_MS - REGATE_MIN_BUDGET_MS,
    budgetMs: BATCH_TIME_BUDGET_MS,
    legacyRemaining: 500,
    pageFullyProcessed: true,
  });

  assert.equal(plan.run, false);
  assert.equal(plan.reason, "insufficient_budget");
  assert.equal(plan.limit, 0);
});

test("a skipped repair always has a zero limit, whatever the inputs", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 120_000 }),
      fc.integer({ min: 0, max: 5_000 }),
      fc.boolean(),
      (elapsedMs, legacyRemaining, pageFullyProcessed) => {
        const plan = resolveLegacyRepairPlan({
          elapsedMs,
          budgetMs: BATCH_TIME_BUDGET_MS,
          legacyRemaining,
          pageFullyProcessed,
        });

        // No caller can ever be handed a limit it must remember not to use.
        if (!plan.run) assert.equal(plan.limit, 0);
        // And a repair that does run is always bounded by both caps.
        if (plan.run) {
          assert.ok(plan.limit > 0);
          assert.ok(plan.limit <= SCAN_REGATE_BATCH_CAP);
          assert.ok(plan.limit <= legacyRemaining);
        }
      }
    ),
    { numRuns: 300 }
  );
});

// ===========================================================================
// The repair must not weaken the gate
// ===========================================================================

/** A lifecycle row as the ledger stores it, with the strength under test. */
function ledgerRow(strength: "strong" | "weak" | null) {
  return {
    id: "activity-1",
    gmail_message_id: "m1",
    gmail_thread_id: "t1",
    application_id: null,
    category: "APPLICATION_CONFIRMATION" as const,
    company: "Acme Corp",
    job_title: "Backend Engineer",
    job_url: null,
    location: null,
    email_date: "2026-06-01T10:00:00.000Z",
    sender: "careers@acme.com",
    sender_domain: "acme.com",
    confidence: 0.9,
    evidence_strength: strength,
  };
}

test("only strong evidence creates an application, before and after repair", () => {
  // Before repair: NULL strength. This is the state that produced `created 0`.
  const [beforeRepair] = buildProposals([ledgerRow(null)], [], new Map(), Date.parse("2026-06-02T00:00:00.000Z"));
  assert.equal(beforeRepair.hasStrongEvidence, false);
  assert.equal(beforeRepair.isLifecycleEvent, true);
  assert.deepEqual(decideProposal(beforeRepair), {
    action: "hold_ambiguous",
    applicationId: null,
    reason: "no_strong_evidence",
  });

  // Repaired to weak: STILL never creates. The repair is not a way in.
  const [weakRepair] = buildProposals([ledgerRow("weak")], [], new Map(), Date.parse("2026-06-02T00:00:00.000Z"));
  assert.equal(weakRepair.hasStrongEvidence, false);
  assert.equal(decideProposal(weakRepair).action, "hold_ambiguous");

  // Repaired to strong by the gate: now the automatic path applies, with a real
  // employer and a real lifecycle category.
  const [strongRepair] = buildProposals([ledgerRow("strong")], [], new Map(), Date.parse("2026-06-02T00:00:00.000Z"));
  assert.equal(strongRepair.hasStrongEvidence, true);
  assert.deepEqual(decideProposal(strongRepair), {
    action: "create",
    applicationId: null,
    reason: "strong_lifecycle_evidence",
  });
});

test("strong evidence with no resolvable employer creates under the placeholder", () => {
  const row = { ...ledgerRow("strong"), company: null, sender_domain: "linkedin.com" };
  const [proposal] = buildProposals([row], [], new Map(), Date.parse("2026-06-02T00:00:00.000Z"));

  // Strong evidence must not be withheld for want of an employer. It creates, and
  // `applyCreate` stores the reconcilable "Unknown company" placeholder — the
  // portal is still never stored as the employer.
  const decision = decideProposal(proposal);
  assert.equal(decision.action, "create");
  assert.equal(decision.reason, "strong_evidence_unresolved_employer");
});

// ===========================================================================
// Boundary 1: application-related is a window figure, not a batch figure
// ===========================================================================

test("the ledger's window count outranks the batch's fresh classifications", () => {
  // The exact reported case: 528 listed, all deduplicated, so the batch newly
  // classified nothing — but the window genuinely holds 126 application-related
  // messages, and that is what must be reported.
  assert.equal(
    resolveApplicationRelatedCount({
      ledgerWindowCount: 126,
      batchCandidates: 0,
    }),
    126
  );
});

test("a genuinely empty window still reports zero", () => {
  // Zero means zero. The ledger was counted and there is nothing job-related.
  assert.equal(
    resolveApplicationRelatedCount({
      ledgerWindowCount: 0,
      batchCandidates: 0,
    }),
    0
  );
});

test("an uncounted ledger falls back to the batch figure, never to a fake zero", () => {
  assert.equal(
    resolveApplicationRelatedCount({
      ledgerWindowCount: null,
      batchCandidates: 7,
    }),
    7
  );

  // Nothing known at all stays unknown, so the UI renders "—" rather than 0.
  assert.equal(
    resolveApplicationRelatedCount({
      ledgerWindowCount: null,
      batchCandidates: null,
    }),
    null
  );
});

test("the ledger count wins for every pair of values", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 10_000 }),
      fc.integer({ min: 0, max: 10_000 }),
      (ledgerWindowCount, batchCandidates) => {
        // Precedence is unconditional: a reported ledger figure is never
        // overridden by a batch figure, not even a larger one.
        assert.equal(
          resolveApplicationRelatedCount({ ledgerWindowCount, batchCandidates }),
          ledgerWindowCount
        );
      }
    ),
    { numRuns: 200 }
  );
});

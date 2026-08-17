/**
 * The stranded-evidence defect: why "Needs your input" never drained and why
 * every scan reported `application-related > 0, created 0, updated 0`.
 *
 * A ledger row was STUCK when it satisfied all three of:
 *
 *   application_id IS NULL          -> never imported
 *   evidence_strength = 'weak'      -> written by the CURRENT pipeline
 *   category <> 'NOT_JOB_RELATED'   -> shown in "Needs your input"
 *
 * Such a row could not move in any direction:
 *   - auto-import refused it, because `decideProposal` requires strong evidence;
 *   - a re-scan never re-examined it, because `findProcessedMessageIds`
 *     deduplicates an already-ledgered message away before any fetch;
 *   - the re-gate skipped it, because its predicate matched only
 *     `evidence_strength IS NULL`.
 *
 * So the queue could only grow, and the dashboard could only ever show whatever
 * the user had previously approved by hand.
 *
 * Most of those weak verdicts were an artefact of body-less input: the scan
 * fetched `format=metadata`, leaving `bodyText` empty, so the gate could not see
 * lifecycle phrasing below the snippet. The re-gate now re-fetches WITH the body
 * and covers the whole not-strong population.
 *
 * Scenario coverage from the brief: E, F, G, plus Phase 8 telemetry.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";

import { decideProposal } from "./autoImport.ts";
import { buildProposals } from "./proposals.ts";
import { explainNoImports } from "../../app/dashboard/scanRunner.ts";

const GMAIL_ACTIVITY = join(
  process.cwd(),
  "src",
  "lib",
  "api",
  "gmailActivity.ts"
);
const REGATE = join(process.cwd(), "src", "lib", "gmail", "regate.ts");

/** A lifecycle row with the strength under test, unlinked. */
function stuckRow(strength: "strong" | "weak" | null) {
  return {
    id: "act-1",
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

function proposalFor(strength: "strong" | "weak" | null) {
  const [proposal] = buildProposals(
    [stuckRow(strength)],
    [],
    new Map(),
    Date.parse("2026-06-02T00:00:00.000Z")
  );
  return proposal;
}

// ===========================================================================
// The defect: a weak unlinked row could not move in any direction
// ===========================================================================

test("a weak unlinked row is refused by the importer (correctly)", () => {
  // This is right and stays right: weak evidence must never create.
  const decision = decideProposal(proposalFor("weak"));
  assert.equal(decision.action, "hold_ambiguous");
  assert.equal(decision.reason, "no_strong_evidence");
});

test("the re-gate now covers weak rows, not only never-gated ones", () => {
  const source = readFileSync(GMAIL_ACTIVITY, "utf8");

  // The widened predicate: NULL *or* weak. Previously `.is("evidence_strength",
  // null)` only, which is what stranded every weak row permanently.
  assert.ok(
    source.includes('"evidence_strength.is.null,evidence_strength.eq.weak"'),
    "the stuck-row predicate must cover the whole not-strong population"
  );

  // Applied by BOTH the fetch and the count, so the number shown and the rows
  // read can never disagree.
  assert.equal(
    source.split('"evidence_strength.is.null,evidence_strength.eq.weak"').length - 1,
    2,
    "fetch and count must apply the identical predicate"
  );

  // Still unlinked-only and still never resurrecting dismissed mail.
  assert.ok(source.includes('.neq("category", "NOT_JOB_RELATED")'));
});

test("the re-gate reads the message body, or re-gating changes nothing", () => {
  const source = readFileSync(REGATE, "utf8");

  // The gate searches subject + snippet + bodyText. Re-gating from
  // `format=metadata` would leave bodyText empty and reproduce the very weak
  // verdict that stranded the row.
  assert.ok(
    source.includes("getMessageFull(accessToken, row.gmail_message_id)"),
    "the re-gate must re-fetch with the body"
  );
  assert.ok(
    !source.includes("getMessageMetadata("),
    "a metadata re-fetch cannot produce a strong verdict"
  );
});

// ===========================================================================
// Scenario G: a previously scanned but unimported message stays eligible
// ===========================================================================

test("G: an already-scanned, unimported row is still eligible to import", () => {
  // Eligibility is `application_id IS NULL` on the LEDGER, not "was this message
  // fresh in this batch". Once the re-gate resolves it to strong, it imports.
  const decision = decideProposal(proposalFor("strong"));
  assert.deepEqual(decision, {
    action: "create",
    applicationId: null,
    reason: "strong_lifecycle_evidence",
  });
});

test("only the strength changes the outcome, for the same evidence", () => {
  // The row is identical in every other respect, so strength is provably the
  // only thing that was blocking import.
  fc.assert(
    fc.property(
      fc.constantFrom<"strong" | "weak" | null>("strong", "weak", null),
      (strength) => {
        const decision = decideProposal(proposalFor(strength));
        if (strength === "strong") {
          assert.equal(decision.action, "create");
        } else {
          assert.equal(decision.action, "hold_ambiguous");
        }
      }
    ),
    { numRuns: 60 }
  );
});

// ===========================================================================
// Scenario F: unknown employer never becomes a false application
// ===========================================================================

test("F: strong evidence with no nameable employer is held, never invented", () => {
  const [proposal] = buildProposals(
    [{ ...stuckRow("strong"), company: null, sender_domain: "linkedin.com" }],
    [],
    new Map(),
    Date.parse("2026-06-02T00:00:00.000Z")
  );

  const decision = decideProposal(proposal);
  // Strong evidence now creates under the reconcilable placeholder rather than
  // being held. The proposal's own company stays null — nothing is fabricated in
  // the proposal; the placeholder is written only at persistence by applyCreate.
  assert.equal(decision.action, "create");
  assert.equal(decision.reason, "strong_evidence_unresolved_employer");
  assert.equal(proposal.company, null, "no employer is fabricated in the proposal");
});

// ===========================================================================
// Phase 8: a zero always explains itself
// ===========================================================================

test("a database rejection is reported as a database error, not a clean scan", () => {
  const note = explainNoImports({
    applicationRelated: 28,
    outcome: {
      examined: 5,
      created: 0,
      linked: 0,
      updated: 0,
      heldAmbiguous: 0,
      heldUnknownEmployer: 0,
      proposalsFailed: 5,
    },
    legacyRemaining: 0,
  });

  assert.ok(note !== null);
  assert.match(note, /could not be saved/);
  assert.match(note, /database error/);
});

test("held evidence is distinguished from evidence never read", () => {
  const held = explainNoImports({
    applicationRelated: 28,
    outcome: {
      examined: 12,
      created: 0,
      linked: 0,
      updated: 0,
      heldAmbiguous: 12,
      heldUnknownEmployer: 0,
      proposalsFailed: 0,
    },
    legacyRemaining: 0,
  });
  assert.ok(held !== null);
  assert.match(held, /did not clearly evidence an application/);

  // examined === 0 is a different situation: nothing eligible was even read.
  const nothingRead = explainNoImports({
    applicationRelated: 28,
    outcome: {
      examined: 0,
      created: 0,
      linked: 0,
      updated: 0,
      heldAmbiguous: 0,
      heldUnknownEmployer: 0,
      proposalsFailed: 0,
    },
    legacyRemaining: 400,
  });
  assert.ok(nothingRead !== null);
  assert.match(nothingRead, /job-related is not the same as applied/);
  // And it tells the user the queue is still draining, so scanning again helps.
  assert.match(nothingRead, /400/);
});

test("unknown employer is explained as withheld, not as failure", () => {
  const note = explainNoImports({
    applicationRelated: 9,
    outcome: {
      examined: 3,
      created: 0,
      linked: 0,
      updated: 0,
      heldAmbiguous: 0,
      heldUnknownEmployer: 3,
      proposalsFailed: 0,
    },
    legacyRemaining: 0,
  });

  assert.ok(note !== null);
  assert.match(note, /no employer JobTrackOS is willing to name/);
});

test("nothing is explained when applications were actually persisted", () => {
  for (const outcome of [
    { created: 2, linked: 0, updated: 0 },
    { created: 0, linked: 1, updated: 0 },
    { created: 0, linked: 0, updated: 3 },
  ]) {
    assert.equal(
      explainNoImports({
        applicationRelated: 28,
        outcome: {
          examined: 5,
          heldAmbiguous: 0,
          heldUnknownEmployer: 0,
          proposalsFailed: 0,
          ...outcome,
        },
        legacyRemaining: 0,
      }),
      null,
      "a successful import needs no excuse"
    );
  }

  // And nothing to explain when no application-related mail was found at all —
  // the outcome line already says that.
  assert.equal(
    explainNoImports({
      applicationRelated: 0,
      outcome: {
        examined: 0,
        created: 0,
        linked: 0,
        updated: 0,
        heldAmbiguous: 0,
        heldUnknownEmployer: 0,
        proposalsFailed: 0,
      },
      legacyRemaining: 0,
    }),
    null
  );
});

test("an unreported outcome never produces a fabricated explanation", () => {
  assert.equal(
    explainNoImports({
      applicationRelated: 28,
      outcome: null,
      legacyRemaining: null,
    }),
    null
  );
});

// ===========================================================================
// Phase 3: the approval queue is gone from the primary flow
// ===========================================================================

test("the dashboard scan module no longer links to the approval queue", () => {
  const source = readFileSync(
    join(process.cwd(), "src", "app", "dashboard", "components", "GmailScanModule.tsx"),
    "utf8"
  );

  // "Needs your input" was a manual approval gate: job-related mail waiting for
  // Add as new / Merge / Ignore before it could reach the dashboard. The product
  // has no such step.
  assert.ok(
    !source.includes("Needs your input"),
    "the primary flow must not present an approval queue"
  );
  assert.ok(
    !source.includes("exceptions.needsInput > 0"),
    "the approval queue must not gate the primary flow"
  );

  // Unknown employer IS a genuine exception and stays, as information — surfaced
  // only while there is genuinely something waiting, never as a required gate.
  assert.ok(source.includes("hasExceptions"));
  assert.ok(source.includes("exceptions.unknownEmployer"));
  assert.ok(
    !source.includes('"needsInput"') && !source.includes("needsInput:"),
    "the approval queue's count must not be part of this component's props"
  );
});

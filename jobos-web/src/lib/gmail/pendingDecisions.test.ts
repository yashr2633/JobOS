/**
 * Tests for the workspace's pending-decision selection.
 *
 * The point of these assertions is the exclusion, not the inclusion: anything
 * the Auto_Importer created or linked is a finished result, and showing it as a
 * pending decision would rebuild the approval queue this feature removed.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  countPendingDecisions,
  selectPendingDecisions,
  type UnknownBucketRowLike,
} from "./pendingDecisions.ts";
import type { ApplicationProposal } from "./proposals.ts";

function proposal(
  key: string,
  overrides: Partial<ApplicationProposal> = {}
): ApplicationProposal {
  return {
    key,
    activityIds: [`activity-${key}`],
    company: "Acme",
    jobTitle: "Backend Engineer",
    jobPortal: null,
    jobUrl: null,
    location: null,
    appliedDate: "2026-01-02T00:00:00.000Z",
    lastActivityAt: "2026-01-05T00:00:00.000Z",
    status: "Applied",
    statusFromEvidence: true,
    confidence: 0.95,
    evidence: [],
    suggestedApplicationId: null,
    matchTier: "none",
    autoLink: false,
    evidenceStrength: "strong",
    hasStrongEvidence: true,
    isLifecycleEvent: true,
    ...overrides,
  };
}

function bucketRow(
  id: string,
  overrides: Partial<UnknownBucketRowLike> = {}
): UnknownBucketRowLike {
  return {
    id,
    application_id: null,
    company: null,
    category: "APPLICATION_CONFIRMATION",
    email_date: "2026-01-04T00:00:00.000Z",
    sender_domain: "linkedin.com",
    evidence_reason: "employer_unresolved",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Exclusions: organized work is a result, not a decision
// ---------------------------------------------------------------------------

test("a proposal the Auto_Importer would create is not pending", () => {
  const pending = selectPendingDecisions([proposal("created")], []);

  assert.deepEqual(pending.heldProposals, []);
  assert.equal(countPendingDecisions(pending), 0);
});

test("a proposal the Auto_Importer would link is not pending", () => {
  const linked = proposal("linked", {
    matchTier: "company_title",
    suggestedApplicationId: "app-1",
  });

  const pending = selectPendingDecisions([linked], [], {
    ownedApplicationIds: new Set(["app-1"]),
  });

  assert.deepEqual(pending.heldProposals, []);
});

// ---------------------------------------------------------------------------
// Inclusions: exactly the held proposals
// ---------------------------------------------------------------------------

test("a company-only match is held for the user", () => {
  const pending = selectPendingDecisions(
    [proposal("ambiguous", { matchTier: "company_only", suggestedApplicationId: "app-1" })],
    []
  );

  assert.equal(pending.heldProposals.length, 1);
  assert.equal(pending.heldProposals[0].action, "hold_ambiguous");
  assert.equal(pending.heldProposals[0].reason, "match_company_only");
});

test("a NON-strong item with no determinable employer is held for the bucket", () => {
  // Strong unresolved-employer evidence now creates automatically (FIX 1), so the
  // genuinely-pending case is non-strong evidence with no employer: there is
  // nothing to act on unattended.
  const pending = selectPendingDecisions(
    [
      proposal("unknown", {
        company: null,
        evidenceStrength: "weak",
        hasStrongEvidence: false,
      }),
    ],
    []
  );

  assert.equal(pending.heldProposals.length, 1);
  assert.equal(pending.heldProposals[0].action, "hold_unknown_employer");
  assert.equal(pending.heldProposals[0].reason, "employer_unresolved");
});

test("a NON-strong item whose employer is really a portal is held, never created", () => {
  const pending = selectPendingDecisions(
    [
      proposal("portal", {
        company: "LinkedIn",
        evidenceStrength: "weak",
        hasStrongEvidence: false,
      }),
    ],
    []
  );

  assert.equal(pending.heldProposals.length, 1);
  assert.equal(pending.heldProposals[0].action, "hold_unknown_employer");
  assert.equal(pending.heldProposals[0].reason, "employer_resolved_to_portal");
});

test("evidence that is not strong is held rather than acted on", () => {
  const pending = selectPendingDecisions(
    [proposal("weak", { evidenceStrength: "weak", hasStrongEvidence: false })],
    []
  );

  assert.equal(pending.heldProposals.length, 1);
  assert.equal(pending.heldProposals[0].action, "hold_ambiguous");
  assert.equal(pending.heldProposals[0].reason, "no_strong_evidence");
});

test("a match pointing outside the acting user's applications is held", () => {
  const pending = selectPendingDecisions(
    [proposal("foreign", { matchTier: "thread", suggestedApplicationId: "someone-else" })],
    [],
    { ownedApplicationIds: new Set(["app-1"]) }
  );

  assert.equal(pending.heldProposals.length, 1);
  assert.equal(pending.heldProposals[0].action, "hold_ambiguous");
  assert.equal(pending.heldProposals[0].reason, "match_target_not_owned");
});

// ---------------------------------------------------------------------------
// Bucket entries
// ---------------------------------------------------------------------------

test("bucket rows become compact evidence entries with the portal derived", () => {
  const pending = selectPendingDecisions([], [bucketRow("activity-1")]);

  assert.deepEqual(pending.unknownEntries, [
    {
      activityId: "activity-1",
      category: "APPLICATION_CONFIRMATION",
      senderDomain: "linkedin.com",
      jobPortal: "LinkedIn",
      emailDate: "2026-01-04T00:00:00.000Z",
      reason: "employer_unresolved",
    },
  ]);
});

test("a row that is already linked or already has an employer is not an entry", () => {
  const pending = selectPendingDecisions([], [
    bucketRow("linked", { application_id: "app-1" }),
    bucketRow("named", { company: "Acme" }),
  ]);

  assert.deepEqual(pending.unknownEntries, []);
});

// ---------------------------------------------------------------------------
// Shape and determinism
// ---------------------------------------------------------------------------

test("the pending set is exactly the held proposals plus the bucket entries", () => {
  const proposals = [
    proposal("created"),
    proposal("ambiguous", { matchTier: "company_only" }),
    // Non-strong: strong unresolved-employer evidence now auto-creates (FIX 1),
    // so the genuinely-pending unknown case is weak evidence with no employer.
    proposal("unknown", {
      company: null,
      evidenceStrength: "weak",
      hasStrongEvidence: false,
    }),
    proposal("linked", { matchTier: "job_url", suggestedApplicationId: "app-1" }),
  ];
  const rows = [bucketRow("activity-1"), bucketRow("activity-2")];

  const pending = selectPendingDecisions(proposals, rows);

  assert.deepEqual(
    pending.heldProposals.map((held) => held.proposal.key),
    ["ambiguous", "unknown"]
  );
  assert.deepEqual(
    pending.unknownEntries.map((entry) => entry.activityId),
    ["activity-1", "activity-2"]
  );
  assert.equal(countPendingDecisions(pending), 4);

  // Deterministic: the same input yields the same output, in the same order.
  assert.deepEqual(selectPendingDecisions(proposals, rows), pending);
});

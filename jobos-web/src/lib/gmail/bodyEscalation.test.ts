/**
 * The application-ingestion boundary: 28 application-related -> 0 created.
 *
 * ROOT CAUSE, reproduced below before it is fixed.
 *
 * The scan fetched every message with `getMessageMetadata` (`format=metadata`),
 * which returns headers plus the ~200-character snippet and NO body parts.
 * `ParsedEmail.bodyText` documents this itself: "Empty for metadata-only
 * fetches". The Evidence Gate searches subject + snippet + bodyText and only
 * returns `"strong"` on a lifecycle pattern match, so lifecycle phrasing that
 * sits below the snippet was invisible:
 *
 *   no lifecycle match -> not strong -> needsAI -> stored `weak`, category
 *   commonly OTHER_JOB_RELATED -> `fetchLifecycleActivityForAutoImport` filters
 *   on Lifecycle_Categories and never reads the row -> `runAutoImport` returns at
 *   `rows.length === 0` -> created 0, updated 0, and no error.
 *
 * `client.ts` had always exported `getMessageFull` for this exact escalation and
 * it had zero callers. These tests pin the wire, and pin that it is a wire and
 * not a widening: the same gate decides, and a message with no lifecycle evidence
 * still cannot create an application.
 *
 * Scenario coverage from the brief: TEST 1, 2, 4, 5, 6, 7.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  escalateAmbiguousWithBody,
  classifyParsedEmails,
  BODY_ESCALATION_LIMIT,
} from "./sync.ts";
import { evaluateApplicationEvidence } from "./applicationEvidence.ts";
import { decideProposal } from "./autoImport.ts";
import { buildProposals } from "./proposals.ts";
import { LIFECYCLE_CATEGORIES } from "./applicationEvidence.ts";
import type { ParsedEmail } from "./parse.ts";

/**
 * A message as the METADATA fetch delivers it: subject and snippet, empty body.
 *
 * `bodyText: ""` is not a convenience here — it is the exact production input
 * that caused the defect.
 */
function metadataEmail(overrides: Partial<ParsedEmail> = {}): ParsedEmail {
  return {
    gmailMessageId: "m1",
    gmailThreadId: "t1",
    subject: "Your application to Acme Corp",
    sender: "careers@acme.com",
    senderDomain: "acme.com",
    senderRootDomain: "acme.com",
    emailDate: "2026-06-01T10:00:00.000Z",
    // Real snippets open with boilerplate, so the lifecycle phrase is out of reach.
    snippet: "Hi there, we wanted to reach out regarding your recent activity.",
    rfcMessageId: "<abc@acme.com>",
    hasUnsubscribe: false,
    labelIds: ["INBOX"],
    jobUrl: null,
    bodyText: "",
    ...overrides,
  };
}

/** The same message as the FULL fetch delivers it: body included. */
function fullEmail(bodyText: string, overrides: Partial<ParsedEmail> = {}): ParsedEmail {
  return metadataEmail({ ...overrides, bodyText });
}

const CONFIRMATION_BODY =
  "Dear candidate,\n\nThank you for applying to the Backend Engineer role at " +
  "Acme Corp. We have received your application and our team is reviewing it.";

// ===========================================================================
// The defect, reproduced
// ===========================================================================

test("metadata-only input cannot reach a strong verdict (the defect)", () => {
  const verdict = evaluateApplicationEvidence(metadataEmail());

  // No lifecycle phrase is visible, so the gate cannot call this strong. The gate
  // is behaving correctly; it is being fed a truncated message.
  assert.notEqual(verdict.strength, "strong");
  assert.equal(verdict.isLifecycleEvent, false);
});

test("the SAME message with its body is strong lifecycle evidence", () => {
  const verdict = evaluateApplicationEvidence(fullEmail(CONFIRMATION_BODY));

  assert.equal(verdict.strength, "strong");
  assert.equal(verdict.isLifecycleEvent, true);
  assert.ok(
    verdict.category !== null && LIFECYCLE_CATEGORIES.has(verdict.category),
    "a confirmation must land in a Lifecycle_Category so the importer reads it"
  );
});

// ===========================================================================
// TEST 1 — applications are created automatically after escalation
// ===========================================================================

test("TEST 1: escalation turns an ambiguous message into an importable row", async () => {
  // An ATS sender with candidate language: exactly the metadata verdict that used
  // to become an OTHER_JOB_RELATED/weak row the importer never read.
  const ambiguousEmail = metadataEmail({
    senderRootDomain: "greenhouse.io",
    senderDomain: "greenhouse.io",
    snippet: "Regarding your application",
  });

  const metadataVerdict = evaluateApplicationEvidence(ambiguousEmail);
  assert.equal(metadataVerdict.strength, "weak", "precondition: ambiguous");

  const outcome = await escalateAmbiguousWithBody({
    ambiguous: [ambiguousEmail],
    ambiguousReasons: new Map([["m1", metadataVerdict.reason]]),
    connectionId: "conn-1",
    fetchFull: async () => fullEmail(CONFIRMATION_BODY, {
      senderRootDomain: "greenhouse.io",
      senderDomain: "greenhouse.io",
    }),
  });

  assert.equal(outcome.escalated, 1);
  assert.equal(outcome.resolved, 1);
  assert.equal(outcome.ambiguous.length, 0, "no model call is needed");

  const [record] = outcome.records;
  assert.equal(record.evidenceStrength, "strong");
  assert.ok(LIFECYCLE_CATEGORIES.has(record.category));

  // And that row is one the Auto_Importer will act on without any approval step.
  const [proposal] = buildProposals(
    [
      {
        id: "a1",
        gmail_message_id: record.gmailMessageId,
        gmail_thread_id: record.gmailThreadId,
        application_id: null,
        category: record.category,
        company: "Acme Corp",
        job_title: "Backend Engineer",
        job_url: null,
        location: null,
        email_date: record.emailDate,
        sender: record.sender,
        sender_domain: record.senderDomain,
        confidence: record.confidence,
        evidence_strength: record.evidenceStrength,
      },
    ],
    [],
    new Map(),
    Date.parse("2026-06-02T00:00:00.000Z")
  );

  assert.equal(proposal.hasStrongEvidence, true);
  assert.deepEqual(decideProposal(proposal), {
    action: "create",
    applicationId: null,
    reason: "strong_lifecycle_evidence",
  });
});

// ===========================================================================
// TEST 5 — non-application mail still never creates an application
// ===========================================================================

test("TEST 5: a job alert is rejected even when its body is read", async () => {
  const alert = metadataEmail({
    subject: "12 new jobs for you this week",
    snippet: "Jobs matching your profile",
  });

  // Rejected outright at the metadata stage, so it is never even ambiguous.
  const verdict = evaluateApplicationEvidence(alert);
  assert.equal(verdict.strength, "none");
  assert.equal(verdict.category, "NOT_JOB_RELATED");

  // And escalation cannot rescue a message with no lifecycle evidence: a body
  // full of marketing stays ambiguous and never becomes a row here.
  const marketing = metadataEmail({
    gmailMessageId: "m2",
    senderRootDomain: "greenhouse.io",
    senderDomain: "greenhouse.io",
    snippet: "Regarding your application",
  });

  const outcome = await escalateAmbiguousWithBody({
    ambiguous: [marketing],
    ambiguousReasons: new Map([["m2", "ats_sender_with_candidate_language"]]),
    connectionId: "conn-1",
    fetchFull: async () =>
      fullEmail(
        "Browse our latest openings and upgrade to premium for more matches.",
        { gmailMessageId: "m2", senderRootDomain: "greenhouse.io" }
      ),
  });

  assert.equal(outcome.resolved, 0, "no lifecycle evidence, no deterministic row");
  assert.equal(outcome.ambiguous.length, 1, "still the model's call");
  assert.equal(
    outcome.ambiguousReasons.get("m2"),
    "ats_sender_with_candidate_language",
    "the original escalation reason is carried forward, not invented"
  );
});

test("TEST 5b: escalation never widens what counts as an application", () => {
  // The gate is the only authority, before and after escalation. A plain
  // newsletter is rejected on its body just as it is on its snippet.
  const newsletter = fullEmail(
    "This week's newsletter: salary report, webinar invite, and 20% off courses."
  );
  const verdict = evaluateApplicationEvidence(newsletter);
  assert.equal(verdict.strength, "none");
  assert.equal(verdict.category, "NOT_JOB_RELATED");
});

// ===========================================================================
// TEST 2 / TEST 4 — re-scanning is idempotent, and a tracked message stays
// eligible for extraction
// ===========================================================================

test("TEST 4: an already-tracked message is still eligible for import", () => {
  // The importer's input is the LEDGER, keyed on `application_id IS NULL`, not on
  // whether the Gmail message was fresh in this batch. So a message ledgered by
  // an earlier scan is still proposed for import on a later one.
  const [proposal] = buildProposals(
    [
      {
        id: "a1",
        gmail_message_id: "m1",
        gmail_thread_id: "t1",
        // Unlinked: never imported, though the message itself is long since tracked.
        application_id: null,
        category: "APPLICATION_CONFIRMATION",
        company: "Acme Corp",
        job_title: "Backend Engineer",
        job_url: null,
        location: null,
        email_date: "2026-06-01T10:00:00.000Z",
        sender: "careers@acme.com",
        sender_domain: "acme.com",
        confidence: 0.95,
        evidence_strength: "strong",
      },
    ],
    [],
    new Map(),
    Date.parse("2026-06-02T00:00:00.000Z")
  );

  assert.equal(decideProposal(proposal).action, "create");
});

test("TEST 2: a second scan links to the existing application instead of duplicating", () => {
  const row = {
    id: "a2",
    gmail_message_id: "m2",
    gmail_thread_id: "t1",
    application_id: null,
    category: "INTERVIEW_INVITATION" as const,
    company: "Acme Corp",
    job_title: "Backend Engineer",
    job_url: null,
    location: null,
    email_date: "2026-06-05T10:00:00.000Z",
    sender: "careers@acme.com",
    sender_domain: "acme.com",
    confidence: 0.95,
    evidence_strength: "strong" as const,
  };

  // The application created by the first scan, now an existing candidate, and its
  // thread already linked.
  const [proposal] = buildProposals(
    [row],
    [
      {
        id: "app-1",
        company: "Acme Corp",
        role: "Backend Engineer",
        appliedDate: "2026-06-01",
      },
    ],
    new Map([["t1", "app-1"]]),
    Date.parse("2026-06-06T00:00:00.000Z")
  );

  const decision = decideProposal(proposal, {
    ownedApplicationIds: new Set(["app-1"]),
  });

  // Link, never a second create. This is what keeps a repeated scan idempotent
  // while still letting new evidence advance the status.
  assert.equal(decision.action, "link");
  assert.equal(decision.applicationId, "app-1");
  assert.equal(decision.reason, "matched_existing_application");
});

// ===========================================================================
// TEST 6 — manual applications are untouched
// ===========================================================================

test("TEST 6: the importer only ever adds or links, never removes", () => {
  // A manually added application with no Gmail evidence at all produces no
  // proposals, so nothing about it can be rewritten or deleted by a scan.
  const proposals = buildProposals([], [
    {
      id: "manual-1",
      company: "Manually Added Ltd",
      role: "Designer",
      appliedDate: "2026-05-01",
    },
  ]);

  assert.deepEqual(proposals, [], "no evidence, no proposal, no change");
});

// ===========================================================================
// Bounds and failure behaviour
// ===========================================================================

test("a failed re-fetch never loses a message", async () => {
  const email = metadataEmail({ gmailMessageId: "m9" });

  const outcome = await escalateAmbiguousWithBody({
    ambiguous: [email],
    ambiguousReasons: new Map([["m9", "application_url_only"]]),
    connectionId: null,
    fetchFull: async () => {
      throw new Error("gmail unavailable");
    },
  });

  assert.equal(outcome.resolved, 0);
  assert.equal(outcome.ambiguous.length, 1, "the message survives for the model");
  assert.equal(outcome.ambiguousReasons.get("m9"), "application_url_only");
});

test("escalation is bounded, and the overflow still reaches the model", async () => {
  const many = Array.from({ length: BODY_ESCALATION_LIMIT + 5 }, (_, i) =>
    metadataEmail({ gmailMessageId: `m${i}` })
  );
  const reasons = new Map(
    many.map((email) => [email.gmailMessageId, "application_url_only" as const])
  );

  let fetches = 0;
  const outcome = await escalateAmbiguousWithBody({
    ambiguous: many,
    ambiguousReasons: reasons,
    connectionId: null,
    fetchFull: async () => {
      fetches += 1;
      // No lifecycle evidence, so nothing resolves and everything is carried.
      return fullEmail("Nothing decisive in here.");
    },
  });

  assert.equal(fetches, BODY_ESCALATION_LIMIT, "the cap bounds the payload cost");
  assert.equal(outcome.escalated, BODY_ESCALATION_LIMIT);
  // Nothing is dropped: the capped remainder is still ambiguous, not discarded.
  assert.equal(outcome.ambiguous.length, many.length);
});

test("the metadata pass still resolves what it can, unescalated", () => {
  // A subject-level lifecycle match needs no body and must not be escalated.
  const decisive = metadataEmail({
    subject: "Thank you for applying to Acme Corp",
  });

  const result = classifyParsedEmails([decisive], "conn-1");

  assert.equal(result.ambiguous.length, 0, "nothing to escalate");
  assert.equal(result.candidates, 1);
  assert.equal(result.records[0].evidenceStrength, "strong");
});

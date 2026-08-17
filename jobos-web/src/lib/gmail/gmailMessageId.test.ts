/**
 * Gmail message ID persistence tests.
 *
 * Verifies that when a Gmail message creates or is linked to an application,
 * the source Gmail message ID is correctly persisted to applications.gmail_message_id.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { buildProposals } from "./proposals.ts";
import type { GmailActivityRow } from "../api/gmailActivity.ts";

function makeActivity(overrides: Partial<GmailActivityRow> = {}): GmailActivityRow {
  return {
    id: overrides.id ?? "activity-1",
    gmail_message_id: overrides.gmail_message_id ?? "msg-1",
    gmail_thread_id: overrides.gmail_thread_id ?? "thread-1",
    category: overrides.category ?? "APPLICATION_CONFIRMATION",
    email_date: overrides.email_date ?? "2026-06-01T10:00:00.000Z",
    company: overrides.company ?? "Acme Corp",
    job_title: overrides.job_title ?? "Engineer",
    location: overrides.location ?? null,
    job_url: overrides.job_url ?? null,
    application_id: overrides.application_id ?? null,
    sender: overrides.sender ?? null,
    sender_domain: overrides.sender_domain ?? null,
    inferred_status: overrides.inferred_status ?? null,
    confidence: overrides.confidence ?? 0.95,
    evidence_strength: overrides.evidence_strength ?? "strong",
    evidence_reason: overrides.evidence_reason ?? "lifecycle_confirmation",
  };
}

test("proposal preserves gmail_message_id from the earliest evidence", () => {
  const activities = [
    makeActivity({
      id: "act-1",
      gmail_message_id: "gmail-msg-first",
      email_date: "2026-06-01T10:00:00.000Z",
      gmail_thread_id: "thread-1",
    }),
    makeActivity({
      id: "act-2",
      gmail_message_id: "gmail-msg-second",
      email_date: "2026-06-10T10:00:00.000Z",
      gmail_thread_id: "thread-1",
    }),
  ];

  const proposals = buildProposals(activities, [], new Map(), Date.now());

  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].evidence.length, 2);
  // Earliest evidence should be first
  assert.equal(proposals[0].evidence[0].gmailMessageId, "gmail-msg-first");
});

test("proposals group by thread and preserve distinct gmail_message_ids", () => {
  const activities = [
    makeActivity({
      id: "act-1",
      gmail_message_id: "gmail-msg-thread1",
      gmail_thread_id: "thread-1",
      company: "Acme",
    }),
    makeActivity({
      id: "act-2",
      gmail_message_id: "gmail-msg-thread2",
      gmail_thread_id: "thread-2",
      company: "BetaCo",
    }),
  ];

  const proposals = buildProposals(activities, [], new Map(), Date.now());

  assert.equal(proposals.length, 2);
  assert.equal(proposals[0].evidence[0].gmailMessageId, "gmail-msg-thread1");
  assert.equal(proposals[1].evidence[0].gmailMessageId, "gmail-msg-thread2");
});

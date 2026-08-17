/**
 * Query builder, deterministic parser, heuristic filter, and evidence
 * persistence tests.
 *
 * Pure units — no network, no AI, no Supabase. `classifyParsedEmails` and
 * `buildProposals` are both pure, so the gate-verdict-to-ledger-row hand-off is
 * asserted directly, with no database fake.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ATS_DOMAINS,
  buildGmailQuery,
  DEFAULT_SCAN_WINDOW,
  quoteTerm,
  resolveWindow,
  toGmailDate,
} from "./query.ts";
import {
  extractBodyText,
  extractUrls,
  findJobUrl,
  getHeader,
  htmlToText,
  parseGmailMessage,
  parseMessageDate,
  parseSender,
  rootDomain,
} from "./parse.ts";
import {
  companyFromDomain,
  detectCategory,
  evaluateEmail,
  isAtsDomain,
  looksLikeBulkMail,
} from "./heuristics.ts";
import {
  AUTO_IMPORT_BATCH_CAP,
  AUTO_IMPORT_MIN_BUDGET_MS,
  BATCH_TIME_BUDGET_MS,
  classifyParsedEmails,
  resolveAutoImportPlan,
  runBatchAutoImport,
} from "./sync.ts";
import { buildProposals, type ActivityRowLike } from "./proposals.ts";
import type { GmailActivityRecord } from "../api/gmailActivity.ts";
import type { GmailMessage } from "./client.ts";

const FIXED_NOW = new Date("2026-06-15T12:00:00.000Z");

function b64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

/** Build a Gmail message fixture with sane defaults. */
function message(overrides: Partial<GmailMessage> & {
  headers?: Record<string, string>;
} = {}): GmailMessage {
  const { headers, ...rest } = overrides;
  return {
    id: "msg-1",
    threadId: "thread-1",
    snippet: "",
    internalDate: String(FIXED_NOW.getTime()),
    payload: {
      mimeType: "text/plain",
      headers: Object.entries(headers ?? { From: "a@example.com", Subject: "Hello" })
        .map(([name, value]) => ({ name, value })),
    },
    ...rest,
  };
}

/** Minimal ParsedEmail for heuristic tests. */
function parsed(overrides: Partial<ReturnType<typeof parseGmailMessage>> = {}) {
  return {
    gmailMessageId: "msg-1",
    gmailThreadId: "thread-1",
    subject: "",
    sender: "a@example.com",
    senderDomain: "example.com",
    senderRootDomain: "example.com",
    emailDate: FIXED_NOW.toISOString(),
    snippet: "",
    rfcMessageId: null,
    hasUnsubscribe: false,
    labelIds: [] as string[],
    jobUrl: null,
    bodyText: "",
    ...overrides,
  };
}

// ===========================================================================
// query.ts
// ===========================================================================

test("gmail date formatting is UTC and zero-padded", () => {
  assert.equal(toGmailDate(new Date("2026-01-05T23:59:00.000Z")), "2026/01/05");
  assert.equal(toGmailDate(new Date("2026-12-31T00:00:00.000Z")), "2026/12/31");
});

test("the legacy 6m range still resolves to 180 days of history", () => {
  const { start, end } = resolveWindow("6m", FIXED_NOW);
  assert.ok(start);
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  assert.equal(days, 180);
});

test("the default window is 30 days of history", () => {
  assert.equal(DEFAULT_SCAN_WINDOW, "30d");

  // No argument at all must resolve to the same 30-day window, so a caller that
  // omits the range cannot silently reintroduce the old 180-day scan.
  const { start, end } = resolveWindow(undefined, FIXED_NOW);
  assert.ok(start);
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  assert.equal(days, 30);
});

test("the all-time range omits a lower bound", () => {
  const { start } = resolveWindow("all", FIXED_NOW);
  assert.equal(start, null);
});

test("query carries both date bounds for a bounded range", () => {
  const query = buildGmailQuery({ range: "30d", now: FIXED_NOW });
  assert.ok(query.includes("after:2026/05/16"));
  // before: is exclusive, so the bound is pushed one day past today.
  assert.ok(query.includes("before:2026/06/16"));
});

test("query omits after: for all-time but still bounds the top end", () => {
  const query = buildGmailQuery({ range: "all", now: FIXED_NOW });
  assert.equal(query.includes("after:"), false);
  assert.ok(query.includes("before:"));
});

test("query always excludes spam, trash, and chats", () => {
  const query = buildGmailQuery({ range: "6m", now: FIXED_NOW });
  assert.ok(query.includes("-in:spam"));
  assert.ok(query.includes("-in:trash"));
  assert.ok(query.includes("-in:chats"));
});

test("query narrows by ATS sender so the whole mailbox is never scanned", () => {
  const query = buildGmailQuery({ range: "6m", now: FIXED_NOW });
  for (const domain of ATS_DOMAINS) {
    assert.ok(query.includes(`from:${domain}`), `missing from:${domain}`);
  }
  assert.ok(query.includes('subject:"application"'));
});

test("query terms are quoted and cannot break out of the term", () => {
  // A crafted term must not inject its own operators.
  const injected = quoteTerm('foo" OR from:evil.com "bar');
  assert.equal(injected.startsWith('"'), true);
  assert.equal(injected.endsWith('"'), true);
  assert.equal(injected.slice(1, -1).includes('"'), false);

  // The payload may still appear as TEXT, but only inside a quoted term where
  // Gmail treats it as a literal rather than an operator. What must never
  // happen is it escaping the quotes and becoming a real `from:` clause.
  const query = buildGmailQuery({
    range: "6m",
    now: FIXED_NOW,
    extraSubjectSignals: ['x" OR from:evil.com'],
  });
  assert.ok(query.includes('subject:"x  OR from:evil.com"'));
  assert.equal(query.includes('" OR from:evil.com'), false);
});

test("newlines in a term cannot split the query", () => {
  assert.equal(quoteTerm("a\nb\r\nc").includes("\n"), false);
});

// ===========================================================================
// parse.ts
// ===========================================================================

test("header lookup is case-insensitive", () => {
  const m = message({ headers: { "sUbJeCt": "Interview", FROM: "x@y.com" } });
  assert.equal(getHeader(m, "Subject"), "Interview");
  assert.equal(getHeader(m, "from"), "x@y.com");
  assert.equal(getHeader(m, "Missing"), null);
});

test("sender parsing handles display names and bare addresses", () => {
  assert.deepEqual(parseSender("Jane Doe <jane.doe@stripe.com>"), {
    sender: "jane.doe@stripe.com",
    senderDomain: "stripe.com",
  });
  assert.deepEqual(parseSender("bob@lever.co"), {
    sender: "bob@lever.co",
    senderDomain: "lever.co",
  });
  assert.deepEqual(parseSender('"Doe, Jane" <jane@acme.io>'), {
    sender: "jane@acme.io",
    senderDomain: "acme.io",
  });
});

test("malformed sender headers yield null rather than a bogus domain", () => {
  assert.deepEqual(parseSender(null), { sender: null, senderDomain: null });
  assert.deepEqual(parseSender(""), { sender: null, senderDomain: null });
  assert.deepEqual(parseSender("not-an-email"), { sender: null, senderDomain: null });
  assert.deepEqual(parseSender("no-at-sign.com"), { sender: null, senderDomain: null });
  assert.deepEqual(parseSender("a@b"), { sender: null, senderDomain: null });
});

test("subdomains collapse to a registrable root", () => {
  assert.equal(rootDomain("careers.eu.greenhouse.io"), "greenhouse.io");
  assert.equal(rootDomain("mail.stripe.com"), "stripe.com");
  assert.equal(rootDomain("stripe.com"), "stripe.com");
  assert.equal(rootDomain("jobs.example.co.uk"), "example.co.uk");
  assert.equal(rootDomain(null), null);
});

test("internalDate wins over a sender-supplied Date header", () => {
  const m = message({
    internalDate: String(Date.parse("2026-03-01T00:00:00.000Z")),
    headers: { Date: "Tue, 01 Jan 1990 00:00:00 +0000", From: "a@b.com" },
  });
  assert.equal(parseMessageDate(m), "2026-03-01T00:00:00.000Z");
});

test("a missing internalDate falls back to the Date header", () => {
  const m = message({
    internalDate: undefined,
    headers: { Date: "Wed, 01 Apr 2026 10:30:00 +0000", From: "a@b.com" },
  });
  assert.equal(parseMessageDate(m), "2026-04-01T10:30:00.000Z");
});

test("a message with no usable date yields null instead of guessing", () => {
  const m = message({ internalDate: undefined, headers: { From: "a@b.com" } });
  assert.equal(parseMessageDate(m), null);
});

test("text/plain body is preferred over html", () => {
  const m = message({
    payload: {
      mimeType: "multipart/alternative",
      headers: [],
      parts: [
        { mimeType: "text/plain", body: { data: b64("plain wins") } },
        { mimeType: "text/html", body: { data: b64("<p>html loses</p>") } },
      ],
    },
  });
  assert.equal(extractBodyText(m), "plain wins");
});

test("html is used when no plain part exists", () => {
  const m = message({
    payload: {
      mimeType: "text/html",
      headers: [],
      body: { data: b64("<p>Hello <b>there</b></p>") },
    },
  });
  assert.equal(extractBodyText(m), "Hello there");
});

test("attachments are skipped entirely", () => {
  const m = message({
    payload: {
      mimeType: "multipart/mixed",
      headers: [],
      parts: [
        { mimeType: "text/plain", body: { data: b64("real body") } },
        { mimeType: "application/pdf", filename: "resume.pdf", body: { data: b64("PDFDATA") } },
      ],
    },
  });
  const text = extractBodyText(m);
  assert.equal(text, "real body");
  assert.equal(text.includes("PDFDATA"), false);
});

test("metadata-only messages produce an empty body, not a crash", () => {
  const m = message({ payload: { mimeType: "text/plain", headers: [] } });
  assert.equal(extractBodyText(m), "");
});

test("malformed base64 degrades to empty text", () => {
  const m = message({
    payload: { mimeType: "text/plain", headers: [], body: { data: "!!!not-base64!!!" } },
  });
  assert.equal(typeof extractBodyText(m), "string");
});

test("html stripping removes scripts and decodes entities", () => {
  const html = "<style>.a{}</style><script>evil()</script><p>Tom &amp; Jerry</p>";
  const text = htmlToText(html);
  assert.equal(text.includes("evil()"), false);
  assert.equal(text.includes(".a{}"), false);
  assert.ok(text.includes("Tom & Jerry"));
});

test("urls are extracted, de-duplicated, and stripped of trailing punctuation", () => {
  const urls = extractUrls(
    "See https://boards.greenhouse.io/acme/jobs/123. Also https://boards.greenhouse.io/acme/jobs/123"
  );
  assert.deepEqual(urls, ["https://boards.greenhouse.io/acme/jobs/123"]);
});

test("only known ATS url shapes qualify as a job url", () => {
  assert.equal(
    findJobUrl(["https://boards.greenhouse.io/acme/jobs/4001"]),
    "https://boards.greenhouse.io/acme/jobs/4001"
  );
  assert.equal(findJobUrl(["https://jobs.lever.co/acme/abc-123"]), "https://jobs.lever.co/acme/abc-123");
  // A generic marketing link must never be trusted as a job posting.
  assert.equal(findJobUrl(["https://acme.com/blog/hiring"]), null);
  assert.equal(findJobUrl([]), null);
});

test("parseGmailMessage assembles the deterministic shape", () => {
  const m = message({
    id: "m9",
    threadId: "t9",
    snippet: "We received your application",
    headers: {
      From: "no-reply@greenhouse.io",
      Subject: "Thank you for applying to Acme",
      "Message-ID": "<abc@greenhouse.io>",
      "List-Unsubscribe": "<https://x/y>",
    },
  });

  const result = parseGmailMessage(m);
  assert.equal(result.gmailMessageId, "m9");
  assert.equal(result.gmailThreadId, "t9");
  assert.equal(result.senderRootDomain, "greenhouse.io");
  assert.equal(result.hasUnsubscribe, true);
  assert.equal(result.subject, "Thank you for applying to Acme");
});

// ===========================================================================
// heuristics.ts
// ===========================================================================

test("ATS domains are recognised, unknown domains are not", () => {
  assert.equal(isAtsDomain("greenhouse.io"), true);
  assert.equal(isAtsDomain("lever.co"), true);
  assert.equal(isAtsDomain("random-startup.dev"), false);
  assert.equal(isAtsDomain(null), false);
});

test("job-alert marketing is rejected even from an ATS domain", () => {
  const email = parsed({
    subject: "10 new jobs for you this week",
    senderRootDomain: "linkedin.com",
    hasUnsubscribe: true,
  });
  assert.equal(looksLikeBulkMail(email), true);

  const verdict = evaluateEmail(email);
  assert.equal(verdict.candidate, false);
  assert.equal(verdict.category, "NOT_JOB_RELATED");
  assert.equal(verdict.needsAI, false);
});

test("promotional-labelled mail is rejected without AI", () => {
  const verdict = evaluateEmail(
    parsed({ subject: "Upgrade to Premium", labelIds: ["CATEGORY_PROMOTIONS"] })
  );
  assert.equal(verdict.candidate, false);
  assert.equal(verdict.needsAI, false);
});

test("application confirmations classify deterministically", () => {
  const verdict = evaluateEmail(
    parsed({
      subject: "Thank you for applying to Acme",
      senderRootDomain: "greenhouse.io",
    })
  );
  assert.equal(verdict.category, "APPLICATION_CONFIRMATION");
  assert.equal(verdict.needsAI, false);
  assert.ok(verdict.confidence >= 0.9);
});

test("interview invitations classify deterministically", () => {
  const verdict = evaluateEmail(
    parsed({ subject: "Invitation to interview for Backend Engineer" })
  );
  assert.equal(verdict.category, "INTERVIEW_INVITATION");
  assert.equal(verdict.needsAI, false);
});

test("rejections classify deterministically", () => {
  const verdict = evaluateEmail(
    parsed({
      subject: "Your application to Acme",
      bodyText: "Unfortunately we have decided not to move forward with your application.",
    })
  );
  assert.equal(verdict.category, "REJECTION");
  assert.equal(verdict.needsAI, false);
});

test("offers classify deterministically and outrank weaker signals", () => {
  const verdict = evaluateEmail(
    parsed({
      subject: "Your offer of employment at Acme",
      bodyText: "We received your application earlier. We are pleased to offer you the role.",
    })
  );
  assert.equal(verdict.category, "OFFER");
});

test("a body-only match scores lower than a subject match", () => {
  const subjectHit = detectCategory(
    parsed({ subject: "Thank you for applying to Acme" })
  );
  const bodyHit = detectCategory(
    parsed({ subject: "Acme", bodyText: "Thank you for applying to Acme" })
  );
  assert.ok(subjectHit);
  assert.ok(bodyHit);
  assert.ok(subjectHit.confidence > bodyHit.confidence);
});

test("an ambiguous ATS message escalates to AI rather than guessing", () => {
  // An ATS sender is only ambiguous once it also addresses the reader as an
  // applicant. "Regarding your application" supplies that candidate-facing
  // language without matching any deterministic lifecycle pattern.
  const verdict = evaluateEmail(
    parsed({ subject: "Regarding your application", senderRootDomain: "greenhouse.io" })
  );
  assert.equal(verdict.candidate, true);
  assert.equal(verdict.category, null);
  assert.equal(verdict.needsAI, true);
});

test("a bare ATS sender no longer escalates to AI", () => {
  // The exact fixture that used to escalate on the sender domain alone. A
  // relayed sender is a routing fact, not evidence, so it must now be dropped
  // for free rather than costing a model call.
  const verdict = evaluateEmail(
    parsed({ subject: "An update from Acme", senderRootDomain: "greenhouse.io" })
  );
  assert.equal(verdict.candidate, false);
  assert.equal(verdict.needsAI, false);
  assert.equal(verdict.category, "NOT_JOB_RELATED");
});

test("an ATS sender with no candidate language is dropped for every ATS domain", () => {
  for (const domain of ATS_DOMAINS) {
    const verdict = evaluateEmail(
      parsed({ subject: "Weekly roundup", senderRootDomain: domain })
    );
    assert.equal(verdict.needsAI, false, `${domain} still escalates`);
    assert.equal(verdict.candidate, false, `${domain} is still a candidate`);
  }
});

test("a bare listed keyword no longer escalates to AI", () => {
  // Each of these words was independently sufficient under the deleted
  // `weakSignal` regex, which is what put ~637 of ~750 messages in the queue.
  const keywords = [
    "application",
    "applied",
    "candidate",
    "candidacy",
    "position",
    "role",
    "hiring",
    "recruiter",
  ];

  for (const keyword of keywords) {
    const verdict = evaluateEmail(
      parsed({ subject: `A note about the ${keyword}`, senderRootDomain: "unknown-co.dev" })
    );
    assert.equal(verdict.needsAI, false, `"${keyword}" still escalates`);
    assert.equal(verdict.candidate, false, `"${keyword}" is still a candidate`);
    assert.equal(verdict.reason, "no_job_signal");
  }
});

test("a promotions label beats a lifecycle phrase", () => {
  // Gmail's own filing is evaluated before lifecycle detection, so a
  // promotional message cannot launder itself into an application by quoting a
  // confirmation phrase.
  const verdict = evaluateEmail(
    parsed({
      subject: "Thank you for applying to Acme",
      senderRootDomain: "greenhouse.io",
      labelIds: ["CATEGORY_PROMOTIONS"],
    })
  );
  assert.equal(verdict.candidate, false);
  assert.equal(verdict.needsAI, false);
  assert.equal(verdict.category, "NOT_JOB_RELATED");
  assert.equal(verdict.reason, "bulk_or_marketing");

  // The phrase itself is genuinely a lifecycle match — it is the label that
  // rejects the message, not a missing pattern.
  assert.equal(
    detectCategory(parsed({ subject: "Thank you for applying to Acme" }))?.category,
    "APPLICATION_CONFIRMATION"
  );
});

test("an unrelated personal email is dropped without AI", () => {
  const verdict = evaluateEmail(
    parsed({ subject: "Lunch tomorrow?", senderRootDomain: "gmail.com" })
  );
  assert.equal(verdict.candidate, false);
  assert.equal(verdict.needsAI, false);
  assert.equal(verdict.reason, "no_job_signal");
});

test("a job url alone is enough to escalate to AI", () => {
  const verdict = evaluateEmail(
    parsed({
      subject: "Hello",
      senderRootDomain: "unknown-co.dev",
      jobUrl: "https://jobs.lever.co/acme/abc",
    })
  );
  assert.equal(verdict.needsAI, true);
  assert.equal(verdict.reason, "job_url");
});

test("company is inferred from an employer domain but never from ATS or freemail", () => {
  assert.equal(companyFromDomain("stripe.com"), "Stripe");
  // The ATS is the vendor, not the employer.
  assert.equal(companyFromDomain("greenhouse.io"), null);
  assert.equal(companyFromDomain("gmail.com"), null);
  assert.equal(companyFromDomain(null), null);
});

// ===========================================================================
// Evidence persistence: gate verdict -> ledger row -> proposal
// ===========================================================================
//
// The gate's verdict is only useful if it survives the write. These tests pin
// the whole hand-off: what `classifyParsedEmails` puts in `evidence_strength` /
// `evidence_reason`, and what `buildProposals` then concludes from it. The
// gate's own classification behaviour is covered by applicationEvidence.test.ts
// and is deliberately not retested here.

/** One ledger row, shaped as `buildProposals` reads it back from the database. */
function activityRow(
  record: GmailActivityRecord,
  id: string
): ActivityRowLike {
  return {
    id,
    gmail_message_id: record.gmailMessageId,
    gmail_thread_id: record.gmailThreadId,
    application_id: null,
    category: record.category,
    company: record.company,
    job_title: record.jobTitle,
    job_url: record.jobUrl,
    location: record.location,
    email_date: record.emailDate,
    sender: record.sender,
    sender_domain: record.senderDomain,
    confidence: record.confidence,
    evidence_strength: record.evidenceStrength,
  };
}

test("a strong lifecycle message is ledgered as strong with a lifecycle reason", () => {
  const { records, ambiguous } = classifyParsedEmails(
    [
      parsed({
        gmailMessageId: "m-strong",
        subject: "Thank you for applying to Acme",
        senderRootDomain: "greenhouse.io",
      }),
    ],
    "conn-1"
  );

  assert.equal(ambiguous.length, 0);
  assert.equal(records.length, 1);

  const record = records[0];
  assert.equal(record.category, "APPLICATION_CONFIRMATION");
  assert.equal(record.evidenceStrength, "strong");
  assert.equal(record.evidenceReason, "lifecycle_subject_match");
});

test("a gate-rejected message is still ledgered, with a null strength and its exclusion reason", () => {
  const { records, ambiguous, candidates } = classifyParsedEmails(
    [
      parsed({
        gmailMessageId: "m-alert",
        subject: "10 new jobs for you this week",
        senderRootDomain: "linkedin.com",
      }),
    ],
    "conn-1"
  );

  assert.equal(candidates, 0);
  assert.equal(ambiguous.length, 0);
  assert.equal(records.length, 1, "a rejection must cost a row so a re-scan is free");

  const record = records[0];
  // A job ALERT is now ledgered as a JOB_OPPORTUNITY (FIX 2), not as
  // NOT_JOB_RELATED — still a rejection from the application path (not a
  // candidate, null strength), but countable separately as an opportunity.
  assert.equal(record.category, "JOB_OPPORTUNITY");
  // The schema's CHECK allows only NULL | 'strong' | 'weak', so the gate's
  // third verdict is stored as NULL — but the reason code survives.
  assert.equal(record.evidenceStrength, null);
  assert.equal(record.evidenceReason, "excluded_job_alert");
});

test("a message with no evidence at all is ledgered with its no-signal reason", () => {
  const { records } = classifyParsedEmails(
    [parsed({ gmailMessageId: "m-keyword", subject: "A note about the role" })],
    "conn-1"
  );

  assert.equal(records.length, 1);
  assert.equal(records[0].evidenceStrength, null);
  assert.equal(records[0].evidenceReason, "keyword_only");
});

test("an ambiguous ATS message carries its escalation reason forward instead of being stored", () => {
  const { records, ambiguous, ambiguousReasons } = classifyParsedEmails(
    [
      parsed({
        gmailMessageId: "m-weak",
        subject: "Regarding your application",
        senderRootDomain: "greenhouse.io",
      }),
    ],
    "conn-1"
  );

  // Nothing is written until the AI stage has had its turn.
  assert.deepEqual(records, []);
  assert.equal(ambiguous.length, 1);
  // The reason the message was escalated is the reason its row will carry, so
  // the AI paths never have to invent a code of their own.
  assert.equal(
    ambiguousReasons.get("m-weak"),
    "ats_sender_with_candidate_language"
  );
});

test("only a strong lifecycle row makes a proposal auto-importable", () => {
  const { records } = classifyParsedEmails(
    [
      parsed({
        gmailMessageId: "m-strong",
        subject: "Thank you for applying to Acme",
        senderRootDomain: "acme.com",
      }),
    ],
    "conn-1"
  );
  const strongRow = activityRow(records[0], "a1");

  const [strongProposal] = buildProposals([strongRow], []);
  assert.equal(strongProposal.evidenceStrength, "strong");
  assert.equal(strongProposal.isLifecycleEvent, true);
  assert.equal(strongProposal.hasStrongEvidence, true);

  // The same lifecycle category with a weak strength — an AI-derived verdict —
  // must never satisfy the auto-create precondition.
  const [weakProposal] = buildProposals(
    [{ ...strongRow, evidence_strength: "weak" }],
    []
  );
  assert.equal(weakProposal.evidenceStrength, "weak");
  assert.equal(weakProposal.isLifecycleEvent, true);
  assert.equal(weakProposal.hasStrongEvidence, false);

  // A pre-migration row with no stored strength reads as not strong.
  const [legacyProposal] = buildProposals(
    [{ ...strongRow, evidence_strength: null }],
    []
  );
  assert.equal(legacyProposal.evidenceStrength, null);
  assert.equal(legacyProposal.hasStrongEvidence, false);
});

// ===========================================================================
// Auto_Importer wiring inside a sync batch
// ===========================================================================
//
// The importer itself is tested against a fake Supabase in autoImport.test.ts.
// What is tested here is the WIRING: the budget gate, the proposal cap, the
// failure absorption, and the fact that the importer runs strictly after both
// the ledger write and the cursor/progress write, so it can never change what
// was stored or where the next batch resumes.

/** The wired module's own source, for the ordering assertions below. */
const SYNC_SOURCE = readFileSync(new URL("./sync.ts", import.meta.url), "utf8");

/** Records what the injected runner was asked to do. */
function recordingRunner(result: { created: number; updated: number }) {
  const caps: number[] = [];
  return {
    caps,
    run: async (maxProposals: number) => {
      caps.push(maxProposals);
      return result;
    },
  };
}

/** Swallow the wiring's non-content log line while asserting a failure path. */
async function withSilencedErrors<T>(fn: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = original;
  }
}

test("auto import runs only after persistence and after the cursor is written", () => {
  const insertAt = SYNC_SOURCE.indexOf("await insertGmailActivity(");
  const progressAt = SYNC_SOURCE.indexOf("await updateSyncJobProgress(");
  const autoImportAt = SYNC_SOURCE.indexOf("await runBatchAutoImport(");

  assert.ok(insertAt > 0, "the batch must still persist its ledger rows");
  assert.ok(progressAt > 0, "the batch must still write its cursor/progress");
  assert.ok(autoImportAt > 0, "the batch must invoke the Auto_Importer");

  // The importer reads the evidence this batch just wrote, so persistence has
  // to come first.
  assert.ok(
    insertAt < autoImportAt,
    "the Auto_Importer must run after insertGmailActivity"
  );
  // Running after the progress write is what makes the cursor unreachable from
  // the importer: by the time it starts, the cursor is already committed.
  assert.ok(
    progressAt < autoImportAt,
    "the Auto_Importer must run after the cursor/progress write"
  );

  // Exactly one call site, and it delegates to the importer rather than
  // rebuilding proposals in sync.ts.
  assert.equal(SYNC_SOURCE.split("await runBatchAutoImport(").length - 1, 1);
  assert.ok(SYNC_SOURCE.includes("runAutoImport(supabase, userId, { maxProposals })"));
});

test("the importer's created/updated counts are what the batch result reports", async () => {
  const runner = recordingRunner({ created: 3, updated: 2 });

  const outcome = await runBatchAutoImport(
    { run: true, maxProposals: AUTO_IMPORT_BATCH_CAP },
    runner.run
  );

  // The full outcome, diagnostic counters included. Those counters exist because
  // a bare `created: 0` could not distinguish "no lifecycle evidence was read"
  // from "evidence was read and held" from "writes were attempted and rejected";
  // this runner reports no counters, so they read as 0.
  assert.deepEqual(outcome, {
    applicationsCreated: 3,
    applicationsUpdated: 2,
    examined: 0,
    linked: 0,
    heldAmbiguous: 0,
    heldUnknownEmployer: 0,
    proposalsFailed: 0,
    failed: false,
  });

  // And those are the values the returned BatchResult carries.
  assert.ok(SYNC_SOURCE.includes("applicationsCreated: autoImport.applicationsCreated"));
  assert.ok(SYNC_SOURCE.includes("applicationsUpdated: autoImport.applicationsUpdated"));
});

test("an auto import failure is absorbed and reports no applications", async () => {
  const outcome = await withSilencedErrors(() =>
    runBatchAutoImport({ run: true, maxProposals: AUTO_IMPORT_BATCH_CAP }, async () => {
      throw new Error("applications insert failed");
    })
  );

  // Never rethrown: the scan's own result stands, so the ledger rows and the
  // Gmail/Reconnect error taxonomy are untouched by an importer failure.
  assert.equal(outcome.failed, true);
  assert.equal(outcome.applicationsCreated, 0);
  assert.equal(outcome.applicationsUpdated, 0);
});

test("cursor progress is unaffected by an auto import failure", async () => {
  // Structural half: the cursor is resolved and written before the importer is
  // even called, and the call site is the last statement before the return.
  const progressAt = SYNC_SOURCE.indexOf("await updateSyncJobProgress(");
  const autoImportAt = SYNC_SOURCE.indexOf("await runBatchAutoImport(");
  const cursorAt = SYNC_SOURCE.indexOf("resolveNextCursor({");
  assert.ok(cursorAt < progressAt && progressAt < autoImportAt);

  // Behavioural half: a rejecting importer resolves instead of throwing, so
  // control always reaches the return that reports the stored cursor.
  const outcome = await withSilencedErrors(() =>
    runBatchAutoImport({ run: true, maxProposals: AUTO_IMPORT_BATCH_CAP }, () =>
      Promise.reject(new Error("supabase unavailable"))
    )
  );
  assert.equal(outcome.failed, true);

  // A failure only ever adds a non-content notice; it cannot flip `done` or the
  // page token.
  assert.equal(SYNC_SOURCE.includes("done = autoImport"), false);
  assert.equal(SYNC_SOURCE.includes("pageToken = autoImport"), false);
});

test("auto import is skipped when too little batch budget remains", async () => {
  // Exactly AUTO_IMPORT_MIN_BUDGET_MS left is not MORE than the minimum.
  const atThreshold = resolveAutoImportPlan({
    elapsedMs: BATCH_TIME_BUDGET_MS - AUTO_IMPORT_MIN_BUDGET_MS,
  });
  assert.equal(atThreshold.run, false);

  assert.equal(
    resolveAutoImportPlan({
      elapsedMs: BATCH_TIME_BUDGET_MS - AUTO_IMPORT_MIN_BUDGET_MS + 1,
    }).run,
    false
  );
  // A batch that already overran its budget never starts the importer.
  assert.equal(
    resolveAutoImportPlan({ elapsedMs: BATCH_TIME_BUDGET_MS * 2 }).run,
    false
  );
  // A fast batch has budget to spare.
  assert.equal(resolveAutoImportPlan({ elapsedMs: 0 }).run, true);

  // Skipped means not invoked at all — no reads, no writes, no counts.
  const runner = recordingRunner({ created: 9, updated: 9 });
  const outcome = await runBatchAutoImport(atThreshold, runner.run);

  assert.deepEqual(runner.caps, [], "the importer must not be called at all");
  // Every counter zero, including the diagnostic ones: a skipped importer must
  // not report work, and must not report holds it never evaluated either.
  assert.deepEqual(outcome, {
    applicationsCreated: 0,
    applicationsUpdated: 0,
    examined: 0,
    linked: 0,
    heldAmbiguous: 0,
    heldUnknownEmployer: 0,
    proposalsFailed: 0,
    failed: false,
  });
});

test("the batch cap is what the importer is given as its proposal limit", async () => {
  const plan = resolveAutoImportPlan({ elapsedMs: 0 });
  assert.equal(plan.maxProposals, AUTO_IMPORT_BATCH_CAP);

  const runner = recordingRunner({ created: 1, updated: 0 });
  await runBatchAutoImport(plan, runner.run);

  assert.deepEqual(runner.caps, [AUTO_IMPORT_BATCH_CAP]);
  assert.ok(AUTO_IMPORT_BATCH_CAP > 0);
});

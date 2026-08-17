/**
 * Incremental sync, bounded concurrency, and API-cost benchmark tests.
 *
 * Network is stubbed; no Supabase involvement. The benchmark section counts
 * API calls analytically rather than inventing wall-clock timings, because real
 * latency depends on the user's mailbox and Google's response times.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";

import {
  GmailApiError,
  GmailHistoryExpiredError,
  getProfile,
  listHistory,
  listMessages,
} from "./client.ts";
import {
  BATCH_MESSAGE_LIMIT,
  GMAIL_LIST_PAGE_SIZE,
  classifyParsedEmails,
  mapWithConcurrency,
  resolveJobQueryInstant,
  resolveNextCursor,
  summarizeListing,
} from "./sync.ts";
import { buildGmailQuery } from "./query.ts";
import { detectCategory, evaluateEmail, isAtsDomain } from "./heuristics.ts";
import { resolveStatus, shouldUpdateStatus } from "./statusInference.ts";
import { findProcessedMessageIds } from "../api/gmailActivity.ts";
import type { ParsedEmail } from "./parse.ts";

const realFetch = globalThis.fetch;

function stubFetch(
  handler: (url: string, init?: RequestInit) => Promise<Response>
): void {
  globalThis.fetch = ((input: unknown, init?: RequestInit) =>
    handler(String(input), init)) as typeof fetch;
}

function restoreFetch(): void {
  globalThis.fetch = realFetch;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ===========================================================================
// Bounded concurrency
// ===========================================================================

test("concurrency never exceeds the configured bound", async () => {
  let inFlight = 0;
  let peak = 0;

  const items = Array.from({ length: 50 }, (_, i) => i);

  await mapWithConcurrency(items, 5, async (item) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 1));
    inFlight -= 1;
    return item;
  });

  assert.ok(peak <= 5, `peak concurrency ${peak} exceeded the bound of 5`);
  assert.equal(inFlight, 0);
});

test("bounded concurrency preserves input order in results", async () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8];

  const results = await mapWithConcurrency(items, 3, async (item) => {
    // Deliberately finish out of order.
    await new Promise((resolve) => setTimeout(resolve, (10 - item) % 4));
    return item * 2;
  });

  assert.deepEqual(results, [2, 4, 6, 8, 10, 12, 14, 16]);
});

test("concurrency helper processes every item exactly once", async () => {
  const seen = new Map<number, number>();
  const items = Array.from({ length: 37 }, (_, i) => i);

  await mapWithConcurrency(items, 4, async (item) => {
    seen.set(item, (seen.get(item) ?? 0) + 1);
    return item;
  });

  assert.equal(seen.size, 37);
  for (const count of seen.values()) {
    assert.equal(count, 1, "no item may be processed twice");
  }
});

test("an empty input does no work and spawns no workers", async () => {
  let calls = 0;
  const results = await mapWithConcurrency([], 5, async () => {
    calls += 1;
    return null;
  });
  assert.deepEqual(results, []);
  assert.equal(calls, 0);
});

// ===========================================================================
// getProfile — the anchor capture
// ===========================================================================

test("getProfile returns the mailbox historyId anchor", async () => {
  stubFetch(async (url) => {
    assert.ok(url.includes("/users/me/profile"));
    return json({ emailAddress: "a@b.com", messagesTotal: 1919, historyId: "987654" });
  });

  try {
    const profile = await getProfile("token");
    assert.equal(profile.historyId, "987654");
    assert.equal(profile.messagesTotal, 1919);
  } finally {
    restoreFetch();
  }
});

// ===========================================================================
// history.list — incremental listing
// ===========================================================================

test("history.list requests only messageAdded and returns added ids", async () => {
  let seenUrl = "";

  stubFetch(async (url) => {
    seenUrl = url;
    return json({
      history: [
        { id: "1", messagesAdded: [{ message: { id: "m1", threadId: "t1" } }] },
        { id: "2", messagesAdded: [{ message: { id: "m2", threadId: "t2" } }] },
      ],
      historyId: "1005",
    });
  });

  try {
    const result = await listHistory("token", { startHistoryId: "1000" });

    assert.ok(seenUrl.includes("startHistoryId=1000"));
    // Label changes and deletions cannot create an application, so asking for
    // them would be pure cost.
    assert.ok(seenUrl.includes("historyTypes=messageAdded"));
    assert.deepEqual(result.messages, [
      { id: "m1", threadId: "t1" },
      { id: "m2", threadId: "t2" },
    ]);
    assert.equal(result.historyId, "1005");
    assert.equal(result.nextPageToken, null);
  } finally {
    restoreFetch();
  }
});

test("a message appearing in several history entries is returned once", async () => {
  stubFetch(async () =>
    json({
      history: [
        { id: "1", messagesAdded: [{ message: { id: "dup", threadId: "t1" } }] },
        { id: "2", messagesAdded: [{ message: { id: "dup", threadId: "t1" } }] },
        { id: "3", messagesAdded: [{ message: { id: "other", threadId: "t2" } }] },
      ],
      historyId: "1010",
    })
  );

  try {
    const result = await listHistory("token", { startHistoryId: "1000" });
    assert.equal(result.messages.length, 2);
    assert.deepEqual(
      result.messages.map((m) => m.id).sort(),
      ["dup", "other"]
    );
  } finally {
    restoreFetch();
  }
});

test("an empty history means nothing changed and costs one call", async () => {
  let calls = 0;
  stubFetch(async () => {
    calls += 1;
    return json({ historyId: "1000" });
  });

  try {
    const result = await listHistory("token", { startHistoryId: "1000" });
    assert.deepEqual(result.messages, []);
    assert.equal(calls, 1, "an unchanged mailbox must cost exactly one call");
  } finally {
    restoreFetch();
  }
});

test("history pagination is surfaced so the scan can resume", async () => {
  stubFetch(async () =>
    json({
      history: [{ id: "1", messagesAdded: [{ message: { id: "m1", threadId: "t1" } }] }],
      nextPageToken: "page-2",
      historyId: "2000",
    })
  );

  try {
    const result = await listHistory("token", { startHistoryId: "1000" });
    assert.equal(result.nextPageToken, "page-2");
  } finally {
    restoreFetch();
  }
});

test("malformed history entries are skipped rather than crashing the scan", async () => {
  stubFetch(async () =>
    json({
      history: [
        { id: "1", messagesAdded: [{ message: { id: "m1" } }] }, // no threadId
        { id: "2", messagesAdded: [{}] }, // no message
        { id: "3" }, // no messagesAdded
        { id: "4", messagesAdded: [{ message: { id: "good", threadId: "t" } }] },
      ],
      historyId: "3000",
    })
  );

  try {
    const result = await listHistory("token", { startHistoryId: "1000" });
    assert.deepEqual(result.messages, [{ id: "good", threadId: "t" }]);
  } finally {
    restoreFetch();
  }
});

// ===========================================================================
// Expired anchor → documented full-sync fallback
// ===========================================================================

test("a 404 on the stored anchor raises the expired-history signal", async () => {
  stubFetch(async () =>
    json({ error: { code: 404, message: "Requested entity was not found." } }, 404)
  );

  try {
    await assert.rejects(
      () => listHistory("token", { startHistoryId: "1" }),
      GmailHistoryExpiredError
    );
  } finally {
    restoreFetch();
  }
});

test("a rate limit is NOT mistaken for an expired anchor", async () => {
  stubFetch(async () =>
    json({ error: { message: "rateLimitExceeded" } }, 429)
  );

  try {
    await assert.rejects(
      () => listHistory("token", { startHistoryId: "1" }),
      (error: unknown) => {
        // Must stay retryable, not trigger a needless full re-scan.
        assert.equal(error instanceof GmailHistoryExpiredError, false);
        assert.ok(error instanceof GmailApiError);
        assert.equal(error.kind, "rate_limit");
        return true;
      }
    );
  } finally {
    restoreFetch();
  }
});

// ===========================================================================
// List page size is decoupled from the processing batch size
// ===========================================================================

test("list page size and processing batch size are independent", () => {
  // Conflating these was the cause of ~20x more request cycles than needed.
  assert.ok(
    GMAIL_LIST_PAGE_SIZE > BATCH_MESSAGE_LIMIT,
    "a list page should cover more than one processing batch"
  );
  // Gmail caps maxResults at 500.
  assert.ok(GMAIL_LIST_PAGE_SIZE <= 500);
  assert.ok(BATCH_MESSAGE_LIMIT > 0);
});

test("messages.list forwards the requested page size", async () => {
  let seenUrl = "";
  stubFetch(async (url) => {
    seenUrl = url;
    return json({ messages: [], resultSizeEstimate: 0 });
  });

  try {
    await listMessages("token", { query: "test", maxResults: GMAIL_LIST_PAGE_SIZE });
    assert.ok(seenUrl.includes(`maxResults=${GMAIL_LIST_PAGE_SIZE}`));
  } finally {
    restoreFetch();
  }
});

// ===========================================================================
// BENCHMARK — analytical API-call cost, old vs new
// ===========================================================================

/**
 * Gmail API call accounting for a full scan.
 *
 * ESTIMATED, not measured: this counts calls and request cycles, which are
 * deterministic properties of the architecture. It does not claim wall-clock
 * timings, which depend on network and provider latency.
 */
function fullScanCost(args: {
  messages: number;
  listPageSize: number;
  processPerRequest: number;
}) {
  const listCalls = Math.ceil(args.messages / args.listPageSize);
  // One metadata fetch per message, once — the ledger prevents repeats.
  const getCalls = args.messages;
  // Each client->server request cycle carries auth + token read + several
  // Supabase round-trips, so this is the dominant fixed overhead.
  const requestCycles = Math.ceil(args.messages / args.processPerRequest);

  return { listCalls, getCalls, requestCycles };
}

test("BENCHMARK: request cycles drop sharply versus the old configuration", () => {
  const OLD = { listPageSize: 25, processPerRequest: 25 };
  const NEW = {
    listPageSize: GMAIL_LIST_PAGE_SIZE,
    processPerRequest: BATCH_MESSAGE_LIMIT,
  };

  for (const messages of [1_000, 10_000, 20_000]) {
    const before = fullScanCost({ messages, ...OLD });
    const after = fullScanCost({ messages, ...NEW });

    // messages.get is irreducible: every message must be inspected once.
    assert.equal(before.getCalls, after.getCalls, "message coverage must be identical");

    // The two reducible terms must both improve materially.
    assert.ok(
      after.requestCycles * 2 <= before.requestCycles,
      `request cycles for ${messages}: ${before.requestCycles} -> ${after.requestCycles}`
    );
    assert.ok(
      after.listCalls * 4 <= before.listCalls,
      `list calls for ${messages}: ${before.listCalls} -> ${after.listCalls}`
    );
  }
});

test("BENCHMARK: incremental sync cost is proportional to change, not mailbox size", () => {
  // A full scan is proportional to the mailbox.
  const full = fullScanCost({
    messages: 20_000,
    listPageSize: GMAIL_LIST_PAGE_SIZE,
    processPerRequest: BATCH_MESSAGE_LIMIT,
  });

  // An incremental sync only ever sees what history.list reports.
  const changed = 20;
  const incremental = fullScanCost({
    messages: changed,
    listPageSize: GMAIL_LIST_PAGE_SIZE,
    processPerRequest: BATCH_MESSAGE_LIMIT,
  });

  assert.equal(incremental.listCalls, 1);
  assert.equal(incremental.requestCycles, 1);
  assert.equal(incremental.getCalls, changed);

  // This is the whole point of the anchor: the second sync is orders of
  // magnitude cheaper than the first.
  assert.ok(incremental.getCalls * 100 < full.getCalls);
});

test("BENCHMARK: an unchanged mailbox costs a single history call", () => {
  const cost = fullScanCost({
    messages: 0,
    listPageSize: GMAIL_LIST_PAGE_SIZE,
    processPerRequest: BATCH_MESSAGE_LIMIT,
  });

  assert.equal(cost.getCalls, 0, "no message fetches when nothing changed");
  assert.equal(cost.listCalls, 0);
});

// ===========================================================================
// Cursor safety — the hold-back rule that makes a partial page resumable
// ===========================================================================

/** Page tokens are opaque strings; `null` means "no further page". */
const PAGE_TOKENS = ["page-1", "page-2", "page-3"] as const;

// Feature: gmail-application-precision, Property 8: The page cursor never
// advances past unprocessed messages
test("Property 8: the page cursor never advances past unprocessed messages", () => {
  fc.assert(
    fc.property(
      fc.boolean(),
      fc.option(fc.constantFrom(...PAGE_TOKENS), { nil: null }),
      fc.option(fc.constantFrom(...PAGE_TOKENS), { nil: null }),
      (pageFullyProcessed, nextPageToken, storedPageToken) => {
        const resolved = resolveNextCursor({
          pageFullyProcessed,
          nextPageToken,
          storedPageToken,
        });

        if (pageFullyProcessed) {
          // The whole page is in the ledger, so moving on skips nothing.
          assert.equal(resolved.pageToken, nextPageToken);
        } else {
          // Anything else would strand the unprocessed remainder forever.
          assert.equal(resolved.pageToken, storedPageToken);
          assert.equal(resolved.done, false);

          // Stated as the negative, which is the actual safety claim: an
          // unfinished page must not resolve to the *next* page's token.
          if (nextPageToken !== storedPageToken) {
            assert.notEqual(resolved.pageToken, nextPageToken);
          }
        }

        // The scan stops only when there is nothing left on this page and no
        // further page to list.
        assert.equal(
          resolved.done,
          pageFullyProcessed && nextPageToken === null
        );
      }
    ),
    { numRuns: 100 }
  );
});

test("a held cursor re-lists the same page rather than skipping ahead", () => {
  // Concrete shape of the hold-back: a page with more fresh messages than
  // BATCH_MESSAGE_LIMIT leaves the stored cursor exactly where it was, and the
  // ledger reduces the re-listed page to the unprocessed remainder.
  const held = resolveNextCursor({
    pageFullyProcessed: false,
    nextPageToken: "page-2",
    storedPageToken: "page-1",
  });
  assert.deepEqual(held, { pageToken: "page-1", done: false });

  const advanced = resolveNextCursor({
    pageFullyProcessed: true,
    nextPageToken: "page-2",
    storedPageToken: "page-1",
  });
  assert.deepEqual(advanced, { pageToken: "page-2", done: false });

  const finished = resolveNextCursor({
    pageFullyProcessed: true,
    nextPageToken: null,
    storedPageToken: "page-1",
  });
  assert.deepEqual(finished, { pageToken: null, done: true });
});

test("the first page of a scan holds a null cursor when it is not finished", () => {
  // storedPageToken is null on the first batch; an unfinished first page must
  // stay on the first page instead of jumping to the second.
  const resolved = resolveNextCursor({
    pageFullyProcessed: false,
    nextPageToken: "page-2",
    storedPageToken: null,
  });

  assert.equal(resolved.pageToken, null);
  assert.equal(resolved.done, false);
});

// ===========================================================================
// BENCHMARK — AI escalations under the Evidence Gate
// ===========================================================================
//
// The call-cost benchmark above counts Gmail requests. This section counts the
// other spend: how many messages reach the model. It is analytical in the same
// way — a fixed fixture corpus, classified by the real gate, with the escalation
// count asserted exactly rather than estimated.
//
// The comparison baseline is the two escalation rules the gate REPLACED, which
// are documented at the top of heuristics.ts:
//
//   - the `weakSignal` keyword regex (application|applied|candidate|candidacy|
//     position|role|hiring|recruit), and
//   - the bare `fromAts` sender escalation.
//
// Those rules no longer exist, so the baseline is computed from their stated
// definitions rather than by replaying a deleted module. That is the honest
// claim available here: for every fixture below, whether the deleted rules would
// have paid for a model call, versus whether the gate does.

const CORPUS_NOW = "2026-06-15T12:00:00.000Z";

/** Minimal ParsedEmail; every field the gate reads is set explicitly. */
function parsed(overrides: Partial<ParsedEmail> = {}): ParsedEmail {
  return {
    gmailMessageId: "msg-1",
    gmailThreadId: "thread-1",
    subject: "",
    sender: "someone@example.com",
    senderDomain: "example.com",
    senderRootDomain: "example.com",
    emailDate: CORPUS_NOW,
    snippet: "",
    rfcMessageId: null,
    hasUnsubscribe: false,
    labelIds: [],
    jobUrl: null,
    bodyText: "",
    ...overrides,
  };
}

/** What class of mail a fixture represents, and so what it must cost. */
type FixtureClass =
  | "excluded"
  | "strong_lifecycle"
  | "bare_ats"
  | "bare_keyword"
  | "ambiguous";

interface Fixture {
  name: string;
  fixtureClass: FixtureClass;
  email: ParsedEmail;
}

/**
 * A fixed corpus, deliberately weighted the way a real mailbox is: mostly noise,
 * a handful of genuine lifecycle mail, and only a couple of genuinely ambiguous
 * messages.
 */
const CORPUS: readonly Fixture[] = [
  // --- noise the gate hard-excludes ---------------------------------------
  {
    name: "job alert digest",
    fixtureClass: "excluded",
    email: parsed({
      gmailMessageId: "m-01",
      subject: "5 new jobs for Backend Engineer",
      sender: "jobalerts@linkedin.com",
      senderRootDomain: "linkedin.com",
    }),
  },
  {
    name: "profile view notification",
    fixtureClass: "excluded",
    email: parsed({
      gmailMessageId: "m-02",
      subject: "Someone viewed your profile",
      sender: "notifications@linkedin.com",
      senderRootDomain: "linkedin.com",
    }),
  },
  {
    name: "loan application received",
    fixtureClass: "excluded",
    email: parsed({
      gmailMessageId: "m-03",
      subject: "Your loan application has been received",
      sender: "no-reply@bank.example",
      senderRootDomain: "bank.example",
    }),
  },
  {
    name: "certification course promotion",
    fixtureClass: "excluded",
    email: parsed({
      gmailMessageId: "m-04",
      subject: "Enroll now: free certification for data engineers",
      sender: "learn@courses.example",
      senderRootDomain: "courses.example",
    }),
  },
  {
    name: "hiring announcement",
    fixtureClass: "excluded",
    email: parsed({
      gmailMessageId: "m-05",
      subject: "Acme is hiring backend engineers",
      sender: "team@acme.example",
      senderRootDomain: "acme.example",
    }),
  },
  {
    name: "application viewed engagement metric",
    fixtureClass: "excluded",
    email: parsed({
      gmailMessageId: "m-06",
      subject: "Your application was viewed by 4 recruiters",
      sender: "info@naukri.com",
      senderRootDomain: "naukri.com",
    }),
  },

  // --- genuine lifecycle evidence, resolved for free ----------------------
  {
    name: "application confirmation",
    fixtureClass: "strong_lifecycle",
    email: parsed({
      gmailMessageId: "m-07",
      subject: "Thank you for applying to Acme",
      sender: "careers@acme.example",
      senderRootDomain: "acme.example",
    }),
  },
  {
    name: "interview invitation",
    fixtureClass: "strong_lifecycle",
    email: parsed({
      gmailMessageId: "m-08",
      subject: "Invitation to interview for Backend Engineer",
      sender: "talent@acme.example",
      senderRootDomain: "acme.example",
    }),
  },
  {
    name: "rejection",
    fixtureClass: "strong_lifecycle",
    email: parsed({
      gmailMessageId: "m-09",
      subject: "We regret to inform you about the Backend Engineer role",
      sender: "no-reply@greenhouse.io",
      senderRootDomain: "greenhouse.io",
    }),
  },
  {
    name: "offer",
    fixtureClass: "strong_lifecycle",
    email: parsed({
      gmailMessageId: "m-10",
      subject: "Your offer letter is attached",
      sender: "hr@acme.example",
      senderRootDomain: "acme.example",
    }),
  },
  {
    name: "online assessment invitation",
    fixtureClass: "strong_lifecycle",
    email: parsed({
      gmailMessageId: "m-11",
      subject: "Complete your online assessment",
      sender: "assessments@lever.co",
      senderRootDomain: "lever.co",
    }),
  },

  // --- bare ATS senders: the deleted `fromAts` escalation -----------------
  {
    name: "bare ATS: generic update",
    fixtureClass: "bare_ats",
    email: parsed({
      gmailMessageId: "m-12",
      subject: "An update from Acme",
      sender: "no-reply@greenhouse.io",
      senderRootDomain: "greenhouse.io",
    }),
  },
  {
    name: "bare ATS: team note",
    fixtureClass: "bare_ats",
    email: parsed({
      gmailMessageId: "m-13",
      subject: "Notes from our team",
      sender: "no-reply@lever.co",
      senderRootDomain: "lever.co",
    }),
  },
  {
    name: "bare ATS: weekly summary",
    fixtureClass: "bare_ats",
    email: parsed({
      gmailMessageId: "m-14",
      subject: "Weekly summary",
      sender: "notify@myworkday.com",
      senderRootDomain: "myworkday.com",
    }),
  },
  {
    name: "bare ATS: reminder",
    fixtureClass: "bare_ats",
    email: parsed({
      gmailMessageId: "m-15",
      subject: "A reminder from the team",
      sender: "info@naukri.com",
      senderRootDomain: "naukri.com",
    }),
  },

  // --- bare keywords: the deleted `weakSignal` regex ----------------------
  {
    name: "bare keyword: roles discussion",
    fixtureClass: "bare_keyword",
    email: parsed({
      gmailMessageId: "m-16",
      subject: "Notes from the roles discussion",
      sender: "colleague@example.com",
    }),
  },
  {
    name: "bare keyword: recruiting offsite",
    fixtureClass: "bare_keyword",
    email: parsed({
      gmailMessageId: "m-17",
      subject: "Recruiting team offsite agenda",
      sender: "colleague@example.com",
    }),
  },
  {
    name: "bare keyword: positions on the org chart",
    fixtureClass: "bare_keyword",
    email: parsed({
      gmailMessageId: "m-18",
      subject: "Positions on the new org chart",
      sender: "colleague@example.com",
    }),
  },

  // --- genuinely ambiguous: worth exactly one model call each ------------
  {
    name: "ATS sender with candidate-facing language",
    fixtureClass: "ambiguous",
    email: parsed({
      gmailMessageId: "m-19",
      subject: "Regarding your application",
      sender: "no-reply@greenhouse.io",
      senderRootDomain: "greenhouse.io",
    }),
  },
  {
    name: "application URL with candidate-facing language",
    fixtureClass: "ambiguous",
    email: parsed({
      gmailMessageId: "m-20",
      subject: "Your candidacy details",
      sender: "people@acme.example",
      senderRootDomain: "acme.example",
      jobUrl: "https://boards.greenhouse.io/acme/jobs/1234",
    }),
  },
];

/** The keyword regex the gate deleted, quoted from the heuristics.ts header. */
const DELETED_WEAK_SIGNAL =
  /\b(application|applied|candidate|candidacy|position|role|hiring|recruit)/i;

/**
 * Would the two deleted rules have paid for a model call on this message?
 *
 * The pattern layer came first then as it does now, so a message a lifecycle
 * pattern resolves needs no model either way; everything else escalated if a
 * listed keyword appeared anywhere in its text or if the sender was an ATS
 * domain.
 */
function deletedRulesWouldEscalate(email: ParsedEmail): boolean {
  if (detectCategory(email) !== null) return false;

  const text = `${email.subject}\n${email.snippet}\n${email.bodyText}`;
  return (
    DELETED_WEAK_SIGNAL.test(text) ||
    isAtsDomain(email.senderRootDomain) ||
    email.jobUrl !== null
  );
}

test("BENCHMARK: the gate escalates only genuinely ambiguous mail", () => {
  const escalated = CORPUS.filter((fixture) => evaluateEmail(fixture.email).needsAI);

  assert.deepEqual(
    escalated.map((fixture) => fixture.name),
    [
      "ATS sender with candidate-facing language",
      "application URL with candidate-facing language",
    ],
    "exactly the two ambiguous fixtures may cost a model call"
  );

  // Every other class is decided for free.
  for (const fixture of CORPUS) {
    const verdict = evaluateEmail(fixture.email);

    if (fixture.fixtureClass === "ambiguous") continue;

    assert.equal(
      verdict.needsAI,
      false,
      `${fixture.name} must not reach the model`
    );

    if (fixture.fixtureClass === "strong_lifecycle") {
      assert.equal(verdict.candidate, true, `${fixture.name} is evidence`);
      assert.ok(verdict.category, `${fixture.name} resolves deterministically`);
    } else {
      assert.equal(verdict.candidate, false, `${fixture.name} is not evidence`);
      assert.equal(verdict.category, "NOT_JOB_RELATED");
    }
  }
});

test("BENCHMARK: AI escalations drop sharply versus the deleted rules", () => {
  const gateCalls = CORPUS.filter(
    (fixture) => evaluateEmail(fixture.email).needsAI
  ).length;
  const deletedRuleCalls = CORPUS.filter((fixture) =>
    deletedRulesWouldEscalate(fixture.email)
  ).length;

  assert.equal(gateCalls, 2, "the corpus contains two ambiguous messages");
  assert.ok(
    deletedRuleCalls >= 12,
    `the deleted rules escalated ${deletedRuleCalls} of ${CORPUS.length} fixtures`
  );

  // The reducible term: at least a 4x reduction on this corpus.
  assert.ok(
    gateCalls * 4 <= deletedRuleCalls,
    `AI escalations for ${CORPUS.length} messages: ${deletedRuleCalls} -> ${gateCalls}`
  );

  // Bare-ATS and bare-keyword mail is where the saving comes from, and every
  // one of those fixtures is a message the deleted rules paid for.
  for (const fixture of CORPUS) {
    if (fixture.fixtureClass !== "bare_ats" && fixture.fixtureClass !== "bare_keyword") {
      continue;
    }
    assert.equal(
      deletedRulesWouldEscalate(fixture.email),
      true,
      `${fixture.name} should be a fixture the old rules escalated`
    );
    assert.equal(
      evaluateEmail(fixture.email).needsAI,
      false,
      `${fixture.name} must no longer escalate`
    );
    assert.equal(evaluateEmail(fixture.email).reason, "no_job_signal");
  }
});

test("BENCHMARK: the pipeline sends the model exactly the gate's escalations", () => {
  const { records, ambiguous, candidates } = classifyParsedEmails(
    CORPUS.map((fixture) => fixture.email),
    "conn-1"
  );

  // The classification is a partition: nothing is silently dropped, and only
  // ambiguity is ever sent to the provider.
  assert.equal(records.length + ambiguous.length, CORPUS.length);
  assert.equal(ambiguous.length, 2);
  assert.deepEqual(
    ambiguous.map((email) => email.gmailMessageId),
    ["m-19", "m-20"]
  );

  // Candidates = strong lifecycle rows + ambiguous ones.
  assert.equal(candidates, 5 + 2);

  // Rejections are ledgered too, so a re-scan never re-examines them, and every
  // stored row carries its reason code without a word of email text. A rejection
  // is stored as NOT_JOB_RELATED, or as JOB_OPPORTUNITY when it is a job alert
  // (FIX 2) — both are non-candidate rows, and together they are every rejection.
  const rejected = records.filter(
    (row) =>
      row.category === "NOT_JOB_RELATED" || row.category === "JOB_OPPORTUNITY"
  );
  assert.equal(rejected.length, 13);
  for (const row of records) {
    assert.ok(row.evidenceReason, "every ledger row explains itself");
  }
  // Only the deterministic path may store "strong".
  assert.equal(
    records.filter((row) => row.evidenceStrength === "strong").length,
    5
  );
});

// ===========================================================================
// Re-assertions: incremental mode, ledger dedup, monotonicity, isolation
// ===========================================================================

const SYNC_ROUTE = join(
  process.cwd(),
  "src",
  "app",
  "api",
  "gmail",
  "sync",
  "route.ts"
);

/**
 * REPLACED ASSERTIONS — read this before restoring anything.
 *
 * Two tests used to live here. They mirrored the route's old mode rule
 *
 *     lastFullSyncAt !== null && historyId !== null && !widensCoverage
 *
 * and asserted that "a narrower or equal window stays incremental", including a
 * structural regex pinning that expression in the route source.
 *
 * Those assertions were not weakened to make anything pass — they were removed
 * because they encoded the zero-message regression as intended behaviour. Under
 * that rule a second 30-day scan satisfied all three conditions, ran
 * `history.list` instead of `messages.list`, never used the date window, and
 * reported `0 processed / 0 application-related / 0 created` on a mailbox holding
 * thousands of matching messages. The product contract is that an explicit
 * 7/30/60/90 scan traverses the COMPLETE window every time, so a test demanding
 * the opposite is a test of a defect.
 *
 * What replaces them is strictly stronger: the rule is no longer mirrored by hand
 * here (a mirror can drift), it is exercised directly through the exported
 * decision function in `scanMode.test.ts`, and the structural guard below pins
 * the *absence* of the downgrade as well as the presence of the fix.
 */
test("the sync route decides the mode from the request, not from sync history", () => {
  const source = readFileSync(SYNC_ROUTE, "utf8");

  // The fix: mode comes from the caller's declared intent.
  assert.match(
    source,
    /resolveScanMode\(\{\s*intent: scanIntent/,
    "the route must resolve its mode from the request intent"
  );

  // The regression, pinned as absent. `widensCoverage` was the term that let a
  // previously covered window silently become an anchored diff.
  assert.doesNotMatch(
    source,
    /widensCoverage/,
    "coverage of earlier scans must not decide whether the mailbox is traversed"
  );

  // Window coverage is now checked via getCompletedFullScanWindowStart, but
  // it only affects incremental-intent requests, never full_window intent.
  // The default full_window intent ALWAYS traverses, so the fix is preserved.
  assert.match(
    source,
    /getCompletedFullScanWindowStart/,
    "window coverage should be checked for incremental mode eligibility"
  );

  // A stale open job must be closed rather than allowed to redefine the window
  // the user selected.
  assert.match(
    source,
    /resolveJobReuse\(/,
    "the route must decide explicitly whether an open job may serve the request"
  );
  assert.match(
    source,
    /superseded_/,
    "a superseded job must be closed with a recorded reason"
  );

  // A superseded job must never be recorded as complete: that would fabricate
  // coverage it never read.
  assert.doesNotMatch(
    source,
    /status: "complete",\s*error: `superseded/,
    "a superseded job must not be marked complete"
  );
});

/** One ledger row, reduced to the two columns the dedup read looks at. */
interface LedgerRow {
  user_id: string;
  gmail_message_id: string;
}

interface LedgerFilter {
  column: keyof LedgerRow;
  value: string | readonly string[];
}

type LedgerResult = {
  data: { gmail_message_id: string }[];
  error: null;
};

/**
 * The smallest client `findProcessedMessageIds` can run against: it records the
 * filters it was handed, so per-user scoping is asserted rather than assumed.
 */
class LedgerQuery implements PromiseLike<LedgerResult> {
  rows: readonly LedgerRow[];
  filters: LedgerFilter[] = [];

  constructor(rows: readonly LedgerRow[]) {
    this.rows = rows;
  }

  select(_columns?: string): this {
    return this;
  }

  eq(column: keyof LedgerRow, value: string): this {
    this.filters.push({ column, value });
    return this;
  }

  in(column: keyof LedgerRow, values: readonly string[]): this {
    this.filters.push({ column, value: [...values] });
    return this;
  }

  matches(row: LedgerRow): boolean {
    return this.filters.every((filter) =>
      Array.isArray(filter.value)
        ? filter.value.includes(row[filter.column])
        : row[filter.column] === filter.value
    );
  }

  then<TResult1 = LedgerResult, TResult2 = never>(
    onfulfilled?: ((value: LedgerResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    const matched = this.rows
      .filter((row) => this.matches(row))
      .map((row) => ({ gmail_message_id: row.gmail_message_id }));

    return Promise.resolve<LedgerResult>({ data: matched, error: null }).then(
      onfulfilled,
      onrejected
    );
  }
}

function ledgerClient(rows: readonly LedgerRow[]): {
  client: Parameters<typeof findProcessedMessageIds>[0];
  queries: LedgerQuery[];
} {
  const queries: LedgerQuery[] = [];

  const from = (table: string): LedgerQuery => {
    assert.equal(table, "gmail_activity");
    const query = new LedgerQuery(rows);
    queries.push(query);
    return query;
  };

  return {
    client: { from } as unknown as Parameters<typeof findProcessedMessageIds>[0],
    queries,
  };
}

test("ledger dedup reduces a re-listed page to its unprocessed remainder", async () => {
  const { client, queries } = ledgerClient([
    { user_id: "user-1", gmail_message_id: "m-1" },
    { user_id: "user-1", gmail_message_id: "m-2" },
  ]);

  const processed = await findProcessedMessageIds(client, "user-1", [
    "m-1",
    "m-2",
    "m-3",
  ]);

  assert.deepEqual([...processed].sort(), ["m-1", "m-2"]);

  const remainder = ["m-1", "m-2", "m-3"].filter((id) => !processed.has(id));
  assert.deepEqual(remainder, ["m-3"], "only fresh ids may be fetched");

  // The dedup read happens before any metadata fetch, and it is owner-scoped.
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].filters[0], { column: "user_id", value: "user-1" });
});

test("an empty id list costs no query at all", async () => {
  const { client, queries } = ledgerClient([]);
  const processed = await findProcessedMessageIds(client, "user-1", []);

  assert.equal(processed.size, 0);
  assert.equal(queries.length, 0);
});

test("one user's ledger never suppresses another user's messages", async () => {
  // UNIQUE(user_id, gmail_message_id) is per user, so the same Gmail id can be
  // processed independently by two accounts.
  const rows: LedgerRow[] = [
    { user_id: "user-1", gmail_message_id: "shared" },
    { user_id: "user-1", gmail_message_id: "only-user-1" },
  ];

  const first = ledgerClient(rows);
  const second = ledgerClient(rows);

  const forUserOne = await findProcessedMessageIds(first.client, "user-1", [
    "shared",
    "only-user-1",
  ]);
  const forUserTwo = await findProcessedMessageIds(second.client, "user-2", [
    "shared",
    "only-user-1",
  ]);

  assert.deepEqual([...forUserOne].sort(), ["only-user-1", "shared"]);
  assert.deepEqual([...forUserTwo], [], "user-2 has processed nothing");

  for (const query of [...first.queries, ...second.queries]) {
    assert.ok(
      query.filters.some((filter) => filter.column === "user_id"),
      "every dedup read is scoped to the acting user"
    );
  }
});

test("status advances only on strictly newer dated evidence", () => {
  const applied = "2026-05-01T00:00:00.000Z";

  // Newer evidence may move the status in any direction.
  assert.equal(
    shouldUpdateStatus({
      currentStatus: "Applied",
      currentStatusAt: applied,
      nextStatus: "Interview",
      nextStatusAt: "2026-05-20T00:00:00.000Z",
    }),
    true
  );
  assert.equal(
    shouldUpdateStatus({
      currentStatus: "Interview",
      currentStatusAt: "2026-05-20T00:00:00.000Z",
      nextStatus: "Rejected",
      nextStatusAt: "2026-06-01T00:00:00.000Z",
    }),
    true
  );

  // Older or equal evidence may not.
  assert.equal(
    shouldUpdateStatus({
      currentStatus: "Interview",
      currentStatusAt: "2026-05-20T00:00:00.000Z",
      nextStatus: "Applied",
      nextStatusAt: applied,
    }),
    false
  );
  assert.equal(
    shouldUpdateStatus({
      currentStatus: "Interview",
      currentStatusAt: "2026-05-20T00:00:00.000Z",
      nextStatus: "Interview",
      nextStatusAt: "2026-06-01T00:00:00.000Z",
    }),
    false
  );

  // Undated evidence can never move a dated status.
  assert.equal(
    shouldUpdateStatus({
      currentStatus: "Applied",
      currentStatusAt: applied,
      nextStatus: "Offer",
      nextStatusAt: null,
    }),
    false
  );

  // A derived Ghosted is superseded by any real evidence.
  assert.equal(
    shouldUpdateStatus({
      currentStatus: "Ghosted",
      currentStatusAt: applied,
      nextStatus: "Interview",
      nextStatusAt: "2026-04-01T00:00:00.000Z",
    }),
    true
  );

  // Resolution over a whole application's evidence picks the latest stage, and
  // undated rows contribute nothing.
  assert.equal(
    resolveStatus([
      { category: "APPLICATION_CONFIRMATION", emailDate: applied },
      { category: "INTERVIEW_INVITATION", emailDate: "2026-05-20T00:00:00.000Z" },
      { category: "OFFER", emailDate: null },
    ]),
    "Interview"
  );
  assert.equal(resolveStatus([{ category: "OFFER", emailDate: null }]), null);
});

// ===========================================================================
// Listing accounting — three counts, one of which cannot be derived
// ===========================================================================
//
// `messagesSeen` is counted AFTER dedup, so "Gmail matched nothing" and "Gmail
// matched 2,272 messages we had already read" both collapse to 0 there. These
// tests pin the arithmetic that keeps the two apart.

test("a page that is entirely already-tracked reports the listing, not zero", () => {
  const summary = summarizeListing({
    listed: 5,
    alreadyProcessed: 5,
    batchLimit: BATCH_MESSAGE_LIMIT,
  });

  assert.equal(summary.deduplicated, 5, "all five were already in the ledger");
  assert.equal(summary.fresh, 0, "so none of them are processed again");
  // Nothing is left on this page, so the cursor may move on.
  assert.equal(summary.pageFullyProcessed, true);
});

test("a partly-tracked page processes only its fresh remainder", () => {
  const summary = summarizeListing({
    listed: 5,
    alreadyProcessed: 3,
    batchLimit: BATCH_MESSAGE_LIMIT,
  });

  assert.equal(summary.deduplicated, 3);
  assert.equal(summary.fresh, 2);
  assert.equal(summary.pageFullyProcessed, true);
});

test("an empty listing is distinguishable from a fully deduplicated one", () => {
  const nothingListed = summarizeListing({
    listed: 0,
    alreadyProcessed: 0,
    batchLimit: BATCH_MESSAGE_LIMIT,
  });
  const allTracked = summarizeListing({
    listed: 2_272,
    alreadyProcessed: 2_272,
    batchLimit: BATCH_MESSAGE_LIMIT,
  });

  // Both process nothing...
  assert.equal(nothingListed.fresh, 0);
  assert.equal(allTracked.fresh, 0);
  // ...and only the deduplicated count tells the two situations apart.
  assert.equal(nothingListed.deduplicated, 0);
  assert.equal(allTracked.deduplicated, 2_272);
});

test("more fresh messages than the batch cap holds the cursor back", () => {
  // The cursor hold-back invariant, stated in the accounting layer: a page whose
  // fresh remainder exceeds the per-batch cap is NOT fully processed, so
  // resolveNextCursor must keep the stored token.
  const listed = BATCH_MESSAGE_LIMIT * 2;
  const summary = summarizeListing({
    listed,
    alreadyProcessed: 0,
    batchLimit: BATCH_MESSAGE_LIMIT,
  });

  assert.equal(summary.fresh, BATCH_MESSAGE_LIMIT);
  assert.equal(summary.deduplicated, 0);
  assert.equal(
    summary.pageFullyProcessed,
    false,
    "the page still holds unprocessed fresh messages"
  );

  const cursor = resolveNextCursor({
    pageFullyProcessed: summary.pageFullyProcessed,
    nextPageToken: "page-2",
    storedPageToken: "page-1",
  });
  assert.deepEqual(cursor, { pageToken: "page-1", done: false });
});

test("the cap boundary is exactly reached without holding the cursor", () => {
  const summary = summarizeListing({
    listed: BATCH_MESSAGE_LIMIT,
    alreadyProcessed: 0,
    batchLimit: BATCH_MESSAGE_LIMIT,
  });

  assert.equal(summary.fresh, BATCH_MESSAGE_LIMIT);
  assert.equal(summary.pageFullyProcessed, true);
});

// ===========================================================================
// New-mail guarantee — dedup suppresses the old, never the new
// ===========================================================================

test("a genuinely new message survives dedup while ledgered ids do not", async () => {
  // A later scan re-lists the same page it read before, plus one message that
  // arrived since. Dedup must remove exactly the ids already in the ledger.
  const { client, queries } = ledgerClient([
    { user_id: "user-1", gmail_message_id: "old-1" },
    { user_id: "user-1", gmail_message_id: "old-2" },
    { user_id: "user-1", gmail_message_id: "old-3" },
  ]);

  const listedIds = ["old-1", "old-2", "old-3", "arrived-today"];
  const processed = await findProcessedMessageIds(client, "user-1", listedIds);

  assert.equal(processed.has("arrived-today"), false, "new mail is not suppressed");
  for (const id of ["old-1", "old-2", "old-3"]) {
    assert.equal(processed.has(id), true, `${id} must stay deduplicated`);
  }

  const remainder = listedIds.filter((id) => !processed.has(id));
  assert.deepEqual(remainder, ["arrived-today"]);

  // And the accounting agrees: the listing is fully reported, three ids are
  // deduplicated, and exactly the new one is processed.
  const summary = summarizeListing({
    listed: listedIds.length,
    alreadyProcessed: processed.size,
    batchLimit: BATCH_MESSAGE_LIMIT,
  });
  assert.equal(summary.deduplicated, 3);
  assert.equal(summary.fresh, 1);
  assert.equal(summary.pageFullyProcessed, true);

  // Still one owner-scoped read, still before any metadata fetch.
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].filters[0], { column: "user_id", value: "user-1" });
});

// ===========================================================================
// One scan, one query — the fixed-window regression
// ===========================================================================
//
// Every batch of a scan continues a Gmail page token minted against the query
// the first batch issued. Building the query from the clock meant a scan that
// crossed a day boundary changed its own `after:`/`before:` bounds mid-scan
// while still paging the previous query's cursor.

test("every batch of one scan builds the identical query", () => {
  const job = { windowStart: "2026-05-16", windowEnd: "2026-06-15" };
  const instant = resolveJobQueryInstant(job.windowEnd);
  assert.ok(instant, "a stored YYYY-MM-DD bound must resolve to an instant");

  // Batch 1 and batch 2 of the SAME job, built independently.
  const batchOne = buildGmailQuery({ range: "30d", now: instant });
  const batchTwo = buildGmailQuery({ range: "30d", now: instant });

  assert.equal(batchOne, batchTwo);
  // The query reproduces the job's own stored bounds rather than today's.
  assert.ok(batchOne.includes("after:2026/05/16"), batchOne);
  assert.ok(batchOne.includes("before:2026/06/16"), batchOne);
});

test("a later reference instant produces a different query", () => {
  const instant = resolveJobQueryInstant("2026-06-15");
  assert.ok(instant);

  // What the second batch used to build: whatever "now" happened to be.
  const nextDay = buildGmailQuery({
    range: "30d",
    now: new Date("2026-06-16T00:30:00.000Z"),
  });
  const pinned = buildGmailQuery({ range: "30d", now: instant });

  assert.notEqual(
    pinned,
    nextDay,
    "this difference is exactly what the cursor could not survive"
  );
  assert.ok(nextDay.includes("after:2026/05/17"), nextDay);
});

test("an unreadable window bound falls back instead of throwing", () => {
  // Falling back to the clock is the previous behaviour; a shifted window is a
  // much smaller problem than a scan that cannot run at all.
  assert.equal(resolveJobQueryInstant("not-a-date"), null);
  assert.equal(resolveJobQueryInstant(""), null);
  assert.equal(resolveJobQueryInstant("1970-01-01")?.toISOString(), "1970-01-01T00:00:00.000Z");
});

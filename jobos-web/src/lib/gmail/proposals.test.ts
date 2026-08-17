/**
 * Proposal grouping, derived Ghosted, and duplicate-prevention tests.
 *
 * Pure units — no network, no AI, no Supabase.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { buildProposals, type ActivityRowLike } from "./proposals.ts";
import { GHOSTED_THRESHOLD_DAYS } from "./statusInference.ts";
import { canonicalCompany, canonicalTitle, type ApplicationCandidate } from "./matching.ts";

const NOW = Date.parse("2026-06-15T12:00:00.000Z");

function daysAgo(days: number): string {
  return new Date(NOW - days * 86_400_000).toISOString();
}

let seq = 0;
function row(overrides: Partial<ActivityRowLike> = {}): ActivityRowLike {
  seq += 1;
  return {
    id: `act-${seq}`,
    gmail_message_id: `msg-${seq}`,
    gmail_thread_id: `thread-${seq}`,
    application_id: null,
    category: "APPLICATION_CONFIRMATION",
    company: "Stripe",
    job_title: "Backend Engineer",
    job_url: null,
    location: null,
    email_date: daysAgo(10),
    sender: "no-reply@greenhouse.io",
    sender_domain: "greenhouse.io",
    confidence: 0.9,
    ...overrides,
  };
}

// ===========================================================================
// Grouping
// ===========================================================================

test("all messages in one thread collapse into a single proposal", () => {
  const rows = [
    row({ gmail_thread_id: "t1", category: "APPLICATION_CONFIRMATION", email_date: daysAgo(30) }),
    row({ gmail_thread_id: "t1", category: "INTERVIEW_INVITATION", email_date: daysAgo(20) }),
    row({ gmail_thread_id: "t1", category: "REJECTION", email_date: daysAgo(5) }),
  ];

  const proposals = buildProposals(rows, [], new Map(), NOW);

  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].activityIds.length, 3);
  assert.equal(proposals[0].evidence.length, 3);
});

test("separate threads for the same company and title still collapse", () => {
  const rows = [
    row({ gmail_thread_id: null, company: "Stripe, Inc.", job_title: "Senior Backend Engineer" }),
    row({ gmail_thread_id: null, company: "Stripe", job_title: "Backend Engineer" }),
  ];

  const proposals = buildProposals(rows, [], new Map(), NOW);
  assert.equal(proposals.length, 1);
});

test("different companies produce separate proposals", () => {
  const rows = [
    row({ gmail_thread_id: "t1", company: "Stripe" }),
    row({ gmail_thread_id: "t2", company: "Acme" }),
  ];

  const proposals = buildProposals(rows, [], new Map(), NOW);
  assert.equal(proposals.length, 2);
});

test("NOT_JOB_RELATED activity never becomes a proposal", () => {
  const rows = [
    row({ gmail_thread_id: "t1", category: "NOT_JOB_RELATED" }),
    row({ gmail_thread_id: "t2", category: "NOT_JOB_RELATED" }),
  ];

  assert.deepEqual(buildProposals(rows, [], new Map(), NOW), []);
});

// ===========================================================================
// Status resolution within a proposal
// ===========================================================================

test("the proposal status reflects the newest evidence in the thread", () => {
  const rows = [
    row({ gmail_thread_id: "t1", category: "APPLICATION_CONFIRMATION", email_date: daysAgo(30) }),
    row({ gmail_thread_id: "t1", category: "INTERVIEW_INVITATION", email_date: daysAgo(3) }),
  ];

  const [proposal] = buildProposals(rows, [], new Map(), NOW);
  assert.equal(proposal.status, "Interview");
  assert.equal(proposal.statusFromEvidence, true);
});

test("out-of-order evidence cannot downgrade the proposal status", () => {
  const rows = [
    row({ gmail_thread_id: "t1", category: "OFFER", email_date: daysAgo(2) }),
    row({ gmail_thread_id: "t1", category: "APPLICATION_CONFIRMATION", email_date: daysAgo(40) }),
  ];

  const [proposal] = buildProposals(rows, [], new Map(), NOW);
  assert.equal(proposal.status, "Offer");
});

test("activity-only evidence defaults to Applied", () => {
  const rows = [
    row({ gmail_thread_id: "t1", category: "FOLLOW_UP", email_date: daysAgo(3) }),
  ];

  const [proposal] = buildProposals(rows, [], new Map(), NOW);
  assert.equal(proposal.status, "Applied");
  assert.equal(proposal.statusFromEvidence, false);
});

test("applied date is the earliest evidence, last activity the latest", () => {
  const rows = [
    row({ gmail_thread_id: "t1", email_date: daysAgo(40) }),
    row({ gmail_thread_id: "t1", email_date: daysAgo(4) }),
  ];

  const [proposal] = buildProposals(rows, [], new Map(), NOW);
  assert.equal(proposal.appliedDate, daysAgo(40));
  assert.equal(proposal.lastActivityAt, daysAgo(4));
});

// ===========================================================================
// Derived Ghosted
// ===========================================================================

test("a long-silent Applied proposal is derived as Ghosted", () => {
  const rows = [
    row({
      gmail_thread_id: "t1",
      category: "APPLICATION_CONFIRMATION",
      email_date: daysAgo(GHOSTED_THRESHOLD_DAYS + 10),
    }),
  ];

  const [proposal] = buildProposals(rows, [], new Map(), NOW);
  assert.equal(proposal.status, "Ghosted");
});

test("recent activity keeps a proposal out of Ghosted", () => {
  const rows = [
    row({
      gmail_thread_id: "t1",
      category: "APPLICATION_CONFIRMATION",
      email_date: daysAgo(GHOSTED_THRESHOLD_DAYS - 5),
    }),
  ];

  const [proposal] = buildProposals(rows, [], new Map(), NOW);
  assert.equal(proposal.status, "Applied");
});

test("interview evidence prevents Ghosted no matter how old", () => {
  const rows = [
    row({ gmail_thread_id: "t1", category: "APPLICATION_CONFIRMATION", email_date: daysAgo(400) }),
    row({ gmail_thread_id: "t1", category: "INTERVIEW_INVITATION", email_date: daysAgo(395) }),
  ];

  const [proposal] = buildProposals(rows, [], new Map(), NOW);
  assert.equal(proposal.status, "Interview");
});

test("a rejection is never rewritten as Ghosted", () => {
  const rows = [
    row({ gmail_thread_id: "t1", category: "REJECTION", email_date: daysAgo(400) }),
  ];

  const [proposal] = buildProposals(rows, [], new Map(), NOW);
  assert.equal(proposal.status, "Rejected");
});

test("Ghosted recalculates away once newer evidence arrives", () => {
  const stale = [
    row({
      gmail_thread_id: "t1",
      category: "APPLICATION_CONFIRMATION",
      email_date: daysAgo(GHOSTED_THRESHOLD_DAYS + 20),
    }),
  ];
  assert.equal(buildProposals(stale, [], new Map(), NOW)[0].status, "Ghosted");

  // A late reply lands. Because status is derived on every read, the Ghosted
  // state disappears with no migration or cleanup job.
  const revived = [
    ...stale,
    row({ gmail_thread_id: "t1", category: "INTERVIEW_INVITATION", email_date: daysAgo(1) }),
  ];
  assert.equal(buildProposals(revived, [], new Map(), NOW)[0].status, "Interview");
});

// ===========================================================================
// Matching + duplicate prevention
// ===========================================================================

const EXISTING: ApplicationCandidate[] = [
  {
    id: "app-1",
    company: "Stripe",
    role: "Backend Engineer",
    appliedDate: daysAgo(12),
    jobUrl: null,
  },
];

test("an existing application is suggested and auto-linkable on company+title", () => {
  const rows = [row({ gmail_thread_id: "t1", email_date: daysAgo(10) })];

  const [proposal] = buildProposals(rows, EXISTING, new Map(), NOW);
  assert.equal(proposal.suggestedApplicationId, "app-1");
  assert.equal(proposal.matchTier, "company_title");
  assert.equal(proposal.autoLink, true);
});

test("a thread already linked wins over field matching", () => {
  const rows = [row({ gmail_thread_id: "t-linked", company: "Totally Other" })];
  const links = new Map([["t-linked", "app-1"]]);

  const [proposal] = buildProposals(rows, EXISTING, links, NOW);
  assert.equal(proposal.matchTier, "thread");
  assert.equal(proposal.suggestedApplicationId, "app-1");
});

test("a same-company different-role find is flagged for confirmation, not merged", () => {
  const rows = [
    row({ gmail_thread_id: "t1", company: "Stripe", job_title: "Machine Learning Engineer" }),
  ];

  const [proposal] = buildProposals(rows, EXISTING, new Map(), NOW);
  assert.equal(proposal.matchTier, "company_only");
  assert.equal(proposal.autoLink, false);
});

test("an unknown employer yields no suggestion, so nothing is merged blindly", () => {
  const rows = [row({ gmail_thread_id: "t1", company: "Brand New Startup" })];

  const [proposal] = buildProposals(rows, EXISTING, new Map(), NOW);
  assert.equal(proposal.suggestedApplicationId, null);
  assert.equal(proposal.matchTier, "none");
});

test("re-running over the same rows yields identical proposals (idempotent)", () => {
  const rows = [
    row({ gmail_thread_id: "t1", category: "APPLICATION_CONFIRMATION", email_date: daysAgo(9) }),
    row({ gmail_thread_id: "t1", category: "INTERVIEW_INVITATION", email_date: daysAgo(4) }),
  ];

  const first = buildProposals(rows, EXISTING, new Map(), NOW);
  const second = buildProposals(rows, EXISTING, new Map(), NOW);

  assert.equal(first.length, 1);
  assert.deepEqual(
    first.map((p) => [p.key, p.status, p.activityIds.length]),
    second.map((p) => [p.key, p.status, p.activityIds.length])
  );
});

test("the lowest contributing confidence is surfaced, not the highest", () => {
  const rows = [
    row({ gmail_thread_id: "t1", confidence: 0.95 }),
    row({ gmail_thread_id: "t1", confidence: 0.4 }),
  ];

  const [proposal] = buildProposals(rows, [], new Map(), NOW);
  assert.equal(proposal.confidence, 0.4);
});

test("proposals are ordered by most recent activity first", () => {
  const rows = [
    row({ gmail_thread_id: "old", company: "Old Co", email_date: daysAgo(100) }),
    row({ gmail_thread_id: "new", company: "New Co", email_date: daysAgo(1) }),
  ];

  const proposals = buildProposals(rows, [], new Map(), NOW);
  assert.equal(proposals[0].company, "New Co");
});

// ===========================================================================
// Property-based generators
//
// Values are drawn from small pools of REAL shapes — the same employer written
// three ways, the same title with and without a seniority prefix, a handful of
// thread ids, and dates that variously parse or do not. Random strings would
// satisfy these properties trivially; collisions are the entire point, because
// grouping bugs only appear when two rows should or should not meet.
// ===========================================================================

/** Same employer spelled several ways, plus unrelated ones and null. */
const COMPANY_POOL = [
  "Stripe",
  "Stripe, Inc.",
  "STRIPE",
  "Acme Corp",
  "ACME corporation",
  "Globex",
  null,
] as const;

/** Titles that canonicalize together (seniority prefixes are dropped). */
const TITLE_POOL = [
  "Backend Engineer",
  "Senior Backend Engineer",
  "Staff Backend Engineer",
  "Data Analyst",
  null,
] as const;

/** A tiny thread pool so shared-thread collisions actually happen. */
const THREAD_POOL = ["t-alpha", "t-beta", null] as const;

const CATEGORY_POOL = [
  "APPLICATION_CONFIRMATION",
  "APPLICATION_RECEIVED",
  "INTERVIEW_INVITATION",
  "INTERVIEW_UPDATE",
  "OFFER",
  "REJECTION",
  "FOLLOW_UP",
  "OTHER_JOB_RELATED",
  // Present deliberately: it must be excluded from every proposal.
  "NOT_JOB_RELATED",
] as const;

/** Dates that parse, plus ones that never will, plus absence. */
const DATE_POOL = [
  daysAgo(0),
  daysAgo(3),
  daysAgo(40),
  daysAgo(400),
  null,
  "",
  "not-a-date",
  "13/45/2020",
  "sometime last week",
] as const;

interface RowSeed {
  company: string | null;
  jobTitle: string | null;
  threadId: string | null;
  category: (typeof CATEGORY_POOL)[number];
  emailDate: string | null;
  senderDomain: string;
}

const rowSeedArb: fc.Arbitrary<RowSeed> = fc.record({
  company: fc.constantFrom(...COMPANY_POOL),
  jobTitle: fc.constantFrom(...TITLE_POOL),
  threadId: fc.constantFrom(...THREAD_POOL),
  category: fc.constantFrom(...CATEGORY_POOL),
  emailDate: fc.constantFrom(...DATE_POOL),
  senderDomain: fc.constantFrom("greenhouse.io", "linkedin.com", "stripe.com"),
});

/** Seeds become rows here so every id is unique and stable per run. */
function seedsToRows(seeds: readonly RowSeed[]): ActivityRowLike[] {
  return seeds.map((seed, index) => ({
    id: `p-act-${index}`,
    gmail_message_id: `p-msg-${index}`,
    gmail_thread_id: seed.threadId,
    application_id: null,
    category: seed.category,
    company: seed.company,
    job_title: seed.jobTitle,
    job_url: null,
    location: null,
    email_date: seed.emailDate,
    sender: `no-reply@${seed.senderDomain}`,
    sender_domain: seed.senderDomain,
    confidence: 0.9,
  }));
}

const rowsArb: fc.Arbitrary<ActivityRowLike[]> = fc
  .array(rowSeedArb, { minLength: 1, maxLength: 12 })
  .map(seedsToRows);

/** Deterministic seeded permutation, so a counterexample replays exactly. */
function permute<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let state = (seed >>> 0) || 0x9e3779b9;
  for (let i = out.length - 1; i > 0; i -= 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** activityId -> proposal key, i.e. the grouping itself. */
function groupingOf(rows: ActivityRowLike[]): Map<string, string> {
  const grouping = new Map<string, string>();
  for (const proposal of buildProposals(rows, [], new Map(), NOW)) {
    for (const activityId of proposal.activityIds) {
      grouping.set(activityId, proposal.key);
    }
  }
  return grouping;
}

/** Canonical, order-free fingerprint of a grouping. */
function groupFingerprint(rows: ActivityRowLike[]): string[] {
  return buildProposals(rows, [], new Map(), NOW)
    .map((proposal) => `${proposal.key}=>${[...proposal.activityIds].sort().join(",")}`)
    .sort();
}

// ===========================================================================
// Feature: gmail-application-precision, Property 13: Evidence for one role
// groups into one proposal, independent of input order
//
// Validates: Requirements 7.1, 7.2, 7.5
// ===========================================================================

test("Property 13: evidence for one role groups into one proposal, independent of input order", () => {
  fc.assert(
    fc.property(rowsArb, fc.integer({ min: 0, max: 2 ** 31 - 1 }), (rows, seed) => {
      const proposals = buildProposals(rows, [], new Map(), NOW);
      const grouping = groupingOf(rows);

      // 7.5 — NOT_JOB_RELATED never reaches a proposal.
      const excluded = new Set(
        rows.filter((row) => row.category === "NOT_JOB_RELATED").map((row) => row.id)
      );
      for (const proposal of proposals) {
        for (const activityId of proposal.activityIds) {
          assert.equal(
            excluded.has(activityId),
            false,
            "a NOT_JOB_RELATED row must never appear in a proposal"
          );
        }
      }

      // Every other row belongs to exactly one proposal.
      const placements = proposals.flatMap((proposal) => proposal.activityIds);
      assert.equal(
        placements.length,
        new Set(placements).size,
        "no row may appear in two proposals"
      );
      assert.deepEqual(
        [...new Set(placements)].sort(),
        rows
          .filter((row) => row.category !== "NOT_JOB_RELATED")
          .map((row) => row.id)
          .sort(),
        "every non-excluded row must be placed exactly once"
      );

      // 7.1 — a shared thread id forces a shared proposal.
      // 7.2 — so does a shared canonical employer + canonical title, for rows
      // with no thread id to group on first.
      for (const left of rows) {
        for (const right of rows) {
          if (left.id === right.id) continue;
          const leftKey = grouping.get(left.id);
          const rightKey = grouping.get(right.id);
          if (leftKey === undefined || rightKey === undefined) continue;

          if (left.gmail_thread_id && left.gmail_thread_id === right.gmail_thread_id) {
            assert.equal(leftKey, rightKey, "one thread must be one proposal");
            continue;
          }

          if (left.gmail_thread_id === null && right.gmail_thread_id === null) {
            const sameCompany =
              (canonicalCompany(left.company) ?? "unknown") ===
              (canonicalCompany(right.company) ?? "unknown");
            const sameTitle =
              (canonicalTitle(left.job_title) ?? "unknown") ===
              (canonicalTitle(right.job_title) ?? "unknown");
            if (sameCompany && sameTitle) {
              assert.equal(
                leftKey,
                rightKey,
                "one employer + one title must be one proposal"
              );
            }
          }
        }
      }

      // Order independence: a resumed scan delivers rows in whatever order the
      // ledger hands back, and that must not change the grouping.
      assert.deepEqual(
        groupFingerprint(permute(rows, seed)),
        groupFingerprint(rows),
        "shuffling the input must not change the grouping"
      );
    }),
    { numRuns: 100 }
  );
});

test("several lifecycle emails for one role group into one proposal", () => {
  // Requirement 15.8, as a concrete example: a confirmation, an assessment
  // invitation, an interview update, and a rejection for the SAME role — some
  // relayed in-thread, some arriving as their own thread — are one application.
  const rows = [
    row({
      gmail_thread_id: "role-thread",
      category: "APPLICATION_CONFIRMATION",
      company: "Stripe",
      job_title: "Backend Engineer",
      email_date: daysAgo(30),
    }),
    row({
      gmail_thread_id: "role-thread",
      category: "INTERVIEW_INVITATION",
      company: "Stripe",
      job_title: "Backend Engineer",
      email_date: daysAgo(20),
    }),
    row({
      gmail_thread_id: "role-thread",
      category: "INTERVIEW_UPDATE",
      company: "Stripe",
      job_title: "Backend Engineer",
      email_date: daysAgo(12),
    }),
    row({
      gmail_thread_id: "role-thread",
      category: "REJECTION",
      company: "Stripe",
      job_title: "Backend Engineer",
      email_date: daysAgo(4),
    }),
  ];

  const proposals = buildProposals(rows, [], new Map(), NOW);
  assert.equal(proposals.length, 1, "four lifecycle emails, one application");
  assert.equal(proposals[0].activityIds.length, 4);
  assert.equal(proposals[0].evidence.length, 4);
  assert.equal(proposals[0].status, "Rejected");
  assert.equal(proposals[0].isLifecycleEvent, true);

  // The same four emails delivered as four separate threads still collapse,
  // because the canonical employer and title agree.
  const threadless = rows.map((original) => ({
    ...original,
    gmail_thread_id: null,
  }));
  const collapsed = buildProposals(threadless, [], new Map(), NOW);
  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0].activityIds.length, 4);
});

// ===========================================================================
// Feature: gmail-application-precision, Property 14: Proposal date bounds are
// the extremes of their evidence
//
// Validates: Requirements 7.3, 7.4
// ===========================================================================

test("Property 14: proposal date bounds are the extremes of their evidence", () => {
  fc.assert(
    fc.property(rowsArb, (rows) => {
      const byId = new Map(rows.map((entry) => [entry.id, entry]));

      for (const proposal of buildProposals(rows, [], new Map(), NOW)) {
        const times = proposal.activityIds
          .map((activityId) => byId.get(activityId)?.email_date ?? null)
          .map((date) => (date ? Date.parse(date) : Number.NaN))
          .filter((time) => Number.isFinite(time));

        if (times.length === 0) {
          // No usable date anywhere in the evidence: never invent one.
          assert.equal(proposal.appliedDate, null);
          assert.equal(proposal.lastActivityAt, null);
          continue;
        }

        // 7.3 / 7.4 — the bounds are exactly the extremes, nothing else.
        const { appliedDate, lastActivityAt } = proposal;
        assert.equal(
          appliedDate,
          new Date(Math.min(...times)).toISOString(),
          "applied date must be the earliest parseable evidence date"
        );
        assert.equal(
          lastActivityAt,
          new Date(Math.max(...times)).toISOString(),
          "last activity must be the latest parseable evidence date"
        );

        assert.ok(appliedDate !== null && lastActivityAt !== null);
        assert.ok(
          Date.parse(appliedDate) <= Date.parse(lastActivityAt),
          "applied date must never be later than last activity"
        );
      }
    }),
    { numRuns: 100 }
  );
});

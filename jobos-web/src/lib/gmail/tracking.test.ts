/**
 * Matching, status inference, Ghosted derivation, and classification-schema
 * validation tests.
 *
 * Pure units — no network, no AI, no Supabase.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import {
  MATCH_WINDOW_DAYS,
  canonicalCompany,
  canonicalTitle,
  matchApplication,
  proposalKey,
  sameJobUrl,
  type ApplicationCandidate,
} from "./matching.ts";
import {
  GHOSTED_THRESHOLD_DAYS,
  inferStatusFromCategory,
  isGhosted,
  isJobRelated,
  resolveStatus,
  shouldUpdateStatus,
} from "./statusInference.ts";
import { validateEmailClassification } from "../ai/schemas.ts";
import { evaluateApplicationEvidence } from "./applicationEvidence.ts";
import { EMAIL_CATEGORIES } from "./heuristics.ts";
import type { ParsedEmail } from "./parse.ts";

const NOW = Date.parse("2026-06-15T12:00:00.000Z");

function daysAgo(days: number): string {
  return new Date(NOW - days * 86_400_000).toISOString();
}

/** Minimal parsed message; each test overrides only what it asserts on. */
function parsed(overrides: Partial<ParsedEmail> = {}): ParsedEmail {
  return {
    gmailMessageId: "m1",
    gmailThreadId: "t1",
    subject: "",
    sender: "talent@acme.com",
    senderDomain: "acme.com",
    senderRootDomain: "acme.com",
    emailDate: daysAgo(1),
    snippet: "",
    rfcMessageId: null,
    hasUnsubscribe: false,
    labelIds: ["INBOX"],
    jobUrl: null,
    bodyText: "",
    ...overrides,
  };
}

const APPS: ApplicationCandidate[] = [
  {
    id: "app-stripe-be",
    company: "Stripe, Inc.",
    role: "Senior Backend Engineer",
    appliedDate: daysAgo(20),
    jobUrl: "https://jobs.lever.co/stripe/be-123",
  },
  {
    id: "app-stripe-fe",
    company: "Stripe",
    role: "Frontend Engineer",
    appliedDate: daysAgo(18),
    jobUrl: null,
  },
  {
    id: "app-acme",
    company: "Acme Corp",
    role: "Data Engineer",
    appliedDate: daysAgo(200),
    jobUrl: null,
  },
];

// ===========================================================================
// Canonicalization
// ===========================================================================

test("company canonicalization ignores legal suffixes and punctuation", () => {
  assert.equal(canonicalCompany("Stripe, Inc."), canonicalCompany("Stripe"));
  assert.equal(canonicalCompany("Acme Corp"), canonicalCompany("ACME corporation"));
  assert.equal(canonicalCompany("  Stripe   "), "stripe");
});

test("company canonicalization returns null for empty or noise-only input", () => {
  assert.equal(canonicalCompany(null), null);
  assert.equal(canonicalCompany(""), null);
  assert.equal(canonicalCompany("Inc."), null);
});

test("title canonicalization ignores seniority prefixes", () => {
  assert.equal(
    canonicalTitle("Senior Backend Engineer"),
    canonicalTitle("Backend Engineer")
  );
  assert.equal(canonicalTitle("Staff Data Engineer"), canonicalTitle("Data Engineer"));
});

test("job url comparison ignores query strings and trailing slashes", () => {
  assert.equal(
    sameJobUrl("https://jobs.lever.co/acme/x/", "https://jobs.lever.co/acme/x?src=email"),
    true
  );
  assert.equal(
    sameJobUrl("https://jobs.lever.co/acme/x", "https://jobs.lever.co/acme/y"),
    false
  );
  assert.equal(sameJobUrl(null, "https://a/b"), false);
  assert.equal(sameJobUrl("not-a-url", "also-not"), false);
});

// ===========================================================================
// Matching tiers
// ===========================================================================

test("thread continuity wins over every other signal", () => {
  const outcome = matchApplication(
    { company: "Totally Different", jobTitle: "Other", jobUrl: null, emailDate: daysAgo(1), gmailThreadId: "t1" },
    APPS,
    "app-acme"
  );
  assert.equal(outcome.tier, "thread");
  assert.equal(outcome.applicationId, "app-acme");
  assert.equal(outcome.autoLink, true);
});

test("an exact job url auto-links", () => {
  const outcome = matchApplication(
    {
      company: null,
      jobTitle: null,
      jobUrl: "https://jobs.lever.co/stripe/be-123?utm=x",
      emailDate: daysAgo(2),
      gmailThreadId: "t2",
    },
    APPS
  );
  assert.equal(outcome.tier, "job_url");
  assert.equal(outcome.applicationId, "app-stripe-be");
  assert.equal(outcome.autoLink, true);
});

test("company plus title inside the window auto-links", () => {
  const outcome = matchApplication(
    {
      company: "Stripe Inc",
      jobTitle: "Backend Engineer",
      jobUrl: null,
      emailDate: daysAgo(19),
      gmailThreadId: "t3",
    },
    APPS
  );
  assert.equal(outcome.tier, "company_title");
  assert.equal(outcome.applicationId, "app-stripe-be");
  assert.equal(outcome.autoLink, true);
});

test("company plus title outside the window does not auto-link on title", () => {
  const outcome = matchApplication(
    {
      company: "Acme",
      jobTitle: "Data Engineer",
      // 200 days after the applied date — far outside MATCH_WINDOW_DAYS.
      jobUrl: null,
      emailDate: daysAgo(0),
      gmailThreadId: "t4",
    },
    APPS
  );
  assert.ok(MATCH_WINDOW_DAYS < 200);
  assert.equal(outcome.tier, "company_only");
  assert.equal(outcome.autoLink, false);
});

test("company-only matches require user confirmation", () => {
  const outcome = matchApplication(
    {
      company: "Stripe",
      jobTitle: "Machine Learning Engineer",
      jobUrl: null,
      emailDate: daysAgo(17),
      gmailThreadId: "t5",
    },
    APPS
  );
  assert.equal(outcome.tier, "company_only");
  assert.equal(outcome.autoLink, false);
  assert.ok(outcome.confidence < 0.9);
});

test("an unknown company proposes a new application rather than guessing", () => {
  const outcome = matchApplication(
    {
      company: "Brand New Startup",
      jobTitle: "Engineer",
      jobUrl: null,
      emailDate: daysAgo(1),
      gmailThreadId: "t6",
    },
    APPS
  );
  assert.equal(outcome.tier, "none");
  assert.equal(outcome.applicationId, null);
  assert.equal(outcome.autoLink, false);
});

test("missing company yields no match instead of a wrong one", () => {
  const outcome = matchApplication(
    { company: null, jobTitle: null, jobUrl: null, emailDate: daysAgo(1), gmailThreadId: "t7" },
    APPS
  );
  assert.equal(outcome.tier, "none");
});

test("proposal keys group a thread together and collapse company+title", () => {
  const a = proposalKey({ company: "Stripe", jobTitle: "BE", jobUrl: null, emailDate: null, gmailThreadId: "t1" });
  const b = proposalKey({ company: "Other", jobTitle: "X", jobUrl: null, emailDate: null, gmailThreadId: "t1" });
  assert.equal(a, b, "same thread must produce one proposal");

  const c = proposalKey({ company: "Stripe, Inc.", jobTitle: "Senior Backend Engineer", jobUrl: null, emailDate: null, gmailThreadId: null });
  const d = proposalKey({ company: "Stripe", jobTitle: "Backend Engineer", jobUrl: null, emailDate: null, gmailThreadId: null });
  assert.equal(c, d, "same company+title must produce one proposal");
});

// ===========================================================================
// Category → status mapping
// ===========================================================================

test("every status-bearing category maps to an existing application status", () => {
  assert.equal(inferStatusFromCategory("APPLICATION_CONFIRMATION"), "Applied");
  assert.equal(inferStatusFromCategory("APPLICATION_RECEIVED"), "Applied");
  assert.equal(inferStatusFromCategory("INTERVIEW_INVITATION"), "Interview");
  assert.equal(inferStatusFromCategory("INTERVIEW_UPDATE"), "Interview");
  assert.equal(inferStatusFromCategory("OFFER"), "Offer");
  assert.equal(inferStatusFromCategory("REJECTION"), "Rejected");
});

test("activity-only categories never change status", () => {
  assert.equal(inferStatusFromCategory("APPLICATION_UPDATE"), null);
  assert.equal(inferStatusFromCategory("RECRUITER_CONTACT"), null);
  assert.equal(inferStatusFromCategory("FOLLOW_UP"), null);
  assert.equal(inferStatusFromCategory("OTHER_JOB_RELATED"), null);
  assert.equal(inferStatusFromCategory("NOT_JOB_RELATED"), null);
  // WITHDRAWAL is activity-only for V1 — there is no Withdrawn status.
  assert.equal(inferStatusFromCategory("WITHDRAWAL"), null);
});

test("no category can ever produce Ghosted", () => {
  const categories = [
    "APPLICATION_CONFIRMATION", "APPLICATION_RECEIVED", "APPLICATION_UPDATE",
    "INTERVIEW_INVITATION", "INTERVIEW_UPDATE", "RECRUITER_CONTACT",
    "REJECTION", "OFFER", "WITHDRAWAL", "FOLLOW_UP",
    "OTHER_JOB_RELATED", "NOT_JOB_RELATED",
  ] as const;

  for (const category of categories) {
    assert.notEqual(inferStatusFromCategory(category), "Ghosted");
  }
});

test("only NOT_JOB_RELATED is excluded from the activity timeline", () => {
  assert.equal(isJobRelated("FOLLOW_UP"), true);
  assert.equal(isJobRelated("NOT_JOB_RELATED"), false);
});

// ===========================================================================
// Assessment invitations (Requirement 6.6)
//
// An online assessment, coding challenge, or take-home tied to an application
// must end up as `Interview`. There is no ASSESSMENT category and no Assessment
// status: both CHECK constraints are frozen. The route is therefore
// gate -> INTERVIEW_INVITATION -> Interview, asserted end to end here so the
// mapping cannot be "simplified" away.
// ===========================================================================

const ASSESSMENT_SUBJECTS = [
  "Online assessment for Backend Engineer",
  "Coding challenge for your application",
  "Take-home assignment for the Data Engineer role",
  "Assessment invitation - Frontend Engineer",
  "Please complete your online assessment",
  "Technical assessment: next step in your application",
] as const;

test("an assessment invitation is classified as INTERVIEW_INVITATION", () => {
  for (const subject of ASSESSMENT_SUBJECTS) {
    const verdict = evaluateApplicationEvidence(parsed({ subject }));
    assert.equal(verdict.strength, "strong", subject);
    assert.equal(verdict.category, "INTERVIEW_INVITATION", subject);
    assert.equal(verdict.isLifecycleEvent, true, subject);
  }
});

test("an assessment invitation resolves the status Interview", () => {
  for (const subject of ASSESSMENT_SUBJECTS) {
    const verdict = evaluateApplicationEvidence(parsed({ subject }));
    assert.notEqual(verdict.category, null, subject);
    if (verdict.category === null) continue;

    // Single-email mapping and full-evidence resolution must agree.
    assert.equal(inferStatusFromCategory(verdict.category), "Interview", subject);
    assert.equal(
      resolveStatus([{ category: verdict.category, emailDate: daysAgo(2) }]),
      "Interview",
      subject
    );
  }
});

test("an assessment invitation advances a stored Applied application", () => {
  const verdict = evaluateApplicationEvidence(
    parsed({ subject: "Online assessment for Backend Engineer" })
  );
  assert.equal(verdict.category, "INTERVIEW_INVITATION");
  if (verdict.category === null) return;

  const resolved = resolveStatus([
    { category: "APPLICATION_CONFIRMATION", emailDate: daysAgo(20) },
    { category: verdict.category, emailDate: daysAgo(2) },
  ]);
  assert.equal(resolved, "Interview");
  if (resolved === null) return;

  // Monotonicity is unchanged: newer dated evidence advances, older does not.
  assert.equal(
    shouldUpdateStatus({
      currentStatus: "Applied",
      currentStatusAt: daysAgo(20),
      nextStatus: resolved,
      nextStatusAt: daysAgo(2),
    }),
    true
  );
  assert.equal(
    shouldUpdateStatus({
      currentStatus: "Offer",
      currentStatusAt: daysAgo(1),
      nextStatus: resolved,
      nextStatusAt: daysAgo(2),
    }),
    false,
    "an assessment cannot pull a newer Offer backwards"
  );
});

test("an assessment invitation produces no status outside the frozen five", () => {
  const allowed = ["Applied", "Interview", "Offer", "Rejected", "Ghosted"];

  for (const subject of ASSESSMENT_SUBJECTS) {
    const verdict = evaluateApplicationEvidence(parsed({ subject }));
    if (verdict.category === null) continue;
    const status = inferStatusFromCategory(verdict.category);
    assert.notEqual(status, null, subject);
    assert.ok(status !== null && allowed.includes(status), subject);
  }
});

// ===========================================================================
// Status resolution + monotonicity
// ===========================================================================

test("the most recent status-bearing email wins", () => {
  const status = resolveStatus([
    { category: "APPLICATION_CONFIRMATION", emailDate: daysAgo(30) },
    { category: "INTERVIEW_INVITATION", emailDate: daysAgo(10) },
  ]);
  assert.equal(status, "Interview");
});

test("processing an older email later cannot downgrade the status", () => {
  // Deliberately out of chronological order, as a resumed scan might deliver.
  const status = resolveStatus([
    { category: "OFFER", emailDate: daysAgo(5) },
    { category: "APPLICATION_CONFIRMATION", emailDate: daysAgo(40) },
  ]);
  assert.equal(status, "Offer");
});

test("a rejection after an interview is respected", () => {
  const status = resolveStatus([
    { category: "INTERVIEW_INVITATION", emailDate: daysAgo(20) },
    { category: "REJECTION", emailDate: daysAgo(2) },
  ]);
  assert.equal(status, "Rejected");
});

test("same-timestamp conflicts resolve to the further-along status", () => {
  const sameMoment = daysAgo(3);
  const status = resolveStatus([
    { category: "APPLICATION_CONFIRMATION", emailDate: sameMoment },
    { category: "REJECTION", emailDate: sameMoment },
  ]);
  assert.equal(status, "Rejected");
});

test("activity-only and undated evidence resolve to no status", () => {
  assert.equal(resolveStatus([{ category: "FOLLOW_UP", emailDate: daysAgo(1) }]), null);
  assert.equal(resolveStatus([{ category: "OFFER", emailDate: null }]), null);
  assert.equal(resolveStatus([]), null);
});

test("a newer status replaces an older one, an older one does not", () => {
  assert.equal(
    shouldUpdateStatus({
      currentStatus: "Applied",
      currentStatusAt: daysAgo(30),
      nextStatus: "Interview",
      nextStatusAt: daysAgo(5),
    }),
    true
  );

  assert.equal(
    shouldUpdateStatus({
      currentStatus: "Offer",
      currentStatusAt: daysAgo(5),
      nextStatus: "Applied",
      nextStatusAt: daysAgo(40),
    }),
    false
  );
});

test("an identical status is not rewritten", () => {
  assert.equal(
    shouldUpdateStatus({
      currentStatus: "Interview",
      currentStatusAt: daysAgo(5),
      nextStatus: "Interview",
      nextStatusAt: daysAgo(1),
    }),
    false
  );
});

test("real evidence always supersedes a derived Ghosted", () => {
  assert.equal(
    shouldUpdateStatus({
      currentStatus: "Ghosted",
      currentStatusAt: daysAgo(1),
      nextStatus: "Interview",
      nextStatusAt: daysAgo(60),
    }),
    true
  );
});

test("undated evidence cannot override a dated status", () => {
  assert.equal(
    shouldUpdateStatus({
      currentStatus: "Applied",
      currentStatusAt: daysAgo(10),
      nextStatus: "Offer",
      nextStatusAt: null,
    }),
    false
  );
});

// ===========================================================================
// Ghosted derivation
// ===========================================================================

test("silence past the threshold on an Applied application is ghosted", () => {
  assert.equal(
    isGhosted(
      { status: "Applied", lastActivityAt: daysAgo(GHOSTED_THRESHOLD_DAYS + 1), hasOutcomeEvidence: false },
      NOW
    ),
    true
  );
});

test("just inside the threshold is not yet ghosted", () => {
  assert.equal(
    isGhosted(
      { status: "Applied", lastActivityAt: daysAgo(GHOSTED_THRESHOLD_DAYS - 1), hasOutcomeEvidence: false },
      NOW
    ),
    false
  );
});

test("the threshold boundary itself counts as ghosted", () => {
  assert.equal(
    isGhosted(
      { status: "Applied", lastActivityAt: daysAgo(GHOSTED_THRESHOLD_DAYS), hasOutcomeEvidence: false },
      NOW
    ),
    true
  );
});

test("outcome evidence prevents ghosting regardless of silence", () => {
  assert.equal(
    isGhosted(
      { status: "Applied", lastActivityAt: daysAgo(365), hasOutcomeEvidence: true },
      NOW
    ),
    false
  );
});

test("only Applied applications can be ghosted", () => {
  for (const status of ["Interview", "Offer", "Rejected", "Ghosted"] as const) {
    assert.equal(
      isGhosted({ status, lastActivityAt: daysAgo(365), hasOutcomeEvidence: false }, NOW),
      false,
      `${status} must not be ghosted`
    );
  }
});

test("unknown last activity does not ghost an application", () => {
  assert.equal(
    isGhosted({ status: "Applied", lastActivityAt: null, hasOutcomeEvidence: false }, NOW),
    false
  );
});

// ===========================================================================
// Classification schema validation (untrusted model output)
// ===========================================================================

test("a well-formed classification batch validates", () => {
  const result = validateEmailClassification({
    results: [
      {
        id: "e1",
        category: "APPLICATION_CONFIRMATION",
        company: "Stripe",
        job_title: "Backend Engineer",
        location: "Remote",
        job_url: "https://jobs.lever.co/stripe/be-123",
        confidence: 0.9,
      },
    ],
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.results[0].company, "Stripe");
  assert.equal(result.value.results[0].jobTitle, "Backend Engineer");
});

test("an unknown category is rejected, not coerced", () => {
  const result = validateEmailClassification({
    results: [{ id: "e1", category: "TOTALLY_MADE_UP", confidence: 0.9 }],
  });
  assert.equal(result.ok, false);
});

test("Ghosted cannot be smuggled in as a category", () => {
  const result = validateEmailClassification({
    results: [{ id: "e1", category: "Ghosted", confidence: 1 }],
  });
  assert.equal(result.ok, false);
});

test("out-of-range or non-numeric confidence is rejected", () => {
  for (const confidence of [1.5, -0.1, "0.9", Number.NaN, null, undefined]) {
    const result = validateEmailClassification({
      results: [{ id: "e1", category: "OFFER", confidence }],
    });
    assert.equal(result.ok, false, `confidence ${String(confidence)} must be rejected`);
  }
});

test("injected extra fields are dropped, never persisted", () => {
  const result = validateEmailClassification({
    results: [
      {
        id: "e1",
        category: "OFFER",
        confidence: 0.8,
        // A hostile email trying to drive privileged behaviour.
        inferred_status: "Ghosted",
        application_id: "someone-elses-app",
        user_id: "attacker",
        match_score: 100,
      },
    ],
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  const entry = result.value.results[0] as unknown as Record<string, unknown>;
  assert.equal("inferred_status" in entry, false);
  assert.equal("application_id" in entry, false);
  assert.equal("user_id" in entry, false);
  assert.equal("match_score" in entry, false);
});

test("a non-http job url is discarded", () => {
  const result = validateEmailClassification({
    results: [
      { id: "e1", category: "OFFER", confidence: 0.8, job_url: "javascript:alert(1)" },
    ],
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.results[0].jobUrl, null);
});

test("a missing id is rejected so results cannot be misattributed", () => {
  const result = validateEmailClassification({
    results: [{ category: "OFFER", confidence: 0.8 }],
  });
  assert.equal(result.ok, false);
});

test("malformed batches are rejected", () => {
  assert.equal(validateEmailClassification(null).ok, false);
  assert.equal(validateEmailClassification({}).ok, false);
  assert.equal(validateEmailClassification({ results: [] }).ok, false);
  assert.equal(validateEmailClassification({ results: "nope" }).ok, false);
  assert.equal(validateEmailClassification([]).ok, false);
});

// ===========================================================================
// Feature: gmail-application-precision, Property 12: Only the five allowed
// statuses are ever produced
//
// Validates: Requirement 6.5
//
// The `applications.status` CHECK constraint is frozen at five values, so a
// status this layer invents is not a wrong label — it is a failed INSERT. The
// generator therefore sweeps the WHOLE category vocabulary (not the lifecycle
// subset) against dates that variously parse, are absent, or are garbage.
// ===========================================================================

/** The frozen vocabulary, spelled out rather than imported, so a change to the
 * source union cannot silently widen what this test permits. */
const ALLOWED_STATUSES = ["Applied", "Interview", "Offer", "Rejected", "Ghosted"] as const;

/** Dates a real ledger holds: usable, absent, and unparseable. */
const STATUS_DATE_POOL = [
  daysAgo(0),
  daysAgo(1),
  daysAgo(30),
  daysAgo(365),
  null,
  "",
  "not-a-date",
  "31/02/2024",
] as const;

const statusEvidenceArb = fc.record({
  category: fc.constantFrom(...EMAIL_CATEGORIES),
  emailDate: fc.constantFrom(...STATUS_DATE_POOL),
});

test("Property 12: only the five allowed statuses are ever produced", () => {
  fc.assert(
    fc.property(
      fc.array(statusEvidenceArb, { minLength: 0, maxLength: 8 }),
      fc.constantFrom(...EMAIL_CATEGORIES),
      (evidence, category) => {
        // Any single category: either no status at all, or one of the five.
        const single = inferStatusFromCategory(category);
        if (single !== null) {
          assert.ok(
            (ALLOWED_STATUSES as readonly string[]).includes(single),
            `${category} produced ${single}, which the CHECK constraint forbids`
          );
        }
        // Ghosted is derived from silence. No category may ever mint it.
        assert.notEqual(
          single,
          "Ghosted",
          `${category} must never produce the derived Ghosted status`
        );

        // Any evidence list: same guarantee, plus Ghosted stays unreachable.
        const resolved = resolveStatus(evidence);
        if (resolved !== null) {
          assert.ok(
            (ALLOWED_STATUSES as readonly string[]).includes(resolved),
            `resolveStatus produced ${resolved}, which the CHECK constraint forbids`
          );
          assert.notEqual(
            resolved,
            "Ghosted",
            "resolveStatus must never produce the derived Ghosted status"
          );
        }

        // A resolved status is always writable evidence, so whatever
        // shouldUpdateStatus lets through is inside the vocabulary too.
        if (resolved !== null) {
          const writable = shouldUpdateStatus({
            currentStatus: "Applied",
            currentStatusAt: daysAgo(400),
            nextStatus: resolved,
            nextStatusAt: daysAgo(1),
          });
          assert.equal(typeof writable, "boolean");
          assert.ok((ALLOWED_STATUSES as readonly string[]).includes(resolved));
        }
      }
    ),
    { numRuns: 100 }
  );
});

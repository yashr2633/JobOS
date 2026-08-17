/**
 * Evidence Gate tests.
 *
 * Properties 1–5 of the gmail-application-precision design, plus the concrete
 * examples Requirements 15.5 and 15.6 name and the awkward phrasings that
 * motivated each lifecycle pattern.
 *
 * Pure unit surface: the gate takes one `ParsedEmail` and returns one verdict,
 * so no network, AI, or Supabase fake is needed anywhere in this file.
 *
 * Generators compose real phrase fragments from each class rather than random
 * noise. Random strings would pass every property trivially — the point is to
 * cross-multiply genuine phrasings with senders, placements, labels, and
 * filler, which is where the ordering bugs live.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import {
  evaluateApplicationEvidence,
  isLifecycleCategory,
  LIFECYCLE_CATEGORIES,
  type EvidenceReason,
} from "./applicationEvidence.ts";
import { inferStatusFromCategory, type InferredStatus } from "./statusInference.ts";
import type { EmailCategory } from "./heuristics.ts";
import type { ParsedEmail } from "./parse.ts";

const FIXED_DATE = "2026-06-15T12:00:00.000Z";

/** Build a ParsedEmail fixture. Defaults carry no evidence of any kind. */
function email(overrides: Partial<ParsedEmail> = {}): ParsedEmail {
  return {
    gmailMessageId: "msg-1",
    gmailThreadId: "thread-1",
    subject: "",
    sender: "no-reply@example.com",
    senderDomain: "example.com",
    senderRootDomain: "example.com",
    emailDate: FIXED_DATE,
    snippet: "",
    rfcMessageId: null,
    hasUnsubscribe: false,
    labelIds: [],
    jobUrl: null,
    bodyText: "",
    ...overrides,
  };
}

// ===========================================================================
// Corpora
// ===========================================================================

/** The eight Lifecycle_Category values, as a closed union for the rank table. */
type LifecycleCategory =
  | "APPLICATION_CONFIRMATION"
  | "APPLICATION_RECEIVED"
  | "APPLICATION_UPDATE"
  | "INTERVIEW_INVITATION"
  | "INTERVIEW_UPDATE"
  | "REJECTION"
  | "OFFER"
  | "WITHDRAWAL";

/** Hiring-lifecycle rank: lower is further along. Offer > rejection > … */
const LIFECYCLE_RANK: Record<LifecycleCategory, number> = {
  OFFER: 0,
  REJECTION: 1,
  INTERVIEW_INVITATION: 2,
  INTERVIEW_UPDATE: 3,
  APPLICATION_CONFIRMATION: 4,
  APPLICATION_RECEIVED: 5,
  APPLICATION_UPDATE: 6,
  WITHDRAWAL: 7,
};

/** Status each Lifecycle_Category must resolve to, per the Status_Resolver. */
const EXPECTED_STATUS: Record<LifecycleCategory, InferredStatus | null> = {
  OFFER: "Offer",
  REJECTION: "Rejected",
  INTERVIEW_INVITATION: "Interview",
  INTERVIEW_UPDATE: "Interview",
  APPLICATION_CONFIRMATION: "Applied",
  APPLICATION_RECEIVED: "Applied",
  // Activity-only: an update or a withdrawal records a timeline entry but must
  // not move the application's status.
  APPLICATION_UPDATE: null,
  WITHDRAWAL: null,
};

interface ExclusionCase {
  reason: EvidenceReason;
  phrase: string;
}

/** Every hard-exclusion class, with real phrasings seen in the wild. */
const EXCLUSION_CORPUS: ReadonlyArray<{
  reason: EvidenceReason;
  phrases: readonly string[];
}> = [
  {
    reason: "excluded_job_alert",
    phrases: [
      "10 new jobs for you this week",
      "Job alert: Backend Engineer in Bengaluru",
      "Your weekly job digest",
      "Recommended jobs for you",
      "Jobs you may like at 12 companies",
      "Top job picks for you",
      "Similar jobs to the one you viewed",
      "5 new jobs matching your search",
      "Saved search results are ready",
    ],
  },
  {
    reason: "excluded_social_notification",
    phrases: [
      "Priya Sharma wants to connect",
      "You appeared in 9 searches this week",
      "Rahul viewed your profile",
      "People you may know at Acme",
      "Your application was viewed by 3 recruiters",
      "Anita commented on your post",
      "You have a new follower",
      "Sandeep endorsed your skills",
    ],
  },
  {
    reason: "excluded_financial_application",
    phrases: [
      "Your personal loan application has been received",
      "Your credit card statement is ready",
      "Pre-approved limit on your home loan",
      "EMI due for your car loan",
      "Complete your KYC to activate your savings account",
      "Update on your mortgage application",
      "Your insurance policy renewal is due",
      "Start investing in mutual funds today",
    ],
  },
  {
    reason: "excluded_marketing",
    phrases: [
      "Join our free webinar on system design",
      "Enroll now: Advanced React certification",
      "The 2026 salary report is here",
      "Our monthly newsletter",
      "Flash sale: 40% off everything",
      "Limited time pricing on our bootcamp",
      "Upgrade to Premium for more insights",
      "Take our 2-minute survey",
      "Free online courses in data science",
    ],
  },
  {
    reason: "excluded_hiring_announcement",
    phrases: [
      "Acme Corp is hiring for multiple teams",
      "Priya posted a job: Senior Engineer",
      "We're hiring across engineering",
      "Now hiring: Data Analyst",
      "Two founders are hiring this month",
    ],
  },
];

const EXCLUSION_CASES: readonly ExclusionCase[] = EXCLUSION_CORPUS.flatMap(
  ({ reason, phrases }) => phrases.map((phrase) => ({ reason, phrase }))
);

interface LifecycleCase {
  phrase: string;
  category: LifecycleCategory;
  /** True for the online-assessment phrasings that must still mean Interview. */
  assessment?: boolean;
}

/** The lifecycle corpus: phrase paired with the category it must produce. */
const LIFECYCLE_CASES: readonly LifecycleCase[] = [
  { phrase: "Your offer of employment at Acme Corp", category: "OFFER" },
  { phrase: "We are pleased to offer you the Backend Engineer position", category: "OFFER" },
  { phrase: "Your offer letter is attached", category: "OFFER" },
  { phrase: "We would like to formally offer you the role", category: "OFFER" },
  { phrase: "Job offer from Acme Corp", category: "OFFER" },

  { phrase: "Unfortunately we are unable to move forward with your application", category: "REJECTION" },
  { phrase: "We regret to inform you that we selected another applicant", category: "REJECTION" },
  { phrase: "Your application was unsuccessful", category: "REJECTION" },
  { phrase: "We have decided not to proceed with your candidacy", category: "REJECTION" },
  { phrase: "You have not been selected for this opening", category: "REJECTION" },
  { phrase: "The position has been filled", category: "REJECTION" },

  { phrase: "Invitation to interview for Backend Engineer", category: "INTERVIEW_INVITATION" },
  { phrase: "We would like to schedule a call with you", category: "INTERVIEW_INVITATION" },
  { phrase: "Interview request for the Data Engineer opening", category: "INTERVIEW_INVITATION" },
  { phrase: "Phone screen with the hiring team", category: "INTERVIEW_INVITATION" },
  { phrase: "Please complete your online assessment", category: "INTERVIEW_INVITATION", assessment: true },
  { phrase: "Your coding challenge is ready", category: "INTERVIEW_INVITATION", assessment: true },
  { phrase: "Take-home assignment for the Frontend opening", category: "INTERVIEW_INVITATION", assessment: true },
  { phrase: "Assessment invitation for Acme Corp", category: "INTERVIEW_INVITATION", assessment: true },
  { phrase: "Technical assessment for the platform team", category: "INTERVIEW_INVITATION", assessment: true },

  { phrase: "Your upcoming interview is on Friday", category: "INTERVIEW_UPDATE" },
  { phrase: "Interview rescheduled to Monday", category: "INTERVIEW_UPDATE" },
  { phrase: "Interview confirmation for Tuesday", category: "INTERVIEW_UPDATE" },
  { phrase: "Interview details for tomorrow", category: "INTERVIEW_UPDATE" },

  { phrase: "Thank you for applying to Acme Corp", category: "APPLICATION_CONFIRMATION" },
  { phrase: "Thanks for applying", category: "APPLICATION_CONFIRMATION" },
  { phrase: "Your application was sent to Acme Corp", category: "APPLICATION_CONFIRMATION" },
  { phrase: "Your application has been submitted", category: "APPLICATION_CONFIRMATION" },
  { phrase: "Application submitted successfully", category: "APPLICATION_CONFIRMATION" },
  { phrase: "You applied to Backend Engineer at Acme Corp", category: "APPLICATION_CONFIRMATION" },
  { phrase: "We have got your application", category: "APPLICATION_CONFIRMATION" },
  { phrase: "Thank you for your interest in Acme Corp", category: "APPLICATION_CONFIRMATION" },

  { phrase: "We have received your application", category: "APPLICATION_RECEIVED" },
  { phrase: "Application received", category: "APPLICATION_RECEIVED" },
  { phrase: "Your application has been received", category: "APPLICATION_RECEIVED" },
  { phrase: "We received your job application", category: "APPLICATION_RECEIVED" },

  { phrase: "Update on your application", category: "APPLICATION_UPDATE" },
  { phrase: "Your application status has changed", category: "APPLICATION_UPDATE" },
  { phrase: "Your application is under review", category: "APPLICATION_UPDATE" },
  { phrase: "We are still reviewing submissions", category: "APPLICATION_UPDATE" },
  { phrase: "Status of your candidacy", category: "APPLICATION_UPDATE" },

  { phrase: "Your application has been withdrawn", category: "WITHDRAWAL" },
  { phrase: "Withdrawing your application", category: "WITHDRAWAL" },
  { phrase: "You have withdrawn from the process", category: "WITHDRAWAL" },
];

/**
 * One phrase per category for the competing-evidence property.
 *
 * Deliberately excludes phrases containing `unfortunately`, `congratulations`,
 * `next steps`, or `application reference`: those words anchor patterns with a
 * wide `[\s\S]{0,120}` span, so concatenating them with an unrelated phrase can
 * bridge into a category neither phrase carries on its own. Bridging is a real
 * property of the gate, not a bug, but it is not what Property 5 is about.
 */
const COMPETING_CASES: readonly LifecycleCase[] = [
  { phrase: "We are pleased to offer you the Backend Engineer position", category: "OFFER" },
  { phrase: "We regret to inform you that your application was unsuccessful", category: "REJECTION" },
  { phrase: "Invitation to interview for the Backend Engineer opening", category: "INTERVIEW_INVITATION" },
  { phrase: "Your upcoming interview is on Friday", category: "INTERVIEW_UPDATE" },
  { phrase: "Thank you for applying to Acme Corp", category: "APPLICATION_CONFIRMATION" },
  { phrase: "We have received your application", category: "APPLICATION_RECEIVED" },
  { phrase: "Update on your application", category: "APPLICATION_UPDATE" },
  { phrase: "Your application has been withdrawn", category: "WITHDRAWAL" },
];

/**
 * Subjects whose only job-related signal is one of the eight bare words.
 * None contains candidate-facing possessive language.
 */
const KEYWORD_ONLY_SUBJECTS: readonly string[] = [
  "Regarding the position",
  "Notes on the role",
  "Candidate handbook attached",
  "The hiring process explained",
  "Recruit smarter with these tips",
  "How I applied last year",
  "Application deadlines vary by team",
  "Position closed for the season",
  "Candidacy rules for the committee",
];

/** ATS/portal-relayed subjects that address nobody as an applicant. */
const ATS_NO_CANDIDATE_LANGUAGE_SUBJECTS: readonly string[] = [
  "An update from Acme",
  "Regarding the Backend Engineer opening",
  "Notes from our team",
  "Weekly team sync",
  "Hello from Acme Corp",
];

const ATS_DOMAIN_SAMPLE = [
  "greenhouse.io",
  "lever.co",
  "linkedin.com",
  "naukri.com",
  "indeed.com",
  "workable.com",
] as const;

const SENDER_DOMAINS = [
  ...ATS_DOMAIN_SAMPLE,
  "acme.com",
  "stripe.com",
  "gmail.com",
  "hdfcbank.com",
] as const;

/** Labels that carry no meaning for the gate. */
const BENIGN_LABELS = ["INBOX", "UNREAD", "IMPORTANT", "CATEGORY_PERSONAL"] as const;

const GMAIL_EXCLUDED_LABELS = ["CATEGORY_PROMOTIONS", "SPAM", "TRASH"] as const;

/** Neutral surrounding text. Nothing here matches any pattern in the gate. */
const FILLER = ["", "Hello,", "Regards, the team", "Sent from my phone"] as const;

const senderDomain = () => fc.constantFrom(...SENDER_DOMAINS);
const benignLabels = () => fc.subarray([...BENIGN_LABELS]);
const filler = () => fc.constantFrom(...FILLER);

// ===========================================================================
// Property 1
// ===========================================================================

// Feature: gmail-application-precision, Property 1: Every hard-exclusion class
// yields the rejection verdict
test("Property 1: every hard-exclusion class yields the rejection verdict", () => {
  fc.assert(
    fc.property(
      fc.constantFrom(...EXCLUSION_CASES),
      senderDomain(),
      fc.boolean(),
      filler(),
      benignLabels(),
      fc.boolean(),
      (exclusion, domain, inSubject, text, labels, hasUnsubscribe) => {
        const verdict = evaluateApplicationEvidence(
          email({
            subject: inSubject ? `${exclusion.phrase} ${text}`.trim() : text || "Hello",
            snippet: inSubject ? text : `${text} ${exclusion.phrase}`.trim(),
            senderDomain: domain,
            senderRootDomain: domain,
            labelIds: labels,
            hasUnsubscribe,
          })
        );

        // Sender domain is irrelevant: an alert from greenhouse.io is still an
        // alert, and a real confirmation from linkedin.com is still real.
        assert.equal(verdict.strength, "none");
        assert.equal(verdict.category, "NOT_JOB_RELATED");
        assert.equal(verdict.isLifecycleEvent, false);
        assert.equal(verdict.reason, exclusion.reason);
      }
    ),
    { numRuns: 100 }
  );

  // Requirement 1.8: Gmail's own filing is an exclusion class of its own, and
  // it is checked first, so it names the reason even over a lifecycle phrase.
  fc.assert(
    fc.property(
      fc.constantFrom(...GMAIL_EXCLUDED_LABELS),
      fc.constantFrom(...LIFECYCLE_CASES),
      senderDomain(),
      benignLabels(),
      (excludedLabel, lifecycle, domain, labels) => {
        const verdict = evaluateApplicationEvidence(
          email({
            subject: lifecycle.phrase,
            senderDomain: domain,
            senderRootDomain: domain,
            labelIds: [...labels, excludedLabel],
          })
        );

        assert.equal(verdict.strength, "none");
        assert.equal(verdict.category, "NOT_JOB_RELATED");
        assert.equal(verdict.isLifecycleEvent, false);
        assert.equal(verdict.reason, "excluded_gmail_label");
      }
    ),
    { numRuns: 100 }
  );
});

// ===========================================================================
// Property 2
// ===========================================================================

// Feature: gmail-application-precision, Property 2: Exclusions are evaluated
// before lifecycle patterns
test("Property 2: exclusions are evaluated before lifecycle patterns", () => {
  fc.assert(
    fc.property(
      fc.constantFrom(...EXCLUSION_CASES),
      fc.constantFrom(...LIFECYCLE_CASES),
      fc.constantFrom(0, 1, 2, 3),
      senderDomain(),
      benignLabels(),
      (exclusion, lifecycle, placement, domain, labels) => {
        // Four placements: both in the subject in either concatenation order,
        // the exclusion in the snippet, and the lifecycle phrase in the body.
        const fields =
          placement === 0
            ? { subject: `${exclusion.phrase}. ${lifecycle.phrase}`, snippet: "", bodyText: "" }
            : placement === 1
              ? { subject: `${lifecycle.phrase}. ${exclusion.phrase}`, snippet: "", bodyText: "" }
              : placement === 2
                ? { subject: lifecycle.phrase, snippet: exclusion.phrase, bodyText: "" }
                : { subject: exclusion.phrase, snippet: "", bodyText: lifecycle.phrase };

        const verdict = evaluateApplicationEvidence(
          email({ ...fields, senderDomain: domain, senderRootDomain: domain, labelIds: labels })
        );

        // The exclusion class that wins may not be the generated one — a
        // lifecycle phrase can itself trip an earlier class — so the assertion
        // is that *some* exclusion won, never a lifecycle verdict.
        assert.equal(verdict.strength, "none");
        assert.equal(verdict.category, "NOT_JOB_RELATED");
        assert.equal(verdict.isLifecycleEvent, false);
        assert.ok(
          verdict.reason.startsWith("excluded_"),
          `expected an exclusion reason, got ${verdict.reason}`
        );
      }
    ),
    { numRuns: 100 }
  );
});

// ===========================================================================
// Property 3
// ===========================================================================

// Feature: gmail-application-precision, Property 3: An insufficient signal
// never escalates
test("Property 3: an insufficient signal never escalates", () => {
  // Requirement 1.9: one of the eight bare words is not evidence, whoever sent
  // it. This is the exact rule that used to escalate ~85% of the mailbox.
  fc.assert(
    fc.property(
      fc.constantFrom(...KEYWORD_ONLY_SUBJECTS),
      senderDomain(),
      filler(),
      benignLabels(),
      fc.boolean(),
      (subject, domain, text, labels, hasUnsubscribe) => {
        const verdict = evaluateApplicationEvidence(
          email({
            subject,
            snippet: text,
            senderDomain: domain,
            senderRootDomain: domain,
            labelIds: labels,
            hasUnsubscribe,
            jobUrl: null,
          })
        );

        assert.equal(verdict.strength, "none");
        assert.equal(verdict.category, "NOT_JOB_RELATED");
        assert.equal(verdict.isLifecycleEvent, false);
        assert.equal(verdict.reason, "keyword_only");
      }
    ),
    { numRuns: 100 }
  );

  // Requirement 3.2: an ATS/portal sender is a routing fact, not evidence. With
  // no candidate-facing language it buys no model call at all.
  fc.assert(
    fc.property(
      fc.constantFrom(...ATS_NO_CANDIDATE_LANGUAGE_SUBJECTS),
      fc.constantFrom(...ATS_DOMAIN_SAMPLE),
      filler(),
      benignLabels(),
      (subject, domain, text, labels) => {
        const verdict = evaluateApplicationEvidence(
          email({
            subject,
            snippet: text,
            senderDomain: domain,
            senderRootDomain: domain,
            labelIds: labels,
            jobUrl: null,
          })
        );

        assert.equal(verdict.strength, "none");
        assert.equal(verdict.category, "NOT_JOB_RELATED");
        assert.equal(verdict.isLifecycleEvent, false);
      }
    ),
    { numRuns: 100 }
  );
});

// ===========================================================================
// Property 4
// ===========================================================================

// Feature: gmail-application-precision, Property 4: Lifecycle evidence
// classifies deterministically and maps to a status
test("Property 4: lifecycle evidence classifies deterministically and maps to a status", () => {
  fc.assert(
    fc.property(
      fc.constantFrom(...LIFECYCLE_CASES),
      senderDomain(),
      filler(),
      benignLabels(),
      (lifecycle, domain, text, labels) => {
        const base = {
          senderDomain: domain,
          senderRootDomain: domain,
          labelIds: labels,
        };

        const subjectVerdict = evaluateApplicationEvidence(
          email({ ...base, subject: `${lifecycle.phrase} ${text}`.trim() })
        );
        const bodyVerdict = evaluateApplicationEvidence(
          email({ ...base, subject: "Acme Corp", bodyText: `${text} ${lifecycle.phrase}`.trim() })
        );

        for (const verdict of [subjectVerdict, bodyVerdict]) {
          assert.equal(verdict.strength, "strong");
          assert.equal(verdict.category, lifecycle.category);
          assert.equal(verdict.isLifecycleEvent, true);
          assert.ok(isLifecycleCategory(verdict.category));
          assert.ok(LIFECYCLE_CATEGORIES.has(lifecycle.category));

          const status =
            verdict.category === null ? null : inferStatusFromCategory(verdict.category);
          assert.equal(status, EXPECTED_STATUS[lifecycle.category]);

          // Requirement 6.6: an online assessment is the assessment stage of an
          // application, so it must resolve to Interview and never to Applied.
          if (lifecycle.assessment === true) {
            assert.equal(status, "Interview");
          }
        }

        // Requirement 2.7: a subject hit is materially stronger evidence.
        assert.ok(subjectVerdict.confidence >= 0.9);
        assert.equal(subjectVerdict.reason, "lifecycle_subject_match");
        assert.ok(bodyVerdict.confidence < subjectVerdict.confidence);
        assert.ok(bodyVerdict.confidence < 0.9);
        assert.equal(bodyVerdict.reason, "lifecycle_body_match");
      }
    ),
    { numRuns: 100 }
  );
});

// ===========================================================================
// Property 5
// ===========================================================================

// Feature: gmail-application-precision, Property 5: Competing lifecycle
// evidence resolves to the furthest-along stage
test("Property 5: competing lifecycle evidence resolves to the furthest-along stage", () => {
  fc.assert(
    fc.property(
      fc.constantFrom(...COMPETING_CASES),
      fc.constantFrom(...COMPETING_CASES),
      fc.constantFrom(0, 1, 2, 3),
      senderDomain(),
      (first, second, placement, domain) => {
        const expected =
          LIFECYCLE_RANK[first.category] <= LIFECYCLE_RANK[second.category]
            ? first.category
            : second.category;

        // Both concatenation orders, and both split across subject/body, so the
        // result is pinned to lifecycle rank rather than to field placement.
        const fields =
          placement === 0
            ? { subject: `${first.phrase}. ${second.phrase}`, bodyText: "" }
            : placement === 1
              ? { subject: `${second.phrase}. ${first.phrase}`, bodyText: "" }
              : placement === 2
                ? { subject: first.phrase, bodyText: second.phrase }
                : { subject: second.phrase, bodyText: first.phrase };

        const verdict = evaluateApplicationEvidence(
          email({ ...fields, senderDomain: domain, senderRootDomain: domain })
        );

        assert.equal(verdict.strength, "strong");
        assert.equal(verdict.isLifecycleEvent, true);
        assert.equal(verdict.category, expected);
      }
    ),
    { numRuns: 100 }
  );
});

// ===========================================================================
// Unit examples — Requirements 15.5 and 15.6, and the awkward phrasings
// ===========================================================================

test("a job alert carries no application evidence", () => {
  const verdict = evaluateApplicationEvidence(
    email({
      subject: "10 new jobs for you this week",
      senderDomain: "linkedin.com",
      senderRootDomain: "linkedin.com",
      hasUnsubscribe: true,
    })
  );
  assert.equal(verdict.strength, "none");
  assert.equal(verdict.category, "NOT_JOB_RELATED");
  assert.equal(verdict.reason, "excluded_job_alert");
});

test("a social notification carries no application evidence", () => {
  const verdict = evaluateApplicationEvidence(
    email({
      subject: "Priya Sharma wants to connect",
      snippet: "Accept Priya's invitation to grow your network",
      senderDomain: "linkedin.com",
      senderRootDomain: "linkedin.com",
    })
  );
  assert.equal(verdict.strength, "none");
  assert.equal(verdict.reason, "excluded_social_notification");
});

test("a finance application carries no application evidence", () => {
  const verdict = evaluateApplicationEvidence(
    email({
      subject: "Your loan application has been received",
      snippet: "We are processing your personal loan request",
      senderDomain: "hdfcbank.com",
      senderRootDomain: "hdfcbank.com",
    })
  );
  assert.equal(verdict.strength, "none");
  assert.equal(verdict.reason, "excluded_financial_application");
  assert.equal(verdict.isLifecycleEvent, false);
});

test("an application confirmation is strong lifecycle evidence", () => {
  const verdict = evaluateApplicationEvidence(
    email({
      subject: "Thank you for applying to Acme Corp",
      senderDomain: "greenhouse.io",
      senderRootDomain: "greenhouse.io",
    })
  );
  assert.equal(verdict.strength, "strong");
  assert.equal(verdict.category, "APPLICATION_CONFIRMATION");
  assert.equal(verdict.isLifecycleEvent, true);
  assert.ok(isLifecycleCategory(verdict.category));
  assert.ok(verdict.confidence >= 0.9);
});

test("a portal-relayed 'your application was sent to' is a confirmation, not a notification", () => {
  const verdict = evaluateApplicationEvidence(
    email({
      subject: "Your application was sent to Acme Corp",
      senderDomain: "linkedin.com",
      senderRootDomain: "linkedin.com",
      hasUnsubscribe: true,
    })
  );
  assert.equal(verdict.strength, "strong");
  assert.equal(verdict.category, "APPLICATION_CONFIRMATION");
});

test("'your application was viewed' is an engagement metric, not a lifecycle event", () => {
  const verdict = evaluateApplicationEvidence(
    email({
      subject: "Your application was viewed by 3 recruiters",
      senderDomain: "linkedin.com",
      senderRootDomain: "linkedin.com",
    })
  );
  assert.equal(verdict.strength, "none");
  assert.equal(verdict.reason, "excluded_social_notification");
});

test("a loan 'application received' never becomes an application confirmation", () => {
  const verdict = evaluateApplicationEvidence(
    email({ subject: "Loan application received", snippet: "EMI schedule attached" })
  );
  assert.equal(verdict.reason, "excluded_financial_application");
  assert.equal(verdict.category, "NOT_JOB_RELATED");
});

test("an online assessment invitation is interview-stage evidence", () => {
  const verdict = evaluateApplicationEvidence(
    email({
      subject: "Complete your online assessment for Acme Corp",
      senderDomain: "greenhouse.io",
      senderRootDomain: "greenhouse.io",
    })
  );
  assert.equal(verdict.category, "INTERVIEW_INVITATION");
  assert.equal(inferStatusFromCategory("INTERVIEW_INVITATION"), "Interview");
});

test("a take-home challenge is interview-stage evidence", () => {
  const verdict = evaluateApplicationEvidence(
    email({
      subject: "Take-home exercise for the Frontend opening",
      senderDomain: "ashbyhq.com",
      senderRootDomain: "ashbyhq.com",
    })
  );
  assert.equal(verdict.strength, "strong");
  assert.equal(verdict.category, "INTERVIEW_INVITATION");
});

test("a recruiter named Emi does not look like a loan EMI", () => {
  // The financial exclusion matches \bEMI\b case-sensitively on purpose.
  const verdict = evaluateApplicationEvidence(
    email({ subject: "Your upcoming interview with Emi Tanaka" })
  );
  assert.equal(verdict.strength, "strong");
  assert.equal(verdict.category, "INTERVIEW_UPDATE");
});

test("'of course' in a scheduling reply is not a course advertisement", () => {
  // Why the marketing exclusion never matches a bare "course".
  const verdict = evaluateApplicationEvidence(
    email({
      subject: "Re: your application to Acme Corp",
      bodyText: "Of course, happy to schedule a call this week.",
    })
  );
  assert.equal(verdict.strength, "strong");
  assert.equal(verdict.category, "INTERVIEW_INVITATION");
  assert.equal(verdict.reason, "lifecycle_body_match");
});

test("a hiring announcement is not an application, even from an employer domain", () => {
  const verdict = evaluateApplicationEvidence(
    email({
      subject: "Acme Corp is hiring — Priya posted a job",
      senderDomain: "acme.com",
      senderRootDomain: "acme.com",
    })
  );
  assert.equal(verdict.strength, "none");
  assert.equal(verdict.reason, "excluded_hiring_announcement");
});

test("an offer outranks an earlier confirmation in the same message", () => {
  const verdict = evaluateApplicationEvidence(
    email({
      subject: "Thank you for applying to Acme Corp",
      bodyText: "We are pleased to offer you the Backend Engineer position.",
    })
  );
  assert.equal(verdict.category, "OFFER");
  assert.equal(verdict.strength, "strong");
});

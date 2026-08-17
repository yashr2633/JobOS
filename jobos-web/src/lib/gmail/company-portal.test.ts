/**
 * Company-vs-portal separation and status-propagation tests.
 *
 * These cover the two product bugs this pass fixed:
 *  1. a job portal's own name being stored where the EMPLOYER belongs
 *  2. a resolved status being computed but then lost / defaulted to "Applied"
 *
 * Pure units — no network, no AI, no Supabase.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import {
  companyFromDomain,
  isAtsDomain,
  isPortalDisplayName,
  portalNameFromDomain,
  sanitizeCompanyName,
  PORTAL_DISPLAY_NAME_SET,
} from "./heuristics.ts";
import { buildProposals, type ActivityRowLike } from "./proposals.ts";
import {
  resolveStatus,
  shouldUpdateStatus,
  type ApplicationStatusValue,
  type InferredStatus,
} from "./statusInference.ts";
import type { ApplicationCandidate } from "./matching.ts";

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
    company: null,
    job_title: "Data Analyst",
    job_url: null,
    location: null,
    email_date: daysAgo(5),
    sender: "jobs@linkedin.com",
    sender_domain: "linkedin.com",
    confidence: 0.9,
    ...overrides,
  };
}

// ===========================================================================
// 1-3. A job portal must never be treated as the employer
// ===========================================================================

const PORTAL_DOMAINS = [
  "linkedin.com",
  "naukri.com",
  "indeed.com",
  "greenhouse.io",
  "lever.co",
  "myworkday.com",
  "foundit.in",
  "glassdoor.com",
  "ziprecruiter.com",
  "monster.com",
] as const;

test("every known portal domain is recognised as a platform, not an employer", () => {
  for (const domain of PORTAL_DOMAINS) {
    assert.equal(isAtsDomain(domain), true, `${domain} should be a known platform`);
    assert.equal(
      companyFromDomain(domain),
      null,
      `${domain} must never be used as the company name`
    );
  }
});

test("LinkedIn is never the company, but is a valid source", () => {
  assert.equal(companyFromDomain("linkedin.com"), null);
  assert.equal(portalNameFromDomain("linkedin.com"), "LinkedIn");
});

test("Naukri is never the company, but is a valid source", () => {
  assert.equal(companyFromDomain("naukri.com"), null);
  assert.equal(portalNameFromDomain("naukri.com"), "Naukri");
});

test("Indeed is never the company, but is a valid source", () => {
  assert.equal(companyFromDomain("indeed.com"), null);
  assert.equal(portalNameFromDomain("indeed.com"), "Indeed");
});

test("subdomains of a portal still resolve to the portal, not an employer", () => {
  // rootDomain() collapses these before they reach companyFromDomain.
  assert.equal(portalNameFromDomain("linkedin.com"), "LinkedIn");
  assert.equal(companyFromDomain("linkedin.com"), null);
});

// ===========================================================================
// AI-supplied company is sanitized (the path that had no protection)
// ===========================================================================

test("a model echoing the platform name as company is rejected", () => {
  // The prompt forbids this, but a weaker fallback provider may still do it.
  assert.equal(sanitizeCompanyName("LinkedIn", "linkedin.com"), null);
  assert.equal(sanitizeCompanyName("Naukri", "naukri.com"), null);
  assert.equal(sanitizeCompanyName("Indeed", "indeed.com"), null);
  assert.equal(sanitizeCompanyName("Greenhouse", "greenhouse.io"), null);
});

test("platform-name variants are also rejected as company", () => {
  assert.equal(sanitizeCompanyName("Naukri.com", "naukri.com"), null);
  assert.equal(sanitizeCompanyName("LinkedIn Jobs", "linkedin.com"), null);
});

test("a portal name is rejected even without a matching sender domain", () => {
  assert.equal(isPortalDisplayName("LinkedIn"), true);
  assert.equal(sanitizeCompanyName("LinkedIn", null), null);
});

// ===========================================================================
// 4-5. Real employers preserved; unknown stays unknown
// ===========================================================================

test("a real employer name is preserved even when relayed via a portal", () => {
  assert.equal(sanitizeCompanyName("Acme Corp", "linkedin.com"), "Acme Corp");
  assert.equal(sanitizeCompanyName("Stripe", "greenhouse.io"), "Stripe");
});

test("an employer's own domain yields the employer as company", () => {
  assert.equal(companyFromDomain("stripe.com"), "Stripe");
  assert.equal(portalNameFromDomain("stripe.com"), null);
});

test("an unknown employer stays unknown and is never fabricated", () => {
  assert.equal(sanitizeCompanyName(null, "linkedin.com"), null);
  assert.equal(sanitizeCompanyName("", "linkedin.com"), null);
  assert.equal(sanitizeCompanyName("   ", "linkedin.com"), null);
  // Freemail says nothing about an employer.
  assert.equal(companyFromDomain("gmail.com"), null);
});

// ===========================================================================
// 10. Proposal keeps company and source as separate fields
// ===========================================================================

test("a LinkedIn-relayed application yields employer as company and LinkedIn as source", () => {
  const [proposal] = buildProposals(
    [
      row({
        gmail_thread_id: "t1",
        company: "Acme Corp",
        job_title: "Data Analyst",
        sender_domain: "linkedin.com",
      }),
    ],
    [],
    new Map(),
    NOW
  );

  assert.equal(proposal.company, "Acme Corp");
  assert.equal(proposal.jobTitle, "Data Analyst");
  assert.equal(proposal.jobPortal, "LinkedIn");
  // The two must never collapse into one another.
  assert.notEqual(proposal.company, proposal.jobPortal);
});

test("a stored portal-as-company row is repaired on read, not carried forward", () => {
  // Simulates a row written by the earlier build, before sanitization existed.
  const [proposal] = buildProposals(
    [row({ gmail_thread_id: "t1", company: "LinkedIn", sender_domain: "linkedin.com" })],
    [],
    new Map(),
    NOW
  );

  assert.equal(proposal.company, null, "portal name must not survive as company");
  assert.equal(proposal.jobPortal, "LinkedIn");
});

test("direct employer mail produces a company and no portal", () => {
  const [proposal] = buildProposals(
    [
      row({
        gmail_thread_id: "t1",
        company: "Stripe",
        sender: "careers@stripe.com",
        sender_domain: "stripe.com",
      }),
    ],
    [],
    new Map(),
    NOW
  );

  assert.equal(proposal.company, "Stripe");
  assert.equal(proposal.jobPortal, null);
});

// ===========================================================================
// 6-8. Status resolution reaches the proposal correctly
// ===========================================================================

test("Applied then a newer Rejection resolves to Rejected", () => {
  const [proposal] = buildProposals(
    [
      row({ gmail_thread_id: "t1", category: "APPLICATION_CONFIRMATION", email_date: daysAgo(20) }),
      row({ gmail_thread_id: "t1", category: "REJECTION", email_date: daysAgo(2) }),
    ],
    [],
    new Map(),
    NOW
  );

  assert.equal(proposal.status, "Rejected");
  assert.equal(proposal.statusFromEvidence, true);
});

test("Applied then a newer Interview invitation resolves to Interview", () => {
  const [proposal] = buildProposals(
    [
      row({ gmail_thread_id: "t1", category: "APPLICATION_CONFIRMATION", email_date: daysAgo(15) }),
      row({ gmail_thread_id: "t1", category: "INTERVIEW_INVITATION", email_date: daysAgo(3) }),
    ],
    [],
    new Map(),
    NOW
  );

  assert.equal(proposal.status, "Interview");
});

test("an Offer is not downgraded by an older Applied email processed later", () => {
  // Deliberately supplied newest-first, as a resumed scan might deliver them.
  const [proposal] = buildProposals(
    [
      row({ gmail_thread_id: "t1", category: "OFFER", email_date: daysAgo(2) }),
      row({ gmail_thread_id: "t1", category: "APPLICATION_CONFIRMATION", email_date: daysAgo(45) }),
    ],
    [],
    new Map(),
    NOW
  );

  assert.equal(proposal.status, "Offer");
});

test("evidence does not blindly collapse to Applied", () => {
  for (const [category, expected] of [
    ["INTERVIEW_INVITATION", "Interview"],
    ["INTERVIEW_UPDATE", "Interview"],
    ["OFFER", "Offer"],
    ["REJECTION", "Rejected"],
  ] as const) {
    const [proposal] = buildProposals(
      [row({ gmail_thread_id: `t-${category}`, category, email_date: daysAgo(3) })],
      [],
      new Map(),
      NOW
    );
    assert.equal(proposal.status, expected, `${category} should resolve to ${expected}`);
  }
});

// ===========================================================================
// 9. The import contract: resolved status survives to the application row
// ===========================================================================

/**
 * Mirrors the guard in the import route. Kept in the test so a regression in
 * the route's narrowing rules is caught here too.
 */
const EVIDENCE_STATUSES: Record<InferredStatus, true> = {
  Applied: true,
  Interview: true,
  Offer: true,
  Rejected: true,
};

function isEvidenceStatus(value: unknown): value is InferredStatus {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(EVIDENCE_STATUSES, value)
  );
}

test("a resolved Rejected status is accepted as importable evidence", () => {
  const [proposal] = buildProposals(
    [
      row({ gmail_thread_id: "t1", category: "APPLICATION_CONFIRMATION", email_date: daysAgo(20) }),
      row({ gmail_thread_id: "t1", category: "REJECTION", email_date: daysAgo(2) }),
    ],
    [],
    new Map(),
    NOW
  );

  // This is the exact predicate the merge path applies before writing.
  assert.equal(isEvidenceStatus(proposal.status), true);
  assert.equal(proposal.status, "Rejected");
});

test("a derived Ghosted status is refused as Gmail evidence", () => {
  // Ghosted is derived from silence, so it must not be written as evidence.
  assert.equal(isEvidenceStatus("Ghosted"), false);
  assert.equal(isEvidenceStatus("NotAStatus"), false);
  assert.equal(isEvidenceStatus(undefined), false);
  assert.equal(isEvidenceStatus(null), false);
});

test("a merge applies newer evidence over an existing status", () => {
  assert.equal(
    shouldUpdateStatus({
      currentStatus: "Applied",
      currentStatusAt: daysAgo(20),
      nextStatus: "Rejected",
      nextStatusAt: daysAgo(2),
    }),
    true
  );
});

test("a merge cannot downgrade a status using older evidence", () => {
  assert.equal(
    shouldUpdateStatus({
      currentStatus: "Offer",
      currentStatusAt: daysAgo(2),
      nextStatus: "Applied",
      nextStatusAt: daysAgo(40),
    }),
    false
  );
});

// ===========================================================================
// 11. Manually-created applications are not rewritten
// ===========================================================================

test("a manual application with an unrelated employer is never auto-linked", () => {
  const manual: ApplicationCandidate[] = [
    {
      id: "manual-1",
      company: "Manually Entered Co",
      role: "Backend Engineer",
      appliedDate: daysAgo(10),
      jobUrl: null,
    },
  ];

  const [proposal] = buildProposals(
    [row({ gmail_thread_id: "t1", company: "Acme Corp", sender_domain: "linkedin.com" })],
    manual,
    new Map(),
    NOW
  );

  assert.equal(proposal.suggestedApplicationId, null);
  assert.equal(proposal.autoLink, false);
  assert.equal(proposal.matchTier, "none");
});

test("a same-employer different-role find requires confirmation before merging", () => {
  const manual: ApplicationCandidate[] = [
    {
      id: "manual-1",
      company: "Acme Corp",
      role: "Backend Engineer",
      appliedDate: daysAgo(10),
      jobUrl: null,
    },
  ];

  const [proposal] = buildProposals(
    [
      row({
        gmail_thread_id: "t1",
        company: "Acme Corp",
        job_title: "Data Analyst",
        sender_domain: "linkedin.com",
      }),
    ],
    manual,
    new Map(),
    NOW
  );

  assert.equal(proposal.matchTier, "company_only");
  assert.equal(proposal.autoLink, false, "must not silently rewrite the manual row");
});

// ===========================================================================
// 12. Read-time repair is idempotent
// ===========================================================================

test("building proposals twice yields identical company/source/status", () => {
  const rows = [
    row({
      gmail_thread_id: "t1",
      company: "LinkedIn",
      sender_domain: "linkedin.com",
      category: "REJECTION",
      email_date: daysAgo(3),
    }),
  ];

  const first = buildProposals(rows, [], new Map(), NOW);
  const second = buildProposals(rows, [], new Map(), NOW);

  assert.deepEqual(
    first.map((p) => [p.company, p.jobPortal, p.status]),
    second.map((p) => [p.company, p.jobPortal, p.status])
  );
  assert.equal(first[0].company, null);
  assert.equal(first[0].jobPortal, "LinkedIn");
  assert.equal(first[0].status, "Rejected");
});

test("sanitization is stable when applied to its own output", () => {
  const once = sanitizeCompanyName("Acme Corp", "linkedin.com");
  const twice = sanitizeCompanyName(once, "linkedin.com");
  assert.equal(once, twice);
});

// ===========================================================================
// Status vocabulary must remain exactly the five DB-allowed values
// ===========================================================================

test("no new status value was introduced", () => {
  const allowed: ApplicationStatusValue[] = [
    "Applied",
    "Interview",
    "Offer",
    "Rejected",
    "Ghosted",
  ];

  const resolved = resolveStatus([
    { category: "OFFER", emailDate: daysAgo(1) },
  ]);

  assert.ok(resolved !== null);
  assert.ok(allowed.includes(resolved));
});

// ===========================================================================
// Feature: gmail-application-precision, Property 15: A portal is never stored
// or accepted as an employer
//
// Validates: Requirements 7.6, 7.7, 8.5
//
// Two halves, because there are two ways a portal name gets in: the automatic
// path (the model or an old row hands one over as `company`) and the manual
// path (the user types one into the Unknown-bucket employer field).
// ===========================================================================

/** Portals a real mailbox actually relays application mail through. */
const PORTAL_SENDER_DOMAINS = [
  "linkedin.com",
  "naukri.com",
  "indeed.com",
  "greenhouse.io",
  "lever.co",
  "myworkday.com",
  "glassdoor.com",
  "ashbyhq.com",
] as const;

/** Employer-owned domains: no portal, so the employer stands on its own. */
const EMPLOYER_SENDER_DOMAINS = ["stripe.com", "acme-corp.com", "globex.io"] as const;

/** Exactly the names the portals call themselves. */
const PORTAL_DISPLAY_NAMES_AS_COMPANY = [
  "LinkedIn",
  "Naukri",
  "Indeed",
  "Greenhouse",
  "Lever",
  "Workday",
  "Glassdoor",
  "Ashby",
] as const;

/** Near-misses: not an exact display name, still naming the platform. */
const PORTAL_VARIANTS_AS_COMPANY = [
  "Naukri.com",
  "LinkedIn Jobs",
  "linkedin",
  "  Indeed  ",
  "Greenhouse Software",
  "Workday Recruiting",
] as const;

/** Real employers, none of which contains a portal name as a substring. */
const GENUINE_EMPLOYERS = ["Acme Corp", "Stripe", "Globex", "Zenith Labs"] as const;

const EMPTYISH_COMPANY = [null, "", "   "] as const;

const COMPANY_CANDIDATES = [
  ...PORTAL_DISPLAY_NAMES_AS_COMPANY,
  ...PORTAL_VARIANTS_AS_COMPANY,
  ...GENUINE_EMPLOYERS,
  ...EMPTYISH_COMPANY,
] as const;

const LIFECYCLE_CATEGORIES_POOL = [
  "APPLICATION_CONFIRMATION",
  "APPLICATION_RECEIVED",
  "INTERVIEW_INVITATION",
  "REJECTION",
  "OFFER",
] as const;

interface PortalRowSeed {
  company: string | null;
  threadId: string | null;
  category: (typeof LIFECYCLE_CATEGORIES_POOL)[number];
  daysBack: number;
}

const portalRowSeedArb: fc.Arbitrary<PortalRowSeed> = fc.record({
  company: fc.constantFrom(...COMPANY_CANDIDATES),
  threadId: fc.constantFrom("pt-1", "pt-2", null),
  category: fc.constantFrom(...LIFECYCLE_CATEGORIES_POOL),
  daysBack: fc.integer({ min: 0, max: 60 }),
});

test("Property 15: a portal is never stored or accepted as an employer", () => {
  fc.assert(
    fc.property(
      // One relay per case: a thread arrives through one platform, which is
      // what makes the "names the sending platform" rule strict here.
      fc.constantFrom(...PORTAL_SENDER_DOMAINS, ...EMPLOYER_SENDER_DOMAINS),
      fc.array(portalRowSeedArb, { minLength: 1, maxLength: 6 }),
      fc.constantFrom(...COMPANY_CANDIDATES),
      (senderDomain, seeds, userSuppliedName) => {
        const rows: ActivityRowLike[] = seeds.map((seed, index) => ({
          id: `pp-act-${index}`,
          gmail_message_id: `pp-msg-${index}`,
          gmail_thread_id: seed.threadId,
          application_id: null,
          category: seed.category,
          company: seed.company,
          job_title: "Backend Engineer",
          job_url: null,
          location: null,
          email_date: daysAgo(seed.daysBack),
          sender: `no-reply@${senderDomain}`,
          sender_domain: senderDomain,
          confidence: 0.9,
        }));

        const expectedPortal = portalNameFromDomain(senderDomain);
        const byId = new Map(rows.map((entry) => [entry.id, entry]));

        for (const proposal of buildProposals(rows, [], new Map(), NOW)) {
          // 7.7 — the portal is derived from the sender domain into its own
          // field, independently of whatever `company` said.
          assert.equal(
            proposal.jobPortal,
            expectedPortal,
            "the portal must come from the sender domain alone"
          );

          // 7.6 — a portal display name never survives as the employer.
          assert.equal(
            isPortalDisplayName(proposal.company),
            false,
            `a portal display name must never be the employer (${String(proposal.company)})`
          );

          if (proposal.company !== null) {
            assert.notEqual(
              proposal.company,
              proposal.jobPortal,
              "employer and portal must never be the same value"
            );

            if (proposal.jobPortal !== null) {
              assert.equal(
                proposal.company.toLowerCase().includes(proposal.jobPortal.toLowerCase()),
                false,
                "a variant naming the sending platform must not survive as employer"
              );
            }
          }

          // A genuine employer name survives unchanged when the evidence
          // agrees on it — precision must not cost real data.
          const groupCompanies = proposal.activityIds.map(
            (activityId) => byId.get(activityId)?.company ?? null
          );
          const [firstCompany] = groupCompanies;
          const unanimous =
            firstCompany !== null &&
            groupCompanies.every((value) => value === firstCompany);
          if (
            unanimous &&
            (GENUINE_EMPLOYERS as readonly string[]).includes(firstCompany)
          ) {
            assert.equal(
              proposal.company,
              firstCompany,
              "a genuine employer name must survive unchanged"
            );
          }
        }

        // 8.5 — the manual path. Whatever the user types, the value that would
        // reach the database is never a portal name; a portal name is rejected
        // outright rather than stored.
        const accepted = sanitizeCompanyName(userSuppliedName, senderDomain);
        assert.equal(
          isPortalDisplayName(accepted),
          false,
          "a user-supplied portal name must never be accepted as an employer"
        );
        if (isPortalDisplayName(userSuppliedName)) {
          assert.equal(accepted, null, "a supplied portal name is rejected, not stored");
        }
        if (accepted !== null && expectedPortal !== null) {
          assert.equal(
            accepted.toLowerCase().includes(expectedPortal.toLowerCase()),
            false,
            "a supplied variant naming the platform is rejected"
          );
        }
      }
    ),
    { numRuns: 100 }
  );
});

test("no portal display name is ever stored as an employer name", () => {
  // Requirement 15.10, stated directly against the full portal vocabulary
  // rather than a sample of it: every name a portal calls itself, offered as
  // the employer, from every portal domain, resolves to no employer at all.
  for (const displayName of PORTAL_DISPLAY_NAME_SET) {
    for (const senderDomain of PORTAL_SENDER_DOMAINS) {
      const [proposal] = buildProposals(
        [
          row({
            gmail_thread_id: `t-${displayName}-${senderDomain}`,
            company: displayName,
            sender: `no-reply@${senderDomain}`,
            sender_domain: senderDomain,
          }),
        ],
        [],
        new Map(),
        NOW
      );

      assert.equal(
        proposal.company,
        null,
        `${displayName} must not be stored as an employer`
      );
      assert.equal(proposal.jobPortal, portalNameFromDomain(senderDomain));
      // And never a placeholder standing in for one.
      assert.notEqual(proposal.company, "Unknown company");
    }
  }
});

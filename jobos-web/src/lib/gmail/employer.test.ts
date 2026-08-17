/**
 * Employer extraction — the fix for "285 application-related, 84 unknown
 * employer, 0 created".
 *
 * The employer was only ever derived from the sender domain. `companyFromDomain`
 * correctly refuses ATS/job-board domains, but real application confirmations are
 * relayed BY those domains, so the employer resolved to null for essentially every
 * portal application. `decideProposal` then took its step-4 `employer === null`
 * branch and returned `hold_unknown_employer` — strong evidence, right category,
 * row read, and still no application. That was the 84, and the reason created
 * stayed 0.
 *
 * The employer name is in the text. These tests pin that it is read from the text,
 * and that reading free text still cannot invent one.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import {
  employerFromContent,
  normalizeEmployerName,
  resolveEmployer,
} from "./employer.ts";
import { companyFromDomain } from "./heuristics.ts";
import { decideProposal } from "./autoImport.ts";
import { buildProposals } from "./proposals.ts";

/** A portal-relayed message: the employer is in the text, never in the domain. */
function portalEmail(overrides: {
  subject?: string;
  snippet?: string;
  bodyText?: string;
  senderRootDomain?: string;
}) {
  return {
    subject: overrides.subject ?? "",
    snippet: overrides.snippet ?? "",
    bodyText: overrides.bodyText ?? "",
    senderRootDomain: overrides.senderRootDomain ?? "linkedin.com",
  };
}

// ===========================================================================
// The defect
// ===========================================================================

test("the sender domain alone yields no employer for any portal", () => {
  // Every one of these relays genuine application mail, and every one correctly
  // refuses to be treated as an employer. That was the whole source of employer
  // information, which is why portal applications could never be created.
  for (const domain of [
    "linkedin.com",
    "indeed.com",
    "naukri.com",
    "greenhouse.io",
    "lever.co",
    "myworkday.com",
  ]) {
    assert.equal(companyFromDomain(domain), null, `${domain} is not an employer`);
  }
});

// ===========================================================================
// Extraction from the phrasings portals actually use
// ===========================================================================

test("the employer is read from real portal confirmation phrasings", () => {
  const cases: readonly [string, string][] = [
    ["Your application was sent to Acme Corp", "Acme Corp"],
    ["Your application was successfully sent to Globex", "Globex"],
    ["Your application has been submitted to Initech", "Initech"],
    ["Thank you for applying to Umbrella Health", "Umbrella Health"],
    ["Thanks for applying to Soylent Industries", "Soylent Industries"],
    ["You applied to Stark Industries", "Stark Industries"],
    ["Your application to Wayne Enterprises", "Wayne Enterprises"],
    ["Interview invitation with Tyrell Corporation", "Tyrell Corporation"],
  ];

  for (const [subject, expected] of cases) {
    assert.equal(
      employerFromContent(portalEmail({ subject })),
      expected,
      `subject: ${subject}`
    );
  }
});

test("the employer is read from the body when the subject does not name it", () => {
  // The exact production shape: a generic subject, the employer in the body, and a
  // portal sender. Before this module the result was null and the application was
  // held.
  const email = portalEmail({
    subject: "Your application update",
    bodyText:
      "Hi there,\n\nThank you for applying to Northwind Traders. " +
      "We have received your application and will review it shortly.",
  });

  assert.equal(employerFromContent(email), "Northwind Traders");
});

test("a trailing clause is cut, so the employer is not the rest of the sentence", () => {
  assert.equal(
    employerFromContent(
      portalEmail({ subject: "Your application was sent to Acme Corp for Backend Engineer" })
    ),
    "Acme Corp"
  );
  assert.equal(
    employerFromContent(
      portalEmail({ subject: "Your application was sent to Globex via LinkedIn" })
    ),
    "Globex"
  );
  assert.equal(
    employerFromContent(
      portalEmail({ bodyText: "Acme Corp has received your application for the role." })
    ),
    "Acme Corp"
  );
});

// ===========================================================================
// It still cannot invent an employer
// ===========================================================================

test("the platform itself is never returned as the employer", () => {
  // `sanitizeCompanyName` remains the final authority, so even a literal capture
  // of the portal's own name is refused.
  for (const platform of ["LinkedIn", "Indeed", "Naukri", "Greenhouse"]) {
    assert.equal(
      employerFromContent(
        portalEmail({ subject: `Your application was sent to ${platform}` })
      ),
      null,
      `${platform} must not be stored as an employer`
    );
  }
});

test("a message that names no employer yields null, never a guess", () => {
  for (const subject of [
    "Your application update",
    "We have received your application",
    "Thanks for your interest",
    "",
  ]) {
    assert.equal(employerFromContent(portalEmail({ subject })), null);
  }
});

test("sentence structure and routing data are rejected, not stored", () => {
  for (const raw of [
    "the",
    "your",
    "a",
    "   ",
    "123",
    "!!!",
    "careers@acme.com",
    "https://boards.greenhouse.io/acme",
    "x",
  ]) {
    assert.equal(normalizeEmployerName(raw), null, `must reject: '${raw}'`);
  }
});

test("an over-long capture is refused rather than stored wrong", () => {
  // A long capture means the pattern ran past the name. A wrong employer is worse
  // than an unresolved one.
  const long = "A".repeat(61);
  assert.equal(normalizeEmployerName(long), null);
});

test("extraction never throws and never returns a blank name", () => {
  fc.assert(
    fc.property(fc.string(), fc.string(), (subject, bodyText) => {
      const result = employerFromContent(portalEmail({ subject, bodyText }));
      if (result !== null) {
        assert.ok(result.trim().length >= 2, "a returned name is never blank");
        assert.ok(result.length <= 60);
      }
    }),
    { numRuns: 300 }
  );
});

// ===========================================================================
// Precedence, and the end-to-end consequence
// ===========================================================================

test("content wins over the sender domain, which stays the fallback", () => {
  // Portal relay: content names the employer, domain names the portal.
  assert.equal(
    resolveEmployer(
      portalEmail({ subject: "Your application was sent to Acme Corp" }),
      companyFromDomain("linkedin.com")
    ),
    "Acme Corp"
  );

  // Direct employer mail with no naming phrase: the domain is still used.
  assert.equal(
    resolveEmployer(
      portalEmail({ subject: "Application update", senderRootDomain: "stripe.com" }),
      companyFromDomain("stripe.com")
    ),
    "Stripe"
  );

  // Neither: unresolved, and honestly so.
  assert.equal(
    resolveEmployer(
      portalEmail({ subject: "Application update" }),
      companyFromDomain("linkedin.com")
    ),
    null
  );
});

test("a portal confirmation now creates an application instead of being held", () => {
  const employer = resolveEmployer(
    portalEmail({ subject: "Your application was sent to Acme Corp" }),
    companyFromDomain("linkedin.com")
  );
  assert.equal(employer, "Acme Corp");

  const [proposal] = buildProposals(
    [
      {
        id: "act-1",
        gmail_message_id: "m1",
        gmail_thread_id: "t1",
        application_id: null,
        category: "APPLICATION_CONFIRMATION",
        company: employer,
        job_title: "Backend Engineer",
        job_url: null,
        location: null,
        email_date: "2026-06-01T10:00:00.000Z",
        sender: "jobs-noreply@linkedin.com",
        sender_domain: "linkedin.com",
        confidence: 0.95,
        evidence_strength: "strong",
      },
    ],
    [],
    new Map(),
    Date.parse("2026-06-02T00:00:00.000Z")
  );

  // Before: company null -> hold_unknown_employer -> created 0.
  // After: a real employer -> create, automatically, with no approval step.
  assert.deepEqual(decideProposal(proposal), {
    action: "create",
    applicationId: null,
    reason: "strong_lifecycle_evidence",
  });
});

test("both write paths resolve the employer from content", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");

  for (const file of ["sync.ts", "regate.ts"]) {
    const source = readFileSync(
      join(process.cwd(), "src", "lib", "gmail", file),
      "utf8"
    );
    assert.ok(
      source.includes("resolveEmployer(email, companyFromDomain("),
      `${file} must resolve the employer from content, not the domain alone`
    );
  }
});

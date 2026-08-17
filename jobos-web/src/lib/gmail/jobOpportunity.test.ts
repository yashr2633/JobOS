/**
 * JOB_OPPORTUNITY — a job the user MIGHT apply to, kept strictly separate from an
 * application the user actually made.
 *
 * The classification is applied at the pipeline layer: the Evidence Gate already
 * identifies job alerts precisely (`excluded_job_alert`), and `classifyParsedEmails`
 * stores those under `JOB_OPPORTUNITY` instead of `NOT_JOB_RELATED`. The gate's own
 * verdict is unchanged — strength `none`, not a candidate — so an opportunity can
 * never be a lifecycle event, never auto-imported, never in the unknown bucket, and
 * never a KPI. That KPI-safety is structural: `JOB_OPPORTUNITY` is absent from
 * `LIFECYCLE_CATEGORIES`.
 *
 * Scenario coverage: FIX 2 items 3, 4, 6, and the application-vs-opportunity split.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { classifyParsedEmails } from "./sync.ts";
import { LIFECYCLE_CATEGORIES } from "./applicationEvidence.ts";
import { EMAIL_CATEGORIES } from "./heuristics.ts";
import type { ParsedEmail } from "./parse.ts";

function email(overrides: Partial<ParsedEmail> = {}): ParsedEmail {
  return {
    gmailMessageId: "m1",
    gmailThreadId: "t1",
    subject: "",
    sender: "jobs@linkedin.com",
    senderDomain: "linkedin.com",
    senderRootDomain: "linkedin.com",
    emailDate: "2026-06-01T10:00:00.000Z",
    snippet: "",
    rfcMessageId: "<a@b>",
    hasUnsubscribe: false,
    labelIds: ["INBOX"],
    jobUrl: null,
    bodyText: "",
    ...overrides,
  };
}

// ===========================================================================
// The category is KPI-safe by construction
// ===========================================================================

test("JOB_OPPORTUNITY exists and is NOT a lifecycle category", () => {
  assert.ok(
    (EMAIL_CATEGORIES as readonly string[]).includes("JOB_OPPORTUNITY"),
    "the vocabulary must include the opportunity category"
  );
  assert.equal(
    LIFECYCLE_CATEGORIES.has("JOB_OPPORTUNITY" as never),
    false,
    "an opportunity must never be a lifecycle event, or it could reach a KPI"
  );
});

test("the migration adds JOB_OPPORTUNITY to the category CHECK, exactly once", () => {
  // Exactly one new migration for this pass; it must not touch an applied one.
  const migration = readFileSync(
    join(process.cwd(), "supabase-schema-sprint11-job-opportunity.sql"),
    "utf8"
  );
  assert.match(migration, /'JOB_OPPORTUNITY'/);
  assert.match(migration, /gmail_activity_category_check/);
});

// ===========================================================================
// Alerts become opportunities; applications do not
// ===========================================================================

test("a job alert is classified as an opportunity, not an application", () => {
  const result = classifyParsedEmails(
    [email({ subject: "12 new jobs for you this week", snippet: "Jobs matching your profile" })],
    "conn-1"
  );

  // Not a candidate: it never enters the application path.
  assert.equal(result.candidates, 0);
  assert.equal(result.ambiguous.length, 0);

  const [row] = result.records;
  assert.equal(row.category, "JOB_OPPORTUNITY");
  // No application strength, so it can never be auto-imported.
  assert.equal(row.evidenceStrength, null);
});

test("'jobs you may be interested in' is an opportunity", () => {
  const result = classifyParsedEmails(
    [email({ subject: "Jobs you may be interested in", snippet: "Recommended for you" })],
    "conn-1"
  );
  assert.equal(result.records[0].category, "JOB_OPPORTUNITY");
  assert.equal(result.candidates, 0);
});

test("a real application confirmation is NOT an opportunity", () => {
  const result = classifyParsedEmails(
    [
      email({
        subject: "Your application was submitted",
        bodyText: "Thank you for applying to Acme Corp. We have received your application.",
      }),
    ],
    "conn-1"
  );

  const [row] = result.records;
  assert.notEqual(row.category, "JOB_OPPORTUNITY");
  assert.equal(row.category, "APPLICATION_CONFIRMATION");
  assert.equal(row.evidenceStrength, "strong");
  assert.equal(result.candidates, 1);
});

test("a genuine newsletter stays NOT_JOB_RELATED, not an opportunity", () => {
  // Only job ALERTS become opportunities. Marketing is still excluded outright,
  // so the opportunity count is not inflated by newsletters.
  const result = classifyParsedEmails(
    [email({ subject: "Our weekly newsletter", snippet: "20% off all courses this week" })],
    "conn-1"
  );
  assert.equal(result.records[0].category, "NOT_JOB_RELATED");
});

// ===========================================================================
// Opportunities cannot reach an application total
// ===========================================================================

test("an opportunity row cannot feed the Auto_Importer", () => {
  // The importer's input query filters on lifecycle categories. Prove the
  // opportunity category is not one of them, from the data-access source, so an
  // opportunity is never even read as a proposal.
  const dataLayer = readFileSync(
    join(process.cwd(), "src", "lib", "api", "gmailActivity.ts"),
    "utf8"
  );
  assert.match(
    dataLayer,
    /LIFECYCLE_CATEGORY_LIST[\s\S]{0,60}=[\s\S]{0,20}\[\.\.\.LIFECYCLE_CATEGORIES\]/,
    "the importer's input must be the lifecycle set, which excludes JOB_OPPORTUNITY"
  );

  // And the dashboard report derives KPIs from `applications` rows only — it has
  // no gmail_activity category input at all.
  const report = readFileSync(
    join(process.cwd(), "src", "app", "dashboard", "report.ts"),
    "utf8"
  );
  assert.ok(
    !report.includes("JOB_OPPORTUNITY"),
    "the application report must not reference the opportunity category"
  );
  assert.ok(
    !report.includes("gmail_activity"),
    "the application report must read applications, never gmail_activity"
  );
});

test("the dashboard counts opportunities with a category-scoped head query", () => {
  const dataLayer = readFileSync(
    join(process.cwd(), "src", "lib", "api", "gmailActivity.ts"),
    "utf8"
  );
  assert.match(dataLayer, /export async function countJobOpportunities/);
  assert.match(dataLayer, /\.eq\("category", "JOB_OPPORTUNITY"\)/);
});

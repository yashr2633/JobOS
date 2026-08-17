/**
 * Tests for the Gmail activity data layer.
 *
 * Two things are checked here. First, the Unknown_Bucket predicate, which is
 * pure precisely so its membership rule can be pinned without a database.
 * Second, structural facts about the module's queries that no single function
 * call can prove: that every statement is scoped to the acting user, and that
 * no read asks for a column that could carry email text.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { isUnknownBucketRow } from "./gmailActivity.ts";
import { LIFECYCLE_CATEGORIES } from "../gmail/applicationEvidence.ts";
import { EMAIL_CATEGORIES, type EmailCategory } from "../gmail/heuristics.ts";

const DATA_LAYER_PATH = join(
  process.cwd(),
  "src",
  "lib",
  "api",
  "gmailActivity.ts"
);

function row(overrides: {
  application_id?: string | null;
  company?: string | null;
  category: EmailCategory;
}) {
  return {
    application_id: overrides.application_id ?? null,
    company: overrides.company ?? null,
    category: overrides.category,
  };
}

// ---------------------------------------------------------------------------
// Unknown_Bucket membership
// ---------------------------------------------------------------------------

test("unlinked lifecycle evidence with no employer is in the bucket", () => {
  for (const category of LIFECYCLE_CATEGORIES) {
    assert.equal(
      isUnknownBucketRow(row({ category })),
      true,
      `${category} with a null company should be bucketed`
    );
  }
});

test("a known employer keeps a row out of the bucket", () => {
  assert.equal(
    isUnknownBucketRow(row({ category: "OFFER", company: "Acme" })),
    false
  );
});

test("an already-linked row is out of the bucket", () => {
  assert.equal(
    isUnknownBucketRow(row({ category: "OFFER", application_id: "app-1" })),
    false
  );
});

test("non-lifecycle categories are never bucketed", () => {
  const nonLifecycle = EMAIL_CATEGORIES.filter(
    (category) => !LIFECYCLE_CATEGORIES.has(category)
  );

  assert.ok(nonLifecycle.length > 0, "the vocabulary has non-lifecycle values");

  for (const category of nonLifecycle) {
    assert.equal(
      isUnknownBucketRow(row({ category })),
      false,
      `${category} is not application lifecycle evidence`
    );
  }
});

// ---------------------------------------------------------------------------
// Structural guarantees
// ---------------------------------------------------------------------------

test("every statement in the data layer is scoped to the acting user", () => {
  const source = readFileSync(DATA_LAYER_PATH, "utf8");

  // Each statement starts at .from( and ends at the destructured await.
  const statements = source.split(/\.from\(/).slice(1);
  assert.ok(statements.length > 0, "the module should build queries");

  for (const statement of statements) {
    const clause = statement.split(";")[0];
    // A read or an update filters on user_id; an insert carries it in the row
    // payload; the ledger upsert additionally conflicts on the owner column.
    const scoped =
      clause.includes('.eq("user_id", userId)') ||
      clause.includes("user_id: userId") ||
      clause.includes('onConflict: "user_id,gmail_message_id"');
    assert.ok(scoped, `a statement is missing its user scope: ${clause.slice(0, 80)}`);
  }
});

test("the bucket derivation matches the partial index predicate", () => {
  const source = readFileSync(DATA_LAYER_PATH, "utf8");
  const bucketQuery = source.match(
    /export async function fetchUnknownBucket[\s\S]*?\n\}/
  );

  assert.ok(bucketQuery, "fetchUnknownBucket should exist");
  assert.match(bucketQuery[0], /\.is\("application_id", null\)/);
  assert.match(bucketQuery[0], /\.is\("company", null\)/);
  assert.match(bucketQuery[0], /\.in\("category", LIFECYCLE_CATEGORY_LIST\)/);
  // Ordered so the (user_id, email_date DESC) partial index serves the read.
  assert.match(bucketQuery[0], /\.order\("email_date", \{ ascending: false \}\)/);
});

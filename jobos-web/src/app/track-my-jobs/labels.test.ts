/**
 * Display-label tests for the Gmail tracking vocabularies.
 *
 * Two things are checked: every real code resolves to something a person can
 * read (never `snake_case`, never `SCREAMING_CASE`), and a code this build does
 * not know about falls back to "Other" rather than leaking through.
 *
 * The category side cross-checks against the runtime `EMAIL_CATEGORIES` array,
 * so a category added to the gate fails here. The reason side is exhaustive by
 * construction: `REASON_LABELS` is typed `Record<EvidenceReason |
 * AutoImportReason, string>`, so tsc rejects a missing member.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  CATEGORY_LABELS,
  REASON_LABELS,
  UNKNOWN_LABEL,
  categoryLabel,
  reasonLabel,
} from "./labels.ts";
import { EMAIL_CATEGORIES } from "../../lib/gmail/heuristics.ts";

/** A label is "raw" if it still looks like a stored code. */
function looksRaw(label: string): boolean {
  return label.includes("_") || label === label.toUpperCase();
}

test("every known reason code has a human-readable label", () => {
  const codes = Object.keys(REASON_LABELS);
  assert.ok(codes.length > 0);

  for (const code of codes) {
    const label = reasonLabel(code);
    assert.notEqual(label, UNKNOWN_LABEL, `${code} fell back to "Other"`);
    assert.equal(looksRaw(label), false, `${code} renders raw: ${label}`);
  }
});

test("every real email category has a human-readable label", () => {
  for (const category of EMAIL_CATEGORIES) {
    assert.ok(
      category in CATEGORY_LABELS,
      `${category} has no display label`
    );

    const label = categoryLabel(category);
    assert.notEqual(label, UNKNOWN_LABEL, `${category} fell back to "Other"`);
    assert.equal(looksRaw(label), false, `${category} renders raw: ${label}`);
  }
});

test("an unknown reason code falls back to Other", () => {
  assert.equal(reasonLabel("excluded_newsletter"), UNKNOWN_LABEL);
  assert.equal(reasonLabel("some_future_code"), UNKNOWN_LABEL);
});

test("an unknown category code falls back to Other", () => {
  assert.equal(categoryLabel("SOMETHING_NEW"), UNKNOWN_LABEL);
});

test("a null reason reads as an absence, not as a code", () => {
  const label = reasonLabel(null);
  assert.equal(looksRaw(label), false);
  assert.notEqual(label, "null");
});

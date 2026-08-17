/**
 * Tests for the application status lifecycle.
 *
 * Deterministic unit tests only. Two things are covered: the transition table
 * itself, and the agreement between that table and the SQL function that
 * enforces it. The second one is the point — the rule exists twice by design
 * (once in TypeScript for the UI and the data layer, once in SQL for atomicity
 * and as a security backstop), and two copies of a rule drift unless something
 * fails when they do.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  APPLICATION_STATUSES,
  APPLICATION_STATUS_SOURCES,
  FORWARD_TRANSITIONS,
  STATUS_CORRECTION_NOTE,
  STATUS_NOTE_MAX_LENGTH,
  allowedNextStatuses,
  classifyTransition,
  describeRefusedTransition,
  forwardTransitionPairs,
  isApplicationStatus,
  isApplicationStatusSource,
  isForwardTransition,
  normalizeStatusNote,
} from "./lifecycle.ts";

const MIGRATION = join(
  process.cwd(),
  "supabase-schema-sprint10-application-lifecycle.sql"
);

function migrationSql(): string {
  return readFileSync(MIGRATION, "utf8").replace(/\r\n/g, "\n");
}

// ---------------------------------------------------------------------------
// The status vocabulary
// ---------------------------------------------------------------------------

test("the vocabulary is exactly the five existing statuses", () => {
  assert.deepEqual(
    [...APPLICATION_STATUSES],
    ["Applied", "Interview", "Offer", "Rejected", "Ghosted"]
  );

  // Every status is a key of the transition table, so no status can be missing
  // a rule and no rule can name a status that does not exist.
  assert.deepEqual(
    Object.keys(FORWARD_TRANSITIONS).sort(),
    [...APPLICATION_STATUSES].sort()
  );

  for (const status of APPLICATION_STATUSES) {
    assert.equal(isApplicationStatus(status), true);
    for (const target of FORWARD_TRANSITIONS[status]) {
      assert.ok(
        APPLICATION_STATUSES.includes(target),
        `${status} -> ${target} names a status that does not exist`
      );
    }
  }

  assert.equal(isApplicationStatus("Assessment"), false);
  assert.equal(isApplicationStatus("applied"), false);
  assert.equal(isApplicationStatus(null), false);
  // A prototype key must never satisfy the guard.
  assert.equal(isApplicationStatus("toString"), false);
});

test("the source vocabulary is exactly manual, gmail and system", () => {
  assert.deepEqual([...APPLICATION_STATUS_SOURCES], [
    "manual",
    "gmail",
    "system",
  ]);

  for (const source of APPLICATION_STATUS_SOURCES) {
    assert.equal(isApplicationStatusSource(source), true);
  }
  assert.equal(isApplicationStatusSource("ai"), false);
  assert.equal(isApplicationStatusSource(""), false);
  assert.equal(isApplicationStatusSource(undefined), false);
});

// ---------------------------------------------------------------------------
// The transition table
// ---------------------------------------------------------------------------

test("the three forward rules are exactly as specified", () => {
  assert.deepEqual([...allowedNextStatuses("Applied")], [
    "Interview",
    "Offer",
    "Rejected",
    "Ghosted",
  ]);
  assert.deepEqual([...allowedNextStatuses("Interview")], [
    "Offer",
    "Rejected",
    "Ghosted",
  ]);
  assert.deepEqual([...allowedNextStatuses("Offer")], ["Rejected"]);

  // Terminal states.
  assert.deepEqual([...allowedNextStatuses("Rejected")], []);
  assert.deepEqual([...allowedNextStatuses("Ghosted")], []);
});

test("a status is never a forward transition to itself", () => {
  for (const status of APPLICATION_STATUSES) {
    assert.equal(isForwardTransition(status, status), false);
    assert.equal(classifyTransition(status, status), "no_op");
  }
});

test("every pair is classified, and only forward pairs are allowed", () => {
  const forward = new Set(forwardTransitionPairs());

  for (const from of APPLICATION_STATUSES) {
    for (const to of APPLICATION_STATUSES) {
      const outcome = classifyTransition(from, to);

      if (from === to) {
        assert.equal(outcome, "no_op");
        continue;
      }

      assert.equal(
        outcome,
        forward.has(`${from}|${to}`) ? "allowed" : "requires_correction",
        `${from} -> ${to} was classified ${outcome}`
      );
    }
  }
});

test("backward and sideways moves require the correction path", () => {
  const refused: [string, string][] = [
    ["Interview", "Applied"],
    ["Offer", "Interview"],
    ["Offer", "Applied"],
    ["Offer", "Ghosted"],
    ["Rejected", "Applied"],
    ["Rejected", "Interview"],
    ["Rejected", "Offer"],
    ["Ghosted", "Applied"],
    ["Ghosted", "Interview"],
  ];

  for (const [from, to] of refused) {
    assert.ok(isApplicationStatus(from) && isApplicationStatus(to));
    assert.equal(
      classifyTransition(from, to),
      "requires_correction",
      `${from} -> ${to} must not be a forward transition`
    );
  }
});

test("a refusal is explained in plain language, with no SQL in it", () => {
  const message = describeRefusedTransition("Rejected", "Interview");

  assert.match(message, /Rejected/);
  assert.match(message, /Interview/);
  assert.equal(/SELECT|UPDATE|INSERT|constraint|ERRCODE/i.test(message), false);

  // A state with somewhere to go names where.
  assert.match(describeRefusedTransition("Offer", "Applied"), /Rejected/);
});

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

test("a note is trimmed, bounded, and absent in exactly one form", () => {
  assert.equal(normalizeStatusNote(undefined), null);
  assert.equal(normalizeStatusNote(null), null);
  assert.equal(normalizeStatusNote("   "), null);
  assert.equal(normalizeStatusNote("  fixed a typo "), "fixed a typo");
  assert.equal(
    normalizeStatusNote("x".repeat(STATUS_NOTE_MAX_LENGTH + 50))?.length,
    STATUS_NOTE_MAX_LENGTH
  );
  // The correction note is a fixed constant, so corrections stay identifiable.
  assert.equal(normalizeStatusNote(STATUS_CORRECTION_NOTE), STATUS_CORRECTION_NOTE);
});

// ---------------------------------------------------------------------------
// SQL / TypeScript agreement — the anti-drift test
// ---------------------------------------------------------------------------

test("the SQL function allows exactly the TypeScript forward transitions", () => {
  const sql = migrationSql();

  const block = sql.match(
    /-- BEGIN ALLOWED TRANSITIONS[^\n]*\n([\s\S]*?)-- END ALLOWED TRANSITIONS/
  );
  assert.ok(block, "the migration must delimit its allowed-transition list");

  const pairs: string[] = [];
  const pattern = /\(\s*'([A-Za-z]+)'\s*,\s*'([A-Za-z]+)'\s*\)/g;
  let match: RegExpExecArray | null = pattern.exec(block[1]);
  while (match !== null) {
    pairs.push(`${match[1]}|${match[2]}`);
    match = pattern.exec(block[1]);
  }

  assert.ok(pairs.length > 0, "the SQL list should contain transition pairs");
  // No duplicate rows in the SQL list, so the comparison below is exact.
  assert.equal(new Set(pairs).size, pairs.length);

  assert.deepEqual(
    pairs.sort(),
    forwardTransitionPairs(),
    "the SQL transition table and FORWARD_TRANSITIONS have drifted apart"
  );
});

test("the migration constrains both status columns to the same five statuses", () => {
  const sql = migrationSql();

  for (const column of ["from_status", "to_status"]) {
    const constraint = sql.match(
      new RegExp(`${column}[\\s\\S]{0,120}?IN \\(([^)]*)\\)`)
    );
    assert.ok(constraint, `${column} must carry a CHECK constraint`);

    const values = [...constraint[1].matchAll(/'([A-Za-z]+)'/g)].map(
      (found) => found[1]
    );
    assert.deepEqual(
      values.sort(),
      [...APPLICATION_STATUSES].sort(),
      `${column} does not use the five allowed statuses`
    );
  }
});

test("the migration constrains source to the three allowed sources", () => {
  const sql = migrationSql();

  const constraint = sql.match(/source TEXT NOT NULL[\s\S]{0,80}?IN \(([^)]*)\)/);
  assert.ok(constraint, "source must carry a CHECK constraint");

  const values = [...constraint[1].matchAll(/'([a-z]+)'/g)].map(
    (found) => found[1]
  );
  assert.deepEqual(values.sort(), [...APPLICATION_STATUS_SOURCES].sort());
});

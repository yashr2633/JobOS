/**
 * Evidence Gate integration tests.
 *
 * Two properties of the gmail-application-precision design meet here because
 * they are two halves of the same claim: that the gate is the only authority in
 * the funnel. Property 6 pins the heuristic layer to a pure mapping of the gate
 * verdict; Property 7 pins the sync pipeline's classification step to a
 * partition of the batch in which only genuine ambiguity reaches the model.
 *
 * Both surfaces are pure, so nothing here touches Gmail, Supabase, or the AI
 * gateway. `classifyParsedEmails` is imported from `sync.ts`, where it is the
 * extracted step 4 of the funnel.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";

import { classifyParsedEmails } from "./sync.ts";
import { evaluateApplicationEvidence } from "./applicationEvidence.ts";
import { evaluateEmail, isAtsDomain } from "./heuristics.ts";
import type { ParsedEmail } from "./parse.ts";

const FIXED_DATE = "2026-06-15T12:00:00.000Z";
const CONNECTION_ID = "conn-1";

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
// Corpus — one representative per band of the funnel, plus the skipped case
// ===========================================================================

/**
 * `skipped` models a message whose metadata fetch failed and was dropped by the
 * fetch phase: the batch array carries a null in its place. It has no message
 * id, so it must appear in neither output set.
 */
type Kind =
  | "excluded"
  | "excluded_label"
  | "lifecycle"
  | "ats_weak"
  | "url_weak"
  | "keyword_only"
  | "empty"
  | "skipped";

const KINDS: readonly Kind[] = [
  "excluded",
  "excluded_label",
  "lifecycle",
  "ats_weak",
  "url_weak",
  "keyword_only",
  "empty",
  "skipped",
];

const EXCLUDED_SUBJECTS: readonly string[] = [
  "10 new jobs for you this week",
  "Priya Sharma wants to connect",
  "Your personal loan application has been received",
  "Join our free webinar on system design",
  "Acme Corp is hiring for multiple teams",
];

const LIFECYCLE_SUBJECTS: readonly string[] = [
  "Thank you for applying to Acme Corp",
  "We have received your application",
  "Invitation to interview for Backend Engineer",
  "We regret to inform you that your application was unsuccessful",
  "We are pleased to offer you the Backend Engineer position",
  "Your upcoming interview is on Friday",
];

const KEYWORD_ONLY_SUBJECTS: readonly string[] = [
  "Notes on the role",
  "The hiring process explained",
  "Candidate handbook attached",
];

/** Deterministic fixture per (kind, index) so ids stay unique across a batch. */
function buildEmail(kind: Kind, index: number): ParsedEmail | null {
  if (kind === "skipped") return null;

  const base = { gmailMessageId: `m${index}`, gmailThreadId: `t${index}` };

  switch (kind) {
    case "excluded":
      return email({
        ...base,
        subject: EXCLUDED_SUBJECTS[index % EXCLUDED_SUBJECTS.length],
        senderDomain: "linkedin.com",
        senderRootDomain: "linkedin.com",
        hasUnsubscribe: true,
      });

    case "excluded_label":
      return email({
        ...base,
        // A lifecycle phrase under a promotions label is still excluded.
        subject: LIFECYCLE_SUBJECTS[index % LIFECYCLE_SUBJECTS.length],
        labelIds: ["CATEGORY_PROMOTIONS"],
      });

    case "lifecycle":
      return email({
        ...base,
        subject: LIFECYCLE_SUBJECTS[index % LIFECYCLE_SUBJECTS.length],
        senderDomain: "greenhouse.io",
        senderRootDomain: "greenhouse.io",
      });

    case "ats_weak":
      // ATS sender plus candidate-facing language: only the model can decide.
      return email({
        ...base,
        subject: "Regarding your application",
        senderDomain: "greenhouse.io",
        senderRootDomain: "greenhouse.io",
      });

    case "url_weak":
      return email({
        ...base,
        subject: "An update from Acme",
        senderDomain: "acme.com",
        senderRootDomain: "acme.com",
        jobUrl: "https://boards.greenhouse.io/acme/jobs/12345",
      });

    case "keyword_only":
      return email({
        ...base,
        subject: KEYWORD_ONLY_SUBJECTS[index % KEYWORD_ONLY_SUBJECTS.length],
      });

    case "empty":
      return email(base);
  }
}

// ===========================================================================
// Property 7
// ===========================================================================

// Feature: gmail-application-precision, Property 7: Every scanned message is
// accounted for exactly once, and only ambiguity reaches the model
test("Property 7: every scanned message is accounted for exactly once, and only ambiguity reaches the model", () => {
  fc.assert(
    fc.property(
      fc.array(fc.constantFrom(...KINDS), { maxLength: 14 }),
      (kinds) => {
        const batch = kinds.map((kind, index) => buildEmail(kind, index));
        const parsed = batch.filter((entry): entry is ParsedEmail => entry !== null);

        const { records, ambiguous, candidates } = classifyParsedEmails(
          batch,
          CONNECTION_ID
        );

        const recordIds = records.map((record) => record.gmailMessageId);
        const ambiguousIds = ambiguous.map((entry) => entry.gmailMessageId);

        // --- exactly once: the two sets are a partition of the batch --------
        assert.equal(
          recordIds.length + ambiguousIds.length,
          parsed.length,
          "every parsed message must land in exactly one output set"
        );
        assert.equal(
          new Set([...recordIds, ...ambiguousIds]).size,
          parsed.length,
          "no message id may appear twice, and none may go missing"
        );
        assert.deepEqual(
          [...new Set([...recordIds, ...ambiguousIds])].sort(),
          parsed.map((entry) => entry.gmailMessageId).sort()
        );
        for (const id of ambiguousIds) {
          assert.equal(
            recordIds.includes(id),
            false,
            "a message queued for the model must not also be stored yet"
          );
        }

        // --- only ambiguity reaches the model ------------------------------
        const expectedAmbiguous = parsed
          .filter((entry) => evaluateEmail(entry).needsAI)
          .map((entry) => entry.gmailMessageId);
        assert.deepEqual(ambiguousIds.sort(), expectedAmbiguous.sort());

        // --- every gate rejection is ledgered as a non-application row -----
        for (const entry of parsed) {
          const gate = evaluateApplicationEvidence(entry);
          if (gate.strength !== "none") continue;

          const rejected = records.filter(
            (record) => record.gmailMessageId === entry.gmailMessageId
          );
          assert.equal(rejected.length, 1, "a rejection is recorded exactly once");
          // A job ALERT is ledgered as JOB_OPPORTUNITY (FIX 2); every other
          // rejection stays NOT_JOB_RELATED. Both are non-application, non-
          // candidate rows with no company and no inferred status.
          const expected =
            gate.reason === "excluded_job_alert"
              ? "JOB_OPPORTUNITY"
              : "NOT_JOB_RELATED";
          assert.equal(rejected[0].category, expected);
          assert.equal(rejected[0].inferredStatus, null);
          assert.equal(rejected[0].company, null);
        }

        // A NOT_JOB_RELATED or JOB_OPPORTUNITY row implies the gate rejected the
        // message (strength none); an accepted message is never stored under
        // either, so the ledger can still be grouped without re-running the gate.
        for (const record of records) {
          const source = parsed.find(
            (entry) => entry.gmailMessageId === record.gmailMessageId
          );
          assert.ok(source, "every record traces back to a parsed message");
          const strength = evaluateApplicationEvidence(source).strength;
          if (
            record.category === "NOT_JOB_RELATED" ||
            record.category === "JOB_OPPORTUNITY"
          ) {
            assert.equal(
              strength,
              "none",
              "only gate rejections may be stored as a non-application category"
            );
          }
          assert.equal(record.connectionId, CONNECTION_ID);
        }

        // The candidate count reported to the sync job counts accepted mail
        // once, whether it was resolved deterministically or sent to the model.
        assert.equal(
          candidates,
          parsed.filter((entry) => evaluateEmail(entry).candidate).length
        );
      }
    ),
    { numRuns: 100 }
  );
});

test("an all-rejected batch costs no model call and still ledgers every message", () => {
  const batch = EXCLUDED_SUBJECTS.map((subject, index) =>
    email({ gmailMessageId: `m${index}`, subject })
  );

  const { records, ambiguous, candidates } = classifyParsedEmails(batch, CONNECTION_ID);

  assert.equal(ambiguous.length, 0);
  assert.equal(candidates, 0);
  assert.equal(records.length, batch.length);
  for (const record of records) {
    // Every excluded message is ledgered as a non-application rejection with a
    // null strength. Job ALERTS land in JOB_OPPORTUNITY (FIX 2); everything else
    // stays NOT_JOB_RELATED. Neither is a candidate and neither can auto-import.
    assert.ok(
      record.category === "NOT_JOB_RELATED" ||
        record.category === "JOB_OPPORTUNITY",
      `rejected message must be a non-application category, got ${record.category}`
    );
    assert.equal(record.evidenceStrength, null);
  }
});

test("a message dropped by the fetch phase is in neither output set", () => {
  const { records, ambiguous, candidates } = classifyParsedEmails(
    [null, null],
    CONNECTION_ID
  );

  assert.deepEqual(records, []);
  assert.deepEqual(ambiguous, []);
  assert.equal(candidates, 0);
});

// ===========================================================================
// Property 6
// ===========================================================================

/** Every phrase band the gate can land in, so all three strengths are sampled. */
const SUBJECT_FRAGMENTS: readonly string[] = [
  ...EXCLUDED_SUBJECTS,
  ...LIFECYCLE_SUBJECTS,
  ...KEYWORD_ONLY_SUBJECTS,
  "Regarding your application",
  "Your candidacy at Acme Corp",
  "An update from Acme",
  "",
];

const BODY_FRAGMENTS: readonly string[] = [
  "",
  "Regards, the team",
  "Application id 88213 is on file.",
  "We have received your application.",
  "Unsubscribe from these emails.",
];

const DOMAINS: readonly string[] = [
  "greenhouse.io",
  "lever.co",
  "linkedin.com",
  "naukri.com",
  "acme.com",
  "gmail.com",
  "hdfcbank.com",
];

const LABEL_SETS: readonly (readonly string[])[] = [
  [],
  ["INBOX", "UNREAD"],
  ["CATEGORY_PROMOTIONS"],
  ["SPAM"],
];

const JOB_URLS: readonly (string | null)[] = [
  null,
  "https://boards.greenhouse.io/acme/jobs/12345",
];

// Feature: gmail-application-precision, Property 6: The heuristic verdict is a
// pure function of the gate verdict
test("Property 6: the heuristic verdict is a pure function of the gate verdict", () => {
  // Functional dependency, accumulated across every generated input: the same
  // gate verdict must always yield the same heuristic verdict, no matter which
  // sender domain, label set, keyword, or job URL produced it. Any field
  // derived from an independent sender-domain or keyword rule would show up
  // here as two different heuristic verdicts under one gate verdict.
  const observed = new Map<string, string>();

  fc.assert(
    fc.property(
      fc.constantFrom(...SUBJECT_FRAGMENTS),
      fc.constantFrom(...SUBJECT_FRAGMENTS),
      fc.constantFrom(...BODY_FRAGMENTS),
      fc.constantFrom(...DOMAINS),
      fc.constantFrom(...LABEL_SETS),
      fc.constantFrom(...JOB_URLS),
      (subject, snippet, bodyText, domain, labelIds, jobUrl) => {
        const fixture = email({
          subject,
          snippet,
          bodyText,
          senderDomain: domain,
          senderRootDomain: domain,
          labelIds: [...labelIds],
          jobUrl,
        });

        const evidence = evaluateApplicationEvidence(fixture);
        const verdict = evaluateEmail(fixture);

        switch (evidence.strength) {
          case "none":
            // Requirement 3.4.
            assert.equal(verdict.candidate, false);
            assert.equal(verdict.needsAI, false);
            assert.equal(verdict.category, "NOT_JOB_RELATED");
            assert.equal(
              verdict.reason,
              evidence.reason.startsWith("excluded_")
                ? "bulk_or_marketing"
                : "no_job_signal"
            );
            break;

          case "strong":
            // Requirement 3.5.
            assert.equal(verdict.candidate, true);
            assert.equal(verdict.needsAI, false);
            assert.equal(verdict.category, evidence.category);
            assert.equal(verdict.reason, "pattern_match");
            break;

          case "weak":
            // Requirement 3.6.
            assert.equal(verdict.candidate, true);
            assert.equal(verdict.needsAI, true);
            assert.equal(verdict.category, null);
            assert.equal(
              verdict.reason,
              evidence.reason === "ats_sender_with_candidate_language"
                ? "ats_sender_ambiguous"
                : "job_url"
            );
            break;
        }

        // Confidence is carried through, never recomputed.
        assert.equal(verdict.confidence, evidence.confidence);

        // Requirement 3.3: the verdict is a function of the gate verdict alone.
        const key = JSON.stringify(evidence);
        const value = JSON.stringify(verdict);
        const previous = observed.get(key);
        if (previous === undefined) {
          observed.set(key, value);
        } else {
          assert.equal(
            value,
            previous,
            `two heuristic verdicts for one gate verdict ${key}`
          );
        }
      }
    ),
    { numRuns: 100 }
  );
});

test("an ATS sender alone no longer buys a model call", () => {
  // The deleted `fromAts` escalation, pinned as behaviour: identical subject,
  // employer domain versus ATS domain, identical verdict.
  const subject = "An update from Acme";

  const fromEmployer = evaluateEmail(
    email({ subject, senderDomain: "acme.com", senderRootDomain: "acme.com" })
  );
  const fromAts = evaluateEmail(
    email({ subject, senderDomain: "greenhouse.io", senderRootDomain: "greenhouse.io" })
  );

  assert.deepEqual(fromAts, fromEmployer);
  assert.equal(fromAts.candidate, false);
  assert.equal(fromAts.needsAI, false);
  assert.equal(fromAts.category, "NOT_JOB_RELATED");
});

test("a bare listed keyword no longer escalates, whoever sent it", () => {
  for (const domain of DOMAINS) {
    for (const subject of KEYWORD_ONLY_SUBJECTS) {
      const verdict = evaluateEmail(
        email({ subject, senderDomain: domain, senderRootDomain: domain })
      );
      assert.equal(verdict.candidate, false, `${subject} from ${domain} escalated`);
      assert.equal(verdict.needsAI, false);
      assert.equal(verdict.reason, "no_job_signal");
    }
  }
});

// ===========================================================================
// Structural: the two deleted escalation rules cannot come back
// ===========================================================================

/**
 * Strip comments so the assertions below read code, not prose. The module
 * documents the deleted keyword regex verbatim in its header, which is exactly
 * the kind of text a naive source scan would mistake for a live rule.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const HEURISTICS_SOURCE = stripComments(
  readFileSync(join(process.cwd(), "src", "lib", "gmail", "heuristics.ts"), "utf8")
);

test("heuristics.ts holds no classification pattern of its own", () => {
  // No way to apply a regex means no way to reintroduce the keyword rule: the
  // gate is the only place patterns are allowed to live.
  for (const forbidden of [".test(", ".match(", ".exec(", "RegExp", "/\\b"]) {
    assert.equal(
      HEURISTICS_SOURCE.includes(forbidden),
      false,
      `heuristics.ts must not use ${forbidden} — patterns belong to the Evidence Gate`
    );
  }
});

test("the weakSignal keyword regex is gone", () => {
  assert.equal(/\bweakSignal\b/.test(HEURISTICS_SOURCE), false);
  // "candidate" survives as a verdict field name and a parameter, "candidacy"
  // only ever appeared inside the deleted alternation.
  assert.equal(/\bcandidacy\b/i.test(HEURISTICS_SOURCE), false);
  // The alternation itself, in any order: this is the shape of the deleted rule.
  // `RECRUITER_CONTACT` stays — it is a category in the shared vocabulary, not
  // a matching rule — so the assertion targets the alternation, not the words.
  assert.equal(/application\|applied/i.test(HEURISTICS_SOURCE), false);
  assert.equal(/\|hiring\|/i.test(HEURISTICS_SOURCE), false);
  assert.equal(/\|recruit/i.test(HEURISTICS_SOURCE), false);
});

test("the bare-ATS escalation is gone from evaluateEmail", () => {
  const body = HEURISTICS_SOURCE.match(/export function evaluateEmail\([\s\S]*?\n\}/);
  assert.ok(body, "evaluateEmail should still be exported from heuristics.ts");

  const source = body[0];

  // It reads the gate and nothing else.
  assert.ok(source.includes("evaluateApplicationEvidence"));
  assert.equal(/\bfromAts\b/.test(source), false);
  assert.equal(source.includes("isAtsDomain"), false);
  assert.equal(source.includes("ATS_DOMAIN_SET"), false);
  assert.equal(source.includes("hasUnsubscribe"), false);
  assert.equal(source.includes("jobUrl"), false);
});

test("isAtsDomain survives as a naming primitive with unchanged behaviour", () => {
  // Deleting the escalation must not delete the domain helper the company /
  // portal separation depends on.
  assert.equal(isAtsDomain("greenhouse.io"), true);
  assert.equal(isAtsDomain("acme.com"), false);
  assert.equal(isAtsDomain(null), false);
});

/**
 * Resume document model tests.
 *
 * The model is the boundary the export layer cannot cross: if every string it
 * produces came from the input text, then no exporter downstream can fabricate a
 * fact. That is asserted directly here, including under property-based input.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { assembleTailoredText, EMPTY_CONTACT, type TailoredResume } from "../ai/tailorResume.ts";
import {
  collectDocumentText,
  isResumeDocumentEmpty,
  isSectionHeading,
  parseResumeDocument,
  resumeFileStem,
} from "./documentModel.ts";

function tailored(overrides: Partial<TailoredResume> = {}): TailoredResume {
  return {
    summary: overrides.summary ?? "Backend engineer with five years on payment systems.",
    skills: overrides.skills ?? ["Go", "PostgreSQL", "Kafka"],
    experience: overrides.experience ?? [
      {
        title: "Senior Backend Engineer",
        detail: "Acme Payments",
        bullets: [
          "Cut settlement latency by 40% by batching ledger writes.",
          "Owned the reconciliation service handling 2M daily events.",
        ],
      },
    ],
    education: overrides.education ?? ["B.Tech Computer Science, NIT Trichy"],
    certifications: overrides.certifications ?? ["AWS Solutions Architect"],
    contact: EMPTY_CONTACT,
    projects: [],
    additionalSections: [],
    changes: overrides.changes ?? ["Moved payments experience to the top."],
  };
}

// ---------------------------------------------------------------------------
// A. Structure recovered from the assembled text
// ---------------------------------------------------------------------------

test("the assembled tailored text round-trips into structured sections", () => {
  const doc = parseResumeDocument(assembleTailoredText(tailored()));

  const headings = doc.sections.map((section) => section.heading);
  // CERTIFICATIONS is now its own section, separate from PROJECTS — the fixture
  // here carries certifications only, so PROJECTS is legitimately absent.
  assert.deepEqual(headings, [
    "SUMMARY",
    "SKILLS",
    "EXPERIENCE",
    "EDUCATION",
    "CERTIFICATIONS",
  ]);
});

test("experience bullets become a bullet block under an emphasized role line", () => {
  const doc = parseResumeDocument(assembleTailoredText(tailored()));
  const experience = doc.sections.find((s) => s.heading === "EXPERIENCE");

  assert.ok(experience, "EXPERIENCE section is present");

  const roleLine = experience!.blocks[0];
  assert.equal(roleLine.kind, "line");
  assert.equal(roleLine.kind === "line" && roleLine.emphasized, true);
  assert.match(
    roleLine.kind === "line" ? roleLine.text : "",
    /Senior Backend Engineer/
  );

  const bullets = experience!.blocks[1];
  assert.equal(bullets.kind, "bullets");
  assert.equal(bullets.kind === "bullets" ? bullets.items.length : 0, 2);
  // The "  • " prefix is structure, not content, so it is stripped.
  assert.equal(
    bullets.kind === "bullets" ? bullets.items[0] : "",
    "Cut settlement latency by 40% by batching ledger writes."
  );
});

test("a summary line is a plain paragraph, not an emphasized header", () => {
  const doc = parseResumeDocument(assembleTailoredText(tailored()));
  const summary = doc.sections.find((s) => s.heading === "SUMMARY");
  const block = summary!.blocks[0];

  assert.equal(block.kind, "line");
  assert.equal(block.kind === "line" && block.emphasized, false);
});

test("heading detection accepts conventional headings and rejects prose", () => {
  assert.equal(isSectionHeading("EXPERIENCE"), true);
  assert.equal(isSectionHeading("CERTIFICATIONS & PROJECTS"), true);
  assert.equal(isSectionHeading("Senior Backend Engineer"), false);
  assert.equal(isSectionHeading("• Did a thing"), false);
  assert.equal(isSectionHeading(""), false);
  assert.equal(isSectionHeading("2024"), false, "digits alone are not a heading");
  assert.equal(
    isSectionHeading("THIS ENTIRE SHOUTED SENTENCE IS FAR TOO LONG TO BE A SECTION HEADING"),
    false
  );
});

// ---------------------------------------------------------------------------
// B. The user's own header block is preserved, never invented
// ---------------------------------------------------------------------------

test("lines above the first heading are kept as the user's header block", () => {
  const doc = parseResumeDocument(
    ["Priya Sharma", "priya@example.com | +91 90000 00000", "", "SUMMARY", "Engineer."].join("\n")
  );

  assert.deepEqual(doc.headerLines, [
    "Priya Sharma",
    "priya@example.com | +91 90000 00000",
  ]);
  assert.equal(doc.sections.length, 1);
});

test("no header block is invented when the resume has none", () => {
  const doc = parseResumeDocument(assembleTailoredText(tailored()));
  assert.deepEqual(doc.headerLines, []);
});

// ---------------------------------------------------------------------------
// C. Edited content is what survives
// ---------------------------------------------------------------------------

test("edits to the draft are reflected in the parsed document", () => {
  const original = assembleTailoredText(tailored());
  const edited = original.replace(
    "Cut settlement latency by 40% by batching ledger writes.",
    "Reduced settlement latency substantially by batching ledger writes."
  );

  const text = collectDocumentText(parseResumeDocument(edited));

  assert.ok(
    text.some((line) => line.includes("Reduced settlement latency substantially")),
    "the edited wording is present"
  );
  assert.ok(
    !text.some((line) => line.includes("by 40%")),
    "the replaced wording is gone"
  );
});

test("a user-added section is parsed rather than dropped", () => {
  const edited = `${assembleTailoredText(tailored())}\n\nVOLUNTEERING\n  • Mentored two junior engineers.`;
  const doc = parseResumeDocument(edited);

  const volunteering = doc.sections.find((s) => s.heading === "VOLUNTEERING");
  assert.ok(volunteering, "the user's own section is kept");
  assert.deepEqual(
    volunteering!.blocks[0].kind === "bullets" ? volunteering!.blocks[0].items : [],
    ["Mentored two junior engineers."]
  );
});

// ---------------------------------------------------------------------------
// D. No fabrication — the anti-fabrication contract at the export boundary
// ---------------------------------------------------------------------------

test("every parsed string is a substring of the input text", () => {
  const source = assembleTailoredText(tailored());
  for (const fragment of collectDocumentText(parseResumeDocument(source))) {
    assert.ok(
      source.includes(fragment),
      `parsed fragment not present in source: ${fragment}`
    );
  }
});

test("Property: parsing never introduces text that was not in the input", () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.oneof(
          fc.constantFrom("SUMMARY", "SKILLS", "EXPERIENCE", "EDUCATION", ""),
          fc.string({ minLength: 1, maxLength: 40 }),
          fc.string({ minLength: 1, maxLength: 40 }).map((s) => `  • ${s}`)
        ),
        { maxLength: 40 }
      ),
      (lines) => {
        const input = lines.join("\n");
        for (const fragment of collectDocumentText(parseResumeDocument(input))) {
          // Every retained fragment is a trimmed substring of some input line.
          if (!input.includes(fragment)) return false;
        }
        return true;
      }
    ),
    { numRuns: 300 }
  );
});

test("Property: parsing is total and never throws", () => {
  fc.assert(
    fc.property(fc.string(), (input) => {
      parseResumeDocument(input);
      return true;
    }),
    { numRuns: 300 }
  );
});

test("no content line is silently discarded", () => {
  const input = ["SUMMARY", "One.", "Two.", "SKILLS", "Go"].join("\n");
  const text = collectDocumentText(parseResumeDocument(input));
  for (const expected of ["SUMMARY", "One.", "Two.", "SKILLS", "Go"]) {
    assert.ok(text.includes(expected), `${expected} survived parsing`);
  }
});

// ---------------------------------------------------------------------------
// E. Emptiness and filenames
// ---------------------------------------------------------------------------

test("blank and whitespace-only content is recognised as empty", () => {
  assert.equal(isResumeDocumentEmpty(parseResumeDocument("")), true);
  assert.equal(isResumeDocumentEmpty(parseResumeDocument("   \n\n  \t ")), true);
  assert.equal(isResumeDocumentEmpty(parseResumeDocument("SUMMARY\nEngineer.")), false);
});

test("the filename stem is slugified and cannot carry a path", () => {
  assert.equal(resumeFileStem("Acme Corp-Backend Engineer"), "tailored-resume-acme-corp-backend-engineer");
  assert.equal(resumeFileStem(""), "tailored-resume-job");
  assert.equal(resumeFileStem("../../etc/passwd"), "tailored-resume-etc-passwd");
  assert.doesNotMatch(resumeFileStem('a"b/c\\d'), /["/\\]/);
});

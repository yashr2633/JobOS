/**
 * Tailored-resume validation and assembly.
 *
 * The anti-fabrication guarantee lives in the SERVER PROMPT, which no unit test
 * can exercise without the model. What is testable here — and what these tests
 * pin — is that the validator accepts only well-formed structured content, that
 * an empty result is rejected (so the UI never shows a blank "tailored resume"),
 * and that assembly is a faithful, lossless-enough rendering of exactly the
 * validated content (so preview and the downloaded file are identical and carry
 * nothing the model did not return).
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  EMPTY_CONTACT,
  TAILORING_NOTE,
  assembleTailoredText,
  validateTailoredResume,
  verifyContactAgainstSource,
  type TailoredResume,
} from "./tailorResume.ts";

test("a well-formed tailored resume validates and normalizes", () => {
  const result = validateTailoredResume({
    summary: "  Backend engineer with 6 years in payments.  ",
    skills: ["Go", "  ", "PostgreSQL", 42],
    experience: [
      { title: "Senior Engineer", detail: "Acme", bullets: ["Led billing", "  "] },
      { title: "", detail: "", bullets: [] },
    ],
    education: ["BSc Computer Science"],
    certifications: [],
    contact: EMPTY_CONTACT,
    projects: [],
    additionalSections: [],
    changes: ["Moved payments experience to the top"],
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  // Trimmed and blank-stripped.
  assert.equal(result.value.summary, "Backend engineer with 6 years in payments.");
  assert.deepEqual(result.value.skills, ["Go", "PostgreSQL"]);
  // The empty experience entry is dropped; the real one keeps its non-blank bullet.
  assert.equal(result.value.experience.length, 1);
  assert.deepEqual(result.value.experience[0].bullets, ["Led billing"]);
});

test("a result with no usable content is rejected", () => {
  for (const empty of [
    {},
    { summary: "", skills: [], experience: [], education: [] },
    { summary: "   ", skills: ["  "], experience: [{ title: "", bullets: [] }] },
    null,
    "not an object",
    [],
  ]) {
    assert.equal(validateTailoredResume(empty).ok, false);
  }
});

test("assembly renders exactly the validated content, in section order", () => {
  const tailored: TailoredResume = {
    summary: "Backend engineer.",
    skills: ["Go", "PostgreSQL"],
    experience: [
      { title: "Senior Engineer", detail: "Acme", bullets: ["Led billing", "Cut latency"] },
      { title: "Engineer", detail: "", bullets: ["Built API"] },
    ],
    education: ["BSc Computer Science"],
    certifications: ["AWS SAA"],
    contact: EMPTY_CONTACT,
    projects: [],
    additionalSections: [],
    changes: ["Reordered"],
  };

  const text = assembleTailoredText(tailored);

  assert.match(text, /SUMMARY\nBackend engineer\./);
  assert.match(text, /SKILLS\nGo · PostgreSQL/);
  // Role with employer shows "title — detail"; without it, just the title.
  assert.match(text, /Senior Engineer — Acme/);
  assert.match(text, /^Engineer$/m);
  assert.match(text, / {2}• Led billing/);
  assert.match(text, /EDUCATION\nBSc Computer Science/);
  // Certifications and projects are now separate sections: a resume carrying
  // both previously lost the distinction under one combined heading.
  assert.match(text, /CERTIFICATIONS\nAWS SAA/);

  // "changes" is guidance for the UI, never part of the downloadable document.
  assert.equal(text.includes("Reordered"), false);
});

test("assembly omits empty sections and never fabricates", () => {
  const minimal: TailoredResume = {
    summary: "",
    skills: ["Go"],
    experience: [],
    education: [],
    certifications: [],
    contact: EMPTY_CONTACT,
    projects: [],
    additionalSections: [],
    changes: [],
  };

  const text = assembleTailoredText(minimal);
  assert.match(text, /SKILLS\nGo/);
  assert.equal(text.includes("SUMMARY"), false);
  assert.equal(text.includes("EXPERIENCE"), false);
  assert.equal(text.includes("EDUCATION"), false);
  // Nothing beyond what was supplied — no placeholder text.
  assert.equal(text.trim(), "SKILLS\nGo");
});

test("the truthfulness note is fixed and mentions no fabrication", () => {
  assert.match(TAILORING_NOTE, /only information already present/i);
});

// ---------------------------------------------------------------------------
// Completeness: identity and every section must survive tailoring
//
// These pin a real data-loss defect. The tailored resume previously had NO
// identity fields, so a name, email, phone and links present in the source were
// silently dropped and the exported document opened straight into "SUMMARY".
// ---------------------------------------------------------------------------

const FULL_CONTACT = {
  fullName: "Priya Sharma",
  email: "priya@example.com",
  phone: "+91 90000 00000",
  location: "Bengaluru, India",
  linkedin: "linkedin.com/in/priyasharma",
  github: "github.com/priyasharma",
  links: ["priya.dev"],
};

function completeResume(): TailoredResume {
  return {
    contact: FULL_CONTACT,
    summary: "Backend engineer with five years on payment systems.",
    skills: ["Go", "PostgreSQL"],
    experience: [
      { title: "Senior Backend Engineer", detail: "Acme", bullets: ["Cut latency 40%."] },
    ],
    education: ["B.Tech Computer Science, NIT Trichy"],
    certifications: ["AWS Solutions Architect"],
    projects: ["Ledger reconciliation service"],
    additionalSections: [
      { heading: "INTERESTS", lines: ["Competitive chess", "Trail running"] },
    ],
    changes: ["Surfaced payments work first."],
  };
}

test("the identity header is emitted above every section heading", () => {
  const text = assembleTailoredText(completeResume());
  const lines = text.split("\n");

  assert.equal(lines[0], "Priya Sharma", "the name is the first line");
  assert.ok(
    lines[1].includes("priya@example.com") &&
      lines[1].includes("+91 90000 00000") &&
      lines[1].includes("Bengaluru, India"),
    "email, phone and location share one contact row"
  );
  assert.ok(
    lines[2].includes("linkedin.com/in/priyasharma") &&
      lines[2].includes("github.com/priyasharma") &&
      lines[2].includes("priya.dev"),
    "links share the next row"
  );

  // The header must precede the first section heading, or the document parser
  // would treat it as body text rather than the header block.
  assert.ok(
    text.indexOf("Priya Sharma") < text.indexOf("SUMMARY"),
    "identity comes before SUMMARY"
  );
});

test("every section the resume carries survives assembly", () => {
  const text = assembleTailoredText(completeResume());

  for (const expected of [
    "SUMMARY",
    "SKILLS",
    "EXPERIENCE",
    "EDUCATION",
    "CERTIFICATIONS",
    "PROJECTS",
    "INTERESTS",
  ]) {
    assert.ok(text.includes(expected), `${expected} survived tailoring`);
  }

  // And their content, not just the headings.
  assert.ok(text.includes("B.Tech Computer Science, NIT Trichy"));
  assert.ok(text.includes("AWS Solutions Architect"));
  assert.ok(text.includes("Ledger reconciliation service"));
  assert.ok(text.includes("Competitive chess"));
});

test("projects are a separate section from certifications", () => {
  const text = assembleTailoredText(completeResume());
  assert.ok(text.includes("CERTIFICATIONS\n"), "certifications stand alone");
  assert.ok(text.includes("PROJECTS\n"), "projects stand alone");
  // The old combined heading must be gone, or the two are conflated again.
  assert.ok(!text.includes("CERTIFICATIONS & PROJECTS"));
});

test("an absent contact field contributes nothing — no placeholder", () => {
  const resume = completeResume();
  resume.contact = {
    ...EMPTY_CONTACT,
    fullName: "Priya Sharma",
    email: "priya@example.com",
  };

  const text = assembleTailoredText(resume);

  assert.ok(text.includes("priya@example.com"));
  // No invented phone, location, or handle, and no filler text for them.
  for (const forbidden of ["N/A", "Not specified", "Unknown", "undefined", "null"]) {
    assert.ok(!text.includes(forbidden), `no ${forbidden} placeholder`);
  }
  // The contact row must not end up with dangling separators.
  assert.ok(!text.includes("| |"));
  assert.doesNotMatch(text.split("\n")[1] ?? "", /\|\s*$/);
});

test("a resume with no identity at all emits no header", () => {
  const resume = completeResume();
  resume.contact = { ...EMPTY_CONTACT };

  const text = assembleTailoredText(resume);
  assert.ok(text.startsWith("SUMMARY"), "the document begins at the first section");
});

test("the validator fills a missing contact block rather than failing", () => {
  const result = validateTailoredResume({
    summary: "Engineer.",
    skills: ["Go"],
    experience: [],
    education: [],
    certifications: [],
    changes: [],
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value.contact, { ...EMPTY_CONTACT, links: [] });
    assert.deepEqual(result.value.projects, []);
    assert.deepEqual(result.value.additionalSections, []);
  }
});

test("the validator reads a full contact block and the new sections", () => {
  const result = validateTailoredResume({
    contact: FULL_CONTACT,
    summary: "Engineer.",
    skills: [],
    experience: [],
    education: ["B.Tech"],
    certifications: [],
    projects: ["Thing one"],
    additionalSections: [{ heading: "LANGUAGES", lines: ["English", "Hindi"] }],
    changes: [],
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.contact.email, "priya@example.com");
    assert.deepEqual(result.value.projects, ["Thing one"]);
    assert.equal(result.value.additionalSections[0].heading, "LANGUAGES");
  }
});

test("an additional section with no lines is dropped, not rendered empty", () => {
  const result = validateTailoredResume({
    summary: "Engineer.",
    skills: [],
    experience: [],
    education: ["B.Tech"],
    certifications: [],
    additionalSections: [
      { heading: "INTERESTS", lines: [] },
      { heading: "", lines: ["orphan"] },
    ],
    changes: [],
  });

  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value.additionalSections, []);
});

// ---------------------------------------------------------------------------
// Contact details are verified against the source, deterministically
// ---------------------------------------------------------------------------

const SOURCE_RESUME = `Priya Sharma
priya@example.com | +91 90000 00000 | Bengaluru, India
linkedin.com/in/priyasharma

SUMMARY
Backend engineer.`;

test("contact details present in the source are kept", () => {
  const kept = verifyContactAgainstSource(FULL_CONTACT, SOURCE_RESUME);

  assert.equal(kept.fullName, "Priya Sharma");
  assert.equal(kept.email, "priya@example.com");
  assert.equal(kept.phone, "+91 90000 00000");
  assert.equal(kept.location, "Bengaluru, India");
  assert.equal(kept.linkedin, "linkedin.com/in/priyasharma");
});

test("a fabricated contact detail is dropped, not exported", () => {
  const kept = verifyContactAgainstSource(
    {
      ...FULL_CONTACT,
      // None of these appear in SOURCE_RESUME.
      email: "totally.made.up@evil.example",
      github: "github.com/not-real",
      links: ["invented.example"],
    },
    SOURCE_RESUME
  );

  assert.equal(kept.email, "", "a hallucinated email cannot reach the document");
  assert.equal(kept.github, "", "a hallucinated handle is dropped");
  assert.deepEqual(kept.links, [], "a hallucinated link is dropped");
  // Genuine values are unaffected by a neighbouring fabrication.
  assert.equal(kept.fullName, "Priya Sharma");
});

test("verification tolerates reflowed whitespace and case", () => {
  const kept = verifyContactAgainstSource(
    { ...EMPTY_CONTACT, fullName: "  priya   SHARMA " },
    SOURCE_RESUME
  );
  assert.equal(kept.fullName, "  priya   SHARMA ", "kept, matched case-insensitively");
});

test("an empty source resume yields an empty header, never a fabricated one", () => {
  const kept = verifyContactAgainstSource(FULL_CONTACT, "");
  assert.deepEqual(kept, { ...EMPTY_CONTACT, links: [] });
});

test("verified identity flows through to the assembled document", () => {
  const resume = completeResume();
  resume.contact = verifyContactAgainstSource(
    { ...FULL_CONTACT, email: "fake@nowhere.example" },
    SOURCE_RESUME
  );

  const text = assembleTailoredText(resume);
  assert.ok(text.includes("Priya Sharma"), "the real name is present");
  assert.ok(!text.includes("fake@nowhere.example"), "the fabricated email is absent");
});

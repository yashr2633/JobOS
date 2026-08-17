/**
 * Export authorization and non-duplication tests.
 *
 * Source-level assertions, in the same style as `lib/gmail/security.test.ts`:
 * they hold architectural guarantees that a unit test on a pure function cannot
 * express, and they fail loudly if a later edit removes a gate.
 *
 * What is guaranteed here:
 *  - the export route authenticates, then verifies the application is the acting
 *    user's, BEFORE it renders any document;
 *  - the export layer has no AI/model access, so it cannot fabricate content;
 *  - it persists nothing, so no second copy of the tailored resume is stored;
 *  - the existing tailoring engine and TXT export were not replaced;
 *  - no second resume, application, or scoring model was introduced.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

const EXPORT_ROUTE = "src/app/api/resumes/export/route.ts";
const DOCX_RENDERER = "src/lib/resume/docx.ts";
const PDF_RENDERER = "src/lib/resume/pdf.ts";
const DOCUMENT_MODEL = "src/lib/resume/documentModel.ts";
const TAILOR_ENGINE = "src/lib/ai/tailorResume.ts";
const TAILOR_ROUTE = "src/app/api/intelligence/tailor/route.ts";
const TAILOR_PANEL = "src/app/resume-match/components/TailorResumePanel.tsx";

// ---------------------------------------------------------------------------
// F. Authorization / ownership
// ---------------------------------------------------------------------------

test("the export route requires a session", () => {
  const source = read(EXPORT_ROUTE);
  assert.match(source, /supabase\.auth\.getUser\(\)/, "reads the session");
  assert.match(source, /if \(!user\) return err\("Unauthorized\.", 401\)/);
});

test("the export route verifies the application belongs to the acting user", () => {
  const source = read(EXPORT_ROUTE);
  // The existing user-scoped read; returning null means "not yours".
  assert.match(source, /getApplicationIntelligenceInput\(/);
  assert.match(source, /=== null\) return err\("Application not found\.", 404\)/);
});

test("authorization happens BEFORE any document is rendered", () => {
  const source = read(EXPORT_ROUTE);

  const authIndex = source.indexOf("supabase.auth.getUser()");
  const ownershipIndex = source.indexOf("getApplicationIntelligenceInput(");
  const docxIndex = source.indexOf("renderResumeDocx(document)");
  const pdfIndex = source.indexOf("renderResumePdf(document)");

  assert.ok(authIndex > 0, "the session read is present");
  assert.ok(ownershipIndex > authIndex, "ownership is checked after the session");
  assert.ok(docxIndex > ownershipIndex, "DOCX renders only after authorization");
  assert.ok(pdfIndex > ownershipIndex, "PDF renders only after authorization");
});

test("the export route bounds the untrusted content it accepts", () => {
  const source = read(EXPORT_ROUTE);
  assert.match(source, /MAX_CONTENT_LENGTH/, "content length is capped");
  assert.match(source, /content\.length > MAX_CONTENT_LENGTH/);
});

test("the download filename cannot be steered by user text", () => {
  // The stem is slugified in one shared place, which strips path characters.
  assert.match(read(EXPORT_ROUTE), /resumeFileStem\(/);
  assert.match(read(DOCUMENT_MODEL), /replace\(\/\[\^a-z0-9\]\+\/g, "-"\)/);
});

// ---------------------------------------------------------------------------
// E. The export layer cannot fabricate content
// ---------------------------------------------------------------------------

test("no export module imports an AI gateway, model, or prompt", () => {
  for (const path of [EXPORT_ROUTE, DOCX_RENDERER, PDF_RENDERER, DOCUMENT_MODEL]) {
    const source = read(path);
    assert.doesNotMatch(source, /from "@?[./\w]*ai\/gateway"/, `${path} has no gateway`);
    assert.doesNotMatch(source, /generateStructured/, `${path} calls no model`);
    assert.doesNotMatch(source, /openai|anthropic|SYSTEM_PROMPT/i, `${path} has no provider`);
  }
});

test("the renderers read no resume or job-description data", () => {
  for (const path of [DOCX_RENDERER, PDF_RENDERER, DOCUMENT_MODEL]) {
    const source = read(path);
    assert.doesNotMatch(source, /supabase/i, `${path} touches no database`);
    assert.doesNotMatch(source, /fetchResume|jobDescription/, `${path} reads no source data`);
  }
});

test("the export route persists nothing", () => {
  const source = read(EXPORT_ROUTE);
  assert.doesNotMatch(source, /\.insert\(/, "no insert");
  assert.doesNotMatch(source, /\.update\(/, "no update");
  assert.doesNotMatch(source, /\.upsert\(/, "no upsert");
  assert.doesNotMatch(source, /\.delete\(/, "no delete");
});

test("the export route renders the POSTED content, not a re-tailored resume", () => {
  const source = read(EXPORT_ROUTE);
  assert.match(source, /parseResumeDocument\(content\)/);
  // It never calls the tailoring endpoint or engine.
  assert.doesNotMatch(source, /buildTailorResumePrompt|TAILOR_RESUME_SYSTEM/);
});

// ---------------------------------------------------------------------------
// G. Existing behavior preserved
// ---------------------------------------------------------------------------

test("the tailoring engine and its anti-fabrication contract are untouched", () => {
  const source = read(TAILOR_ENGINE);
  assert.match(source, /export const TAILORING_NOTE/);
  assert.match(source, /NEVER invent or add/);
  assert.match(source, /export function assembleTailoredText/);
  assert.match(source, /export function validateTailoredResume/);
});

test("the tailor route still returns the server-authored guarantee", () => {
  const source = read(TAILOR_ROUTE);
  assert.match(source, /note: TAILORING_NOTE/);
  assert.match(source, /validate: validateTailoredResume/);
});

test("there is exactly one tailoring prompt in the codebase", () => {
  // A second engine would mean a second system prompt.
  assert.match(read(TAILOR_ENGINE), /TAILOR_RESUME_SYSTEM/);
  for (const path of [DOCX_RENDERER, PDF_RENDERER, DOCUMENT_MODEL, EXPORT_ROUTE]) {
    assert.doesNotMatch(
      read(path),
      /TAILOR_RESUME_SYSTEM\s*=/,
      `${path} does not redefine the prompt`
    );
  }
});

test("the TXT export still works client-side and is unchanged in spirit", () => {
  const source = read(TAILOR_PANEL);
  assert.match(source, /text\/plain;charset=utf-8/, "TXT is still a plain blob");
  assert.match(source, /\$\{fileStem\}\.txt/);
  // TXT does not need the server.
  const txtBranch = source.slice(source.indexOf('if (format === "txt")'));
  assert.match(txtBranch.slice(0, 240), /saveBlob\(/);
});

test("every export format renders the same edited draft", () => {
  const source = read(TAILOR_PANEL);
  // TXT blob is built from `draft`; DOCX/PDF post `content: draft`.
  assert.match(source, /new Blob\(\[draft\]/);
  assert.match(source, /content: draft/);
  // The preview is derived from the same draft.
  assert.match(source, /parseResumeDocument\(draft\)/);
});

test("the panel exposes no control that could add a fact", () => {
  const source = read(TAILOR_PANEL);
  for (const forbidden of [/add skill/i, /addSkill/, /suggestSkill/, /missingSkill/]) {
    assert.doesNotMatch(source, forbidden);
  }
});

// ---------------------------------------------------------------------------
// No duplicated models
// ---------------------------------------------------------------------------

test("no second resume or application model was introduced", () => {
  for (const path of [DOCX_RENDERER, PDF_RENDERER, DOCUMENT_MODEL, EXPORT_ROUTE]) {
    const source = read(path);
    assert.doesNotMatch(
      source,
      /interface\s+(Resume|Application)\s*\{/,
      `${path} declares no competing model`
    );
    assert.doesNotMatch(source, /from\s+["'].*applications\/types["']/, `${path}`);
  }
});

test("no second scoring engine was introduced", () => {
  for (const path of [DOCX_RENDERER, PDF_RENDERER, DOCUMENT_MODEL, EXPORT_ROUTE]) {
    assert.doesNotMatch(read(path), /matchScore|scoreResume|computeMatch/i, path);
  }
});

test("the export layer touches nothing Gmail", () => {
  for (const path of [DOCX_RENDERER, PDF_RENDERER, DOCUMENT_MODEL, EXPORT_ROUTE]) {
    assert.doesNotMatch(read(path), /gmail/i, `${path} is unrelated to Gmail`);
  }
});

// ---------------------------------------------------------------------------
// I. Tailor is not gated behind Analyze, in the rendered component
// ---------------------------------------------------------------------------

test("the flow rules never let analysis gate tailoring", () => {
  const source = read("src/app/resume-match/flowState.ts");
  // canTailor is derived from `ready`, which is resume + JD only.
  assert.match(source, /const ready = hasResume && hasJobDescription/);
  assert.match(source, /const canTailor = ready/);
});

test("the tailor button is disabled only by a missing resume or an in-flight run", () => {
  const source = read(TAILOR_PANEL);
  assert.match(source, /const canTailor = resumeId !== null && status !== "tailoring"/);
  // `analysisReady` only selects styling, never `disabled`.
  assert.doesNotMatch(source, /disabled=\{[^}]*analysisReady/);
});

test("Resume Match passes analysis state as presentation only", () => {
  const source = read("src/app/resume-match/components/ResumeMatchContent.tsx");
  assert.match(source, /analysisReady=\{flow\.tailorIsNextStep\}/);
  // The panel is rendered whenever an application is selected — not conditioned
  // on an analysis existing.
  assert.doesNotMatch(source, /analysisReady && \(?\s*<TailorResumePanel/);
});

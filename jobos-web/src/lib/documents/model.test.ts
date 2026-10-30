import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractText } from "unpdf";
import { extractRawText } from "mammoth";
import { builderDocument, createLetterDraft, documentPath, emptyLetter, emptyResume, importResumeText, letterDocument, readWorkspaceDocument, relevantLetterFacts } from "./model.ts";
import { resumePlainText } from "../resume/templates.ts";
import { renderResumePdf } from "../resume/pdf.ts";
import { renderResumeDocx } from "../resume/docx.ts";

const a = "11111111-1111-4111-8111-111111111111", b = "22222222-2222-4222-8222-222222222222", id = "33333333-3333-4333-8333-333333333333";
test("draft paths cannot escape the authenticated user's private namespace", () => {
  assert.notEqual(documentPath(a, "resume", id), documentPath(b, "resume", id));
  assert.ok(documentPath(a, "letter", id).startsWith(`${a}/documents/letter/`));
  for (const bad of ["../" + id, `${b}/${id}`, "https://example.com", "", "__proto__"]) assert.throws(() => documentPath(a, "resume", bad));
});
test("document validation rejects malformed kinds, fields, templates and section identifiers", () => {
  const base = { version: 1, kind: "resume", label: "Test", formatting: {}, data: emptyResume() };
  assert.ok(readWorkspaceDocument(base));
  for (const value of [null, [], { ...base, kind: "other" }, { ...base, label: "" }, { ...base, formatting: { fontSize: 99 } }, { ...base, data: { ...base.data, sections: [{ id: "x", title: "Test", body: "a" }, { id: "x", title: "Other", body: "b" }] } }, { ...base, data: { ...base.data, contact: "x".repeat(1501) } }, { ...base, kind: "letter", data: { ...emptyLetter(), mode: ["general"] } }]) assert.equal(readWorkspaceDocument(value), null);
  assert.equal("userId" in readWorkspaceDocument({ ...base, userId: b })!, false);
});
test("builder text retains custom sections, bullets and contact information without placeholders", () => {
  const data = { ...emptyResume(), name: "Sample Candidate", contact: "sample@example.com", sections: [{ id: "work", title: "EXPERIENCE", body: "Analyst, Example Co\n- Maintained weekly SQL reports." }, { id: "custom", title: "VOLUNTEERING", body: "Supported community events." }] };
  const text = resumePlainText(builderDocument(data));
  for (const fact of ["Sample Candidate", "sample@example.com", "Analyst, Example Co", "Maintained weekly SQL reports.", "VOLUNTEERING", "Supported community events."]) assert.ok(text.includes(fact));
  assert.doesNotMatch(text, /YOUR NAME|95%|shortlist|selected/i);
});
test("resume import preserves unknown content and does not duplicate an unstructured source", () => {
  const text = "Sample Candidate\nsample@example.com\nEDUCATION\nBBA, Example College\nVOLUNTEERING\nSupported community events.";
  const imported = resumePlainText(builderDocument(importResumeText(text)));
  for (const fact of ["Sample Candidate", "sample@example.com", "BBA, Example College", "Supported community events."]) assert.ok(imported.includes(fact));
  const unstructured = "Sample Candidate\nSome work described without headings.";
  assert.equal(resumePlainText(builderDocument(importResumeText(unstructured))).split("Some work described without headings.").length, 2);
});
test("tailored letters rank supplied facts and never copy JD qualifications into candidate claims", () => {
  const data = { ...emptyLetter(), name: "Sample Candidate", role: "Analyst", company: "Example Co", mode: "tailored" as const, jobDescription: "Requires SQL reporting and five years of Java experience, MBA and AWS certification.", facts: "Supported a student event.\nBuilt a practice SQL reporting dashboard.\nBBA from Example College." };
  assert.equal(relevantLetterFacts(data.facts, data.jobDescription)[0], "Built a practice SQL reporting dashboard.");
  const letter = createLetterDraft(data);
  assert.match(letter, /Analyst position at Example Co/); assert.match(letter, /practice SQL reporting dashboard/);
  assert.doesNotMatch(letter, /five years|Java experience|MBA|AWS certification|selected|95%/);
  assert.equal(createLetterDraft({ ...data, mode: "general" }).includes("Analyst opportunities"), true);
});

test("uppercase resume names with a contact header seed a complete tailored letter", () => {
  const imported = importResumeText("AARAV TEST CANDIDATE\naarav@example.com | Kolkata\nlinkedin.com/in/example\nSUMMARY\nBBA graduate with SQL reporting practice.\nSKILLS\nSQL, Excel");
  assert.equal(imported.name, "AARAV TEST CANDIDATE");
  assert.match(imported.contact, /aarav@example.com/);
  assert.ok(!imported.sections.some(section => section.title === imported.name));
  const body = createLetterDraft({ ...emptyLetter(), name: imported.name, contact: imported.contact, facts: imported.sections.map(section => section.body).join("\n"), mode: "tailored", role: "Analyst", company: "Example Co", jobDescription: "SQL reporting, MBA preferred" });
  assert.match(body, /Analyst position at Example Co/);
  assert.match(body, /AARAV TEST CANDIDATE/);
  assert.doesNotMatch(body, /MBA/);
});

test("a section heading followed by contact text is not imported as a candidate name", () => {
  for (const heading of ["CONTACT INFORMATION", "PROFESSIONAL SUMMARY", "RESUME", "SKILLS"]) {
    assert.equal(importResumeText(`${heading}\nsample@example.com\nEDUCATION\nBBA, Example College`).name, "");
  }
});
test("Cover Letter exports retain the user's edited letter, facts and reading order", async () => {
  const data = { ...emptyLetter(), name: "Sample Candidate", contact: "sample@example.com", body: "Dear Hiring Team,\n\nI am applying for the Analyst role.\n\nI built a practice SQL dashboard.\n\nKind regards,\nSample Candidate" };
  const doc = letterDocument(data), format = { templateId: "minimal-original" };
  const pdf = await renderResumePdf(doc, format), docx = await renderResumeDocx(doc, format);
  const pdfText = String((await extractText(pdf, { mergePages: true })).text).replace(/\s+/g, " ");
  const docxText = (await extractRawText({ buffer: Buffer.from(docx) })).value.replace(/\s+/g, " ");
  for (const text of [pdfText, docxText]) { assert.ok(text.indexOf("Dear Hiring Team,") < text.indexOf("I am applying")); assert.match(text, /practice SQL dashboard/); assert.match(text, /sample@example.com/); }
});
test("document endpoints authenticate, enforce same-origin writes and do not accept a storage path", () => {
  const route = readFileSync("src/app/api/documents/route.ts", "utf8"), exporter = readFileSync("src/app/api/documents/export/route.ts", "utf8");
  for (const source of [route, exporter]) {
    assert.match(source, /auth\.getUser\(\)/); assert.match(source, /Invalid request origin/); assert.match(source, /private, no-store/);
    assert.ok(source.indexOf("if (!user)") < source.indexOf("await request.text()"));
    assert.doesNotMatch(source, /input\.userId|input\.path|service_role|SERVICE_ROLE/);
  }
  assert.match(route, /documentPath\(user\.id/); assert.doesNotMatch(route, /\.remove\(/);
});

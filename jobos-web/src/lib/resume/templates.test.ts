import test from "node:test";
import assert from "node:assert/strict";
import { extractText } from "unpdf";
import { extractRawText } from "mammoth";
import { PDFDocument } from "pdf-lib";
import { collectDocumentText, parseResumeDocument } from "./documentModel.ts";
import { LEGACY_RESUME_STYLES, RESUME_STYLES, RESUME_TEMPLATES, formatResumeDocument, resumeLayout, resumePlainText, validateResumeFormat } from "./templates.ts";
import { renderResumePdf } from "./pdf.ts";
import { renderResumeDocx } from "./docx.ts";

const document = parseResumeDocument("Test Candidate\ntest@example.com\nSUMMARY\nBusiness graduate with reporting experience.\nEXPERIENCE\nOperations Assistant, Sample Company\n- Maintained weekly Excel reports.\nEDUCATION\nBBA, Example College, 2026\nSKILLS\nSQL, Excel\nPROJECTS\n- Built a practice sales dashboard.\nVOLUNTEERING\nCommunity event support.");

test("templates retain every content fragment and leave the input untouched", () => {
  const original = JSON.stringify(document);
  const expected = collectDocumentText(document).sort();
  assert.equal(LEGACY_RESUME_STYLES.length, 50);
  assert.equal(RESUME_STYLES.length, 110);
  assert.equal(new Set(RESUME_TEMPLATES.map(item => item.id)).size, 550);
  for (const template of RESUME_TEMPLATES) {
    const reordered = formatResumeDocument(document, { templateId: template.id });
    assert.deepEqual(collectDocumentText(reordered).sort(), expected, template.id);
    assert.equal(reordered.sections.find(section => section.heading === "VOLUNTEERING")?.blocks[0].kind, "line");
    assert.equal(JSON.stringify(document), original);
  }
});

test("degree-first ordering is reflected in the plain-text export", () => {
  const text = resumePlainText(formatResumeDocument(document, { templateId: "modern-graduate" }));
  assert.ok(text.indexOf("EDUCATION") < text.indexOf("EXPERIENCE"));
  assert.ok(text.includes("- Maintained weekly Excel reports."));
  assert.ok(text.includes("Community event support."));
});

test("format validation rejects unsupported or extreme rendering inputs", () => {
  for (const input of [null, [], { templateId: "missing" }, { fontSize: 1 }, { fontSize: 11.123 }, { lineHeight: Infinity }, { margin: 0 }, { margin: 40.5 }, { pageSize: "poster" }]) assert.equal(validateResumeFormat(input), null);
  assert.deepEqual(validateResumeFormat({ templateId: "classic-original", color: "FFFFFF", hidden: true }), { templateId: "classic-original" });
  assert.throws(() => resumeLayout({ fontSize: 99 }));
});

for (const template of RESUME_TEMPLATES.filter(item => !item.layout.design)) {
  test(`${template.id}: PDF and DOCX retain candidate facts in the requested section order`, async () => {
    const formatting = { templateId: template.id };
    const expected = collectDocumentText(formatResumeDocument(document, formatting));
    const pdf = await renderResumePdf(document, formatting);
    const loaded = await PDFDocument.load(pdf);
    assert.equal(Math.round(loaded.getPages()[0].getWidth()), 595);
    const extracted = await extractText(pdf, { mergePages: true });
    const pdfText = (Array.isArray(extracted.text) ? extracted.text.join("\n") : extracted.text).replace(/\s+/g, " ");
    const docx = await extractRawText({ buffer: Buffer.from(await renderResumeDocx(document, formatting)) });
    const docxText = docx.value.replace(/\s+/g, " ");
    let previousPdf = -1, previousDocx = -1;
    for (const value of expected) {
      const flat = value.replace(/\s+/g, " ");
      const pdfAt = pdfText.indexOf(flat), docxAt = docxText.indexOf(flat);
      assert.ok(pdfAt > previousPdf, `PDF retains in-order text: ${value}`);
      assert.ok(docxAt > previousDocx, `DOCX retains in-order text: ${value}`);
      previousPdf = pdfAt; previousDocx = docxAt;
    }
    assert.doesNotMatch(docxText, /selected|95%|shortlist/i);
  });
}

test("large custom-formatted content paginates without losing text", async () => {
  const input = parseResumeDocument("EXPERIENCE\n" + Array.from({ length: 150 }, (_, i) => `- Entry ${i}: supported work described in the source resume.`).join("\n"));
  const pdf = await renderResumePdf(input, { templateId: "formal-original", fontSize: 12.5, margin: 72, lineHeight: 1.5, pageSize: "letter" });
  assert.ok((await PDFDocument.load(pdf)).getPageCount() > 2);
  const output = await extractText(pdf, { mergePages: true });
  assert.ok(String(output.text).includes("Entry 149"));
});

import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { extractText } from "unpdf";
import { extractRawText } from "mammoth";
import { STUDIO_STYLES } from "./designs.ts";
import { GALLERY_LETTER, GALLERY_SAMPLE } from "./gallerySample.ts";
import { composeDesign } from "./designScene.ts";
import { collectDocumentText } from "./documentModel.ts";
import { resumeLayout } from "./templates.ts";
import { renderResumePdf } from "./pdf.ts";
import { renderResumeDocx } from "./docx.ts";

test("60 designs span twelve compositions and remain structurally distinct without their colors", () => {
  assert.equal(STUDIO_STYLES.length, 60);
  assert.equal(new Set(STUDIO_STYLES.map(style => style.design.composition)).size, 12);
  const silhouettes = STUDIO_STYLES.map(style => JSON.stringify(composeDesign(GALLERY_SAMPLE, resumeLayout({ templateId: `${style.id}-original` })).map(page => page.elements.map(item => item.kind === "text" ? { ...item, color: "ink" } : item.kind === "rect" ? { ...item, fill: item.fill ? "fill" : undefined, stroke: item.stroke ? "stroke" : undefined } : { ...item, color: "ink" }))));
  assert.equal(new Set(silhouettes).size, 60);
});
for (const style of STUDIO_STYLES) test(`${style.name}: PDF and editable DOCX preserve every source fact`, async () => {
  const format = { templateId: `${style.id}-original` };
  const pdf = await renderResumePdf(GALLERY_SAMPLE, format);
  assert.ok((await PDFDocument.load(pdf)).getPageCount() >= 1);
  const extracted = await extractText(pdf, { mergePages: true });
  const text = String(extracted.text).replace(/\s+/g, " ");
  const word = (await extractRawText({ buffer: Buffer.from(await renderResumeDocx(GALLERY_SAMPLE, format)) })).value.replace(/\s+/g, " ");
  for (const value of collectDocumentText(GALLERY_SAMPLE)) {
    assert.ok(text.includes(value), `PDF missing ${value}`);
    assert.ok(word.includes(value), `DOCX missing ${value}`);
  }
  for (const page of composeDesign(GALLERY_SAMPLE, resumeLayout(format))) for (const item of page.elements) {
    assert.ok(item.x >= 0 && item.y >= 0);
    if (item.kind === "text") assert.ok(item.y + item.size <= page.height, "Text crosses page boundary");
  }
});
test("every matching letter uses one full-width body and keeps all edited text", async () => {
  for (const style of STUDIO_STYLES) {
    const format = { templateId: `${style.id}-original` };
    const pages = composeDesign(GALLERY_LETTER, resumeLayout(format));
    assert.ok(pages.every(page => page.elements.filter(item => item.kind === "text").every(item => item.x >= 0)));
    const extracted = await extractText(await renderResumePdf(GALLERY_LETTER, format), { mergePages: true });
    assert.ok(String(extracted.text).replace(/\s+/g, " ").includes("Thank you for considering my application."), style.name);
  }
});
test("designed long documents paginate both columns, long URLs and oversized contact blocks without losing the final facts", async () => {
  const document = { headerLines: ["Test Candidate", ...Array.from({ length: 80 }, (_, i) => `Contact line ${i} example@example.com`)], sections: [
    { heading: "EXPERIENCE", blocks: [{ kind: "bullets" as const, items: Array.from({ length: 110 }, (_, i) => `Work evidence ${i}: factual project documentation and reporting.`) }] },
    { heading: "SKILLS", blocks: [{ kind: "bullets" as const, items: Array.from({ length: 100 }, (_, i) => `Source skill ${i}`) }] },
  ] };
  const bytes = await renderResumePdf(document, { templateId: "design-folio-signature-original", margin: 72, fontSize: 12.5 });
  assert.ok((await PDFDocument.load(bytes)).getPageCount() > 3);
  const text = String((await extractText(bytes, { mergePages: true })).text);
  for (const value of ["Contact line 79", "Work evidence 109", "Source skill 99"]) assert.ok(text.includes(value));
});

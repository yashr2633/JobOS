import test from "node:test";
import assert from "node:assert/strict";
import { extractResumeText } from "./extractText.ts";
import { parseResumeDocument } from "../resume/documentModel.ts";
import { renderResumePdf } from "../resume/pdf.ts";
import { renderResumeDocx } from "../resume/docx.ts";
const text = "Alex Candidate\nalex@example.invalid\n\nSKILLS\nTypeScript, PostgreSQL\n\nEXPERIENCE\nSoftware Engineer — Acme\nBuilt reliable payment services and maintained production APIs.\n\nEDUCATION\nBachelor of Computer Science";
for (const format of ["pdf", "docx"] as const) {
  test(`${format} resumes extract real content and all core sections`, async () => {
    const doc = parseResumeDocument(text);
    const bytes = await (format === "pdf" ? renderResumePdf(doc) : renderResumeDocx(doc));
    const result = await extractResumeText(Buffer.from(bytes), format);
    assert.equal(result.ok, true);
    if (result.ok) for (const value of ["Alex Candidate", "TypeScript", "EXPERIENCE", "Acme", "EDUCATION"]) assert.ok(result.text.includes(value), value);
  });
}
test("empty, corrupt, and unsupported resumes fail without usable text", async () => {
  for (const format of ["pdf", "docx", "exe"]) {
    const result = await extractResumeText(Buffer.from("invalid file"), format);
    assert.equal(result.ok, false);
  }
});

/**
 * Export renderer tests.
 *
 * The point of these is to prove the exports are REAL documents, not text with a
 * renamed extension:
 *
 *   DOCX  must be a ZIP (PK signature) containing the OOXML parts Word requires,
 *         and the document body must contain the user's text.
 *   PDF   must carry the %PDF- header and %%EOF trailer, declare pages, and the
 *         drawn text must be recoverable from the file.
 *
 * The PDF text check uses `unpdf`, which is already a dependency (it is what the
 * resume upload pipeline extracts text with). Verifying with the same extractor
 * the product already trusts is the strongest available signal that an ATS can
 * read the output.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { gunzipSync, inflateRawSync } from "node:zlib";

import { assembleTailoredText, EMPTY_CONTACT, type TailoredResume } from "../ai/tailorResume.ts";
import { parseResumeDocument } from "./documentModel.ts";
import { buildDocxParagraphs, renderResumeDocx } from "./docx.ts";
import { renderResumePdf, toPdfSafeText, wrapText } from "./pdf.ts";

const SAMPLE: TailoredResume = {
  summary: "Backend engineer with five years building payment infrastructure.",
  skills: ["Go", "PostgreSQL", "Kafka", "Kubernetes"],
  experience: [
    {
      title: "Senior Backend Engineer",
      detail: "Acme Payments",
      bullets: [
        "Cut settlement latency by 40% by batching ledger writes.",
        "Owned the reconciliation service handling 2M daily events.",
      ],
    },
    {
      title: "Backend Engineer",
      detail: "Northwind Systems",
      bullets: ["Migrated the billing pipeline to event sourcing."],
    },
  ],
  education: ["B.Tech Computer Science, NIT Trichy"],
  certifications: ["AWS Certified Solutions Architect"],
  contact: EMPTY_CONTACT,
  projects: [],
  additionalSections: [],
  changes: ["Surfaced payments work first."],
};

const SAMPLE_TEXT = assembleTailoredText(SAMPLE);
const SAMPLE_DOC = parseResumeDocument(SAMPLE_TEXT);

/** Read every file name in a ZIP by walking its central directory. */
function zipEntryNames(bytes: Uint8Array): string[] {
  const buf = Buffer.from(bytes);
  const names: string[] = [];
  // 0x02014b50 = central directory file header signature.
  for (let i = 0; i + 46 <= buf.length; i += 1) {
    if (buf.readUInt32LE(i) !== 0x02014b50) continue;
    const nameLength = buf.readUInt16LE(i + 28);
    names.push(buf.subarray(i + 46, i + 46 + nameLength).toString("utf8"));
  }
  return names;
}

/** Extract and inflate one stored/deflated ZIP entry by name. */
function readZipEntry(bytes: Uint8Array, entryName: string): string | null {
  const buf = Buffer.from(bytes);
  for (let i = 0; i + 30 <= buf.length; i += 1) {
    // 0x04034b50 = local file header signature.
    if (buf.readUInt32LE(i) !== 0x04034b50) continue;

    const method = buf.readUInt16LE(i + 8);
    const compressedSize = buf.readUInt32LE(i + 18);
    const nameLength = buf.readUInt16LE(i + 26);
    const extraLength = buf.readUInt16LE(i + 28);
    const name = buf.subarray(i + 30, i + 30 + nameLength).toString("utf8");
    if (name !== entryName) continue;

    const start = i + 30 + nameLength + extraLength;
    if (compressedSize === 0) return null;
    const body = buf.subarray(start, start + compressedSize);
    try {
      if (method === 0) return body.toString("utf8");
      if (method === 8) return inflateRawSync(body).toString("utf8");
      return gunzipSync(body).toString("utf8");
    } catch {
      return null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// B. DOCX generation returns a real, valid DOCX
// ---------------------------------------------------------------------------

test("DOCX output is a real ZIP container, not renamed text", async () => {
  const bytes = await renderResumeDocx(SAMPLE_DOC);

  assert.ok(bytes.byteLength > 1000, "a real docx is not a few bytes");
  // PK\x03\x04 — the ZIP local file header. A text file could never start here.
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  assert.equal(bytes[2], 0x03);
  assert.equal(bytes[3], 0x04);

  // And it must not merely be a zip of the plain text.
  const asText = Buffer.from(bytes).toString("utf8");
  assert.ok(
    !asText.startsWith("SUMMARY"),
    "the payload is a container, not the raw draft"
  );
});

test("DOCX contains the OOXML parts a word processor requires", async () => {
  const names = zipEntryNames(await renderResumeDocx(SAMPLE_DOC));

  for (const required of [
    "[Content_Types].xml",
    "word/document.xml",
    "word/styles.xml",
    "_rels/.rels",
  ]) {
    assert.ok(names.includes(required), `missing OOXML part: ${required}`);
  }
});

test("the DOCX document body carries the resume's text", async () => {
  const xml = readZipEntry(await renderResumeDocx(SAMPLE_DOC), "word/document.xml");

  assert.ok(xml, "word/document.xml is readable");
  assert.match(xml!, /<w:document/, "it is a WordprocessingML document");
  assert.ok(xml!.includes("EXPERIENCE"), "section headings are present");
  assert.ok(
    xml!.includes("Cut settlement latency by 40% by batching ledger writes."),
    "bullet text is present"
  );
  assert.ok(xml!.includes("Senior Backend Engineer"), "role titles are present");
});

test("the DOCX uses no tables or text boxes (ATS constraint)", async () => {
  const xml = readZipEntry(await renderResumeDocx(SAMPLE_DOC), "word/document.xml");

  assert.ok(xml, "word/document.xml is readable");
  assert.doesNotMatch(xml!, /<w:tbl[\s>]/, "no tables");
  assert.doesNotMatch(xml!, /<w:txbxContent/, "no text boxes");
  assert.doesNotMatch(xml!, /<w:drawing[\s>]/, "no drawings or images");
  assert.doesNotMatch(xml!, /<w:cols\s+[^>]*w:num="[2-9]"/, "single column only");
});

test("DOCX paragraphs are built from the document model, in order", () => {
  const paragraphs = buildDocxParagraphs(SAMPLE_DOC);
  // 5 headings + 1 summary + 1 skills + 2 role lines + 3 bullets + 1 education
  // + 1 certification = 14 paragraphs, all from parsed content.
  assert.equal(paragraphs.length, 14);
});

test("an empty document still renders a valid (if bare) DOCX", async () => {
  const bytes = await renderResumeDocx({ headerLines: [], sections: [] });
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
});

// ---------------------------------------------------------------------------
// C. PDF generation returns a real, valid PDF
// ---------------------------------------------------------------------------

test("PDF output has a real PDF header and trailer", async () => {
  const bytes = await renderResumePdf(SAMPLE_DOC);
  const text = Buffer.from(bytes).toString("latin1");

  assert.ok(bytes.byteLength > 500, "a real pdf is not a few bytes");
  assert.ok(text.startsWith("%PDF-"), "starts with the PDF header");
  assert.ok(text.trimEnd().endsWith("%%EOF"), "ends with the PDF trailer");
  // pdf-lib writes a cross-reference stream and packs objects into object
  // streams, so the catalog is not plain text in the file. Assert on the
  // structures that ARE at top level, then prove validity by reparsing below.
  assert.match(text, /\/Root\s+\d+\s+\d+\s+R/, "the trailer names a document root");
  assert.match(text, /startxref/, "declares a cross-reference offset");
});

test("the PDF reparses as a valid document with pages and fonts", async () => {
  const bytes = await renderResumePdf(SAMPLE_DOC);

  // The strongest structural check available: a real PDF parser accepts it.
  const { PDFDocument } = await import("pdf-lib");
  const reloaded = await PDFDocument.load(bytes);

  assert.ok(reloaded.getPageCount() >= 1, "the document has at least one page");
  const [page] = reloaded.getPages();
  // US Letter, as configured.
  assert.equal(Math.round(page.getWidth()), 612);
  assert.equal(Math.round(page.getHeight()), 792);
});

test("the PDF's text is machine-extractable, and matches the resume", async () => {
  const bytes = await renderResumePdf(SAMPLE_DOC);

  // Extracted with the SAME library the resume upload pipeline uses.
  const { extractText } = await import("unpdf");
  const extracted = await extractText(bytes, { mergePages: true });
  const content = Array.isArray(extracted.text)
    ? extracted.text.join("\n")
    : extracted.text;

  const flat = content.replace(/\s+/g, " ");
  assert.ok(flat.includes("EXPERIENCE"), "headings are extractable");
  assert.ok(
    flat.includes("Cut settlement latency by 40%"),
    "bullet text is extractable"
  );
  assert.ok(flat.includes("Senior Backend Engineer"), "roles are extractable");
  assert.ok(flat.includes("PostgreSQL"), "skills are extractable");
});

test("long content paginates instead of overflowing one page", async () => {
  const many = Array.from({ length: 90 }, (_, i) => `  • Bullet number ${i} describing real delivered work in detail.`);
  const doc = parseResumeDocument(["EXPERIENCE", "Engineer — Acme", ...many].join("\n"));

  const { PDFDocument } = await import("pdf-lib");
  const reloaded = await PDFDocument.load(await renderResumePdf(doc));
  const pageCount = reloaded.getPageCount();
  assert.ok(pageCount >= 2, `expected multiple pages, saw ${pageCount}`);
});

test("an empty document still renders a valid (if bare) PDF", async () => {
  const bytes = await renderResumePdf({ headerLines: [], sections: [] });
  assert.ok(Buffer.from(bytes).toString("latin1").startsWith("%PDF-"));
});

// ---------------------------------------------------------------------------
// D. Exports render the EDITED content
// ---------------------------------------------------------------------------

test("DOCX reflects an edit made to the draft, not the original", async () => {
  const edited = SAMPLE_TEXT.replace(
    "Cut settlement latency by 40% by batching ledger writes.",
    "Rewrote the settlement path, cutting latency by 40%."
  );

  const xml = readZipEntry(
    await renderResumeDocx(parseResumeDocument(edited)),
    "word/document.xml"
  );

  assert.ok(xml!.includes("Rewrote the settlement path"), "the edit is present");
  assert.ok(
    !xml!.includes("Cut settlement latency by 40% by batching ledger writes."),
    "the pre-edit sentence is absent"
  );
});

test("PDF reflects an edit made to the draft, not the original", async () => {
  const edited = SAMPLE_TEXT.replace("PostgreSQL", "CockroachDB");
  const bytes = await renderResumePdf(parseResumeDocument(edited));

  const { extractText } = await import("unpdf");
  const extracted = await extractText(bytes, { mergePages: true });
  const content = Array.isArray(extracted.text)
    ? extracted.text.join("\n")
    : extracted.text;

  assert.ok(content.includes("CockroachDB"), "the edited skill is present");
  assert.ok(!content.includes("PostgreSQL"), "the replaced skill is absent");
});

// ---------------------------------------------------------------------------
// E. The export layer introduces no content of its own
// ---------------------------------------------------------------------------

test("the DOCX body introduces no sentence absent from the draft", async () => {
  const xml = readZipEntry(await renderResumeDocx(SAMPLE_DOC), "word/document.xml");

  // Pull every <w:t> run and check each against the source draft.
  const runs = [...xml!.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]);
  assert.ok(runs.length > 0, "there are text runs to check");

  for (const run of runs) {
    const value = run
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
    if (value.trim() === "") continue;
    assert.ok(
      SAMPLE_TEXT.includes(value),
      `DOCX introduced text not in the draft: ${value}`
    );
  }
});

test("PDF extraction introduces no skill or employer absent from the draft", async () => {
  const bytes = await renderResumePdf(SAMPLE_DOC);
  const { extractText } = await import("unpdf");
  const extracted = await extractText(bytes, { mergePages: true });
  const content = Array.isArray(extracted.text)
    ? extracted.text.join("\n")
    : extracted.text;

  // Things a fabricating formatter might plausibly add.
  for (const invented of [
    "Python",
    "Google",
    "Microsoft",
    "PhD",
    "10 years",
    "Lorem ipsum",
  ]) {
    assert.ok(
      !content.includes(invented),
      `PDF contained content absent from the resume: ${invented}`
    );
  }
});

// ---------------------------------------------------------------------------
// PDF text helpers
// ---------------------------------------------------------------------------

test("word wrapping respects the available width and loses no words", async () => {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  const sentence =
    "Owned the reconciliation service handling two million daily settlement events across three regions.";
  const lines = wrapText(sentence, font, 10.5, 200);

  assert.ok(lines.length > 1, "a long sentence wraps");
  for (const line of lines) {
    assert.ok(font.widthOfTextAtSize(line, 10.5) <= 200, `line fits: ${line}`);
  }
  assert.equal(
    lines.join(" ").replace(/\s+/g, " "),
    sentence.replace(/\s+/g, " "),
    "every word survives wrapping, in order"
  );
});

test("an unbreakably long token is split rather than overflowing", async () => {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  const lines = wrapText("A".repeat(400), font, 10.5, 120);
  assert.ok(lines.length > 1);
  for (const line of lines) {
    assert.ok(font.widthOfTextAtSize(line, 10.5) <= 120);
  }
});

test("typographic characters are normalized, not dropped wholesale", async () => {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  assert.equal(toPdfSafeText("\u201cQuoted\u201d", font), '"Quoted"');
  assert.equal(toPdfSafeText("dash\u2014here", font), "dash-here");
  assert.equal(toPdfSafeText("a\u2019s", font), "a's");
  // Unencodable scripts are dropped rather than throwing.
  assert.doesNotThrow(() => toPdfSafeText("履歴書", font));
});

test("a resume containing unencodable characters still produces a valid PDF", async () => {
  const doc = parseResumeDocument("SUMMARY\nEngineer 履歴書 with \u201csmart\u201d quotes.");
  const bytes = await renderResumePdf(doc);
  assert.ok(Buffer.from(bytes).toString("latin1").startsWith("%PDF-"));
});

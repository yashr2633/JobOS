/**
 * DOCX rendering for a tailored resume.
 *
 * Produces a REAL OOXML .docx (a zip of XML parts) via the `docx` library — not
 * text with a renamed extension. `renderResumeDocx` returns the actual bytes,
 * which begin with the ZIP local-file signature `PK\x03\x04`.
 *
 * ATS CONSTRAINTS, DELIBERATELY HELD
 *
 *  - Single column. One default section, no columns setting, no frames.
 *  - No tables anywhere. Resume content is paragraphs and real bullet lists,
 *    which is what parsers read most reliably.
 *  - No text boxes, images, icons, shapes, or SmartArt.
 *  - Conventional headings, rendered exactly as the user wrote them.
 *  - A standard, metrically common font (Calibri) at a readable size.
 *  - Hierarchy comes from weight, size and spacing — the only rule used is a
 *    thin bottom border under section headings, a paragraph property that
 *    carries no graphic and does not interrupt the text stream.
 *
 * Content is never altered: every string comes from the `ResumeDocument` the
 * user's edited text parsed into. This module has no model access and no data
 * access, so it cannot introduce a fact.
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";

import type { ResumeDocument } from "./documentModel.ts";

/** ATS-safe, metrically ubiquitous. */
const FONT = "Calibri";

/** Half-points, the unit `docx` uses for size. 22 = 11pt. */
const SIZE_BODY = 22;
const SIZE_NAME = 32;
const SIZE_CONTACT = 20;
const SIZE_HEADING = 22;

/** Twips. 1440 = 1 inch; 1080 = 0.75in, a conventional resume margin. */
const MARGIN = 1080;

function bodyRun(text: string, bold = false): TextRun {
  return new TextRun({ text, bold, font: FONT, size: SIZE_BODY });
}

/**
 * Build the paragraph list for a document.
 *
 * Split out from `renderResumeDocx` so the structure can be asserted in tests
 * without unzipping a binary.
 */
export function buildDocxParagraphs(doc: ResumeDocument): Paragraph[] {
  const paragraphs: Paragraph[] = [];

  // The user's own header block, when they wrote one. The first line reads as
  // the name; the rest as contact/detail lines. Nothing is added if absent.
  doc.headerLines.forEach((line, index) => {
    const isName = index === 0;
    paragraphs.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: isName ? 40 : 0 },
        children: [
          new TextRun({
            text: line,
            bold: isName,
            font: FONT,
            size: isName ? SIZE_NAME : SIZE_CONTACT,
          }),
        ],
      })
    );
  });

  for (const section of doc.sections) {
    paragraphs.push(
      new Paragraph({
        // A real heading outline level, so the document has a machine-readable
        // structure rather than merely looking bold.
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 240, after: 100 },
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 6, space: 2, color: "9AA0A6" },
        },
        children: [
          new TextRun({
            text: section.heading,
            bold: true,
            font: FONT,
            size: SIZE_HEADING,
            allCaps: true,
            color: "000000",
          }),
        ],
      })
    );

    for (const block of section.blocks) {
      if (block.kind === "bullets") {
        for (const item of block.items) {
          paragraphs.push(
            new Paragraph({
              // A genuine list paragraph, not a literal "•" character.
              bullet: { level: 0 },
              spacing: { after: 40, line: 264 },
              children: [bodyRun(item)],
            })
          );
        }
        continue;
      }

      paragraphs.push(
        new Paragraph({
          spacing: { after: block.emphasized ? 40 : 80, line: 264 },
          children: [bodyRun(block.text, block.emphasized)],
        })
      );
    }
  }

  return paragraphs;
}

/**
 * Render a `ResumeDocument` to real .docx bytes.
 *
 * Server-side: `Packer.toBuffer` runs on Node, which keeps document generation
 * off the client and lets the route authorize the request first.
 */
export async function renderResumeDocx(doc: ResumeDocument): Promise<Uint8Array> {
  const document = new Document({
    styles: {
      default: {
        document: {
          run: { font: FONT, size: SIZE_BODY, color: "000000" },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
          },
        },
        children: buildDocxParagraphs(doc),
      },
    ],
  });

  const buffer = await Packer.toBuffer(document);
  return new Uint8Array(buffer);
}

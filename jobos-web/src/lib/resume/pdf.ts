/**
 * PDF rendering for a tailored resume.
 *
 * Produces a REAL PDF via `pdf-lib` — not text with a renamed extension. The
 * bytes begin with `%PDF-` and end with an `%%EOF` trailer.
 *
 * ATS CONSTRAINTS, DELIBERATELY HELD
 *
 *  - Single column, one text flow, top to bottom.
 *  - Text is drawn as real text with a standard font, so it extracts cleanly.
 *    It is never rasterized to an image.
 *  - No tables, text boxes, icons, or decorative graphics. The only non-text
 *    mark is a thin rule under each section heading.
 *  - Standard PDF fonts (Helvetica / Helvetica-Bold), so nothing depends on a
 *    font file being embedded or available, and extraction is predictable.
 *
 * Content is never altered beyond the character-encoding normalization below.
 * This module has no model access and no data access, so it cannot introduce a
 * fact.
 *
 * ENCODING LIMITATION, STATED HONESTLY
 *
 * The standard PDF fonts use WinAnsi. Common typographic characters are mapped
 * to their ASCII equivalents; any remaining character outside WinAnsi is
 * dropped rather than crashing the export. Résumés containing scripts outside
 * that range (for example CJK) should use the DOCX export, which preserves full
 * Unicode.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import type { ResumeDocument } from "./documentModel.ts";

/** US Letter, in points. */
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
/** 0.75in margins, matching the DOCX renderer. */
const MARGIN = 54;

const SIZE_NAME = 17;
const SIZE_CONTACT = 10;
const SIZE_HEADING = 11;
const SIZE_BODY = 10.5;

const LINE_GAP = 1.32;
const BULLET_INDENT = 12;
const BULLET_HANGING = 10;

const INK = rgb(0, 0, 0);
const RULE = rgb(0.6, 0.63, 0.66);

/** Typographic characters that have a faithful ASCII equivalent. */
const CHARACTER_FALLBACKS: ReadonlyArray<[RegExp, string]> = [
  [/[\u2018\u2019\u201a\u201b]/g, "'"],
  [/[\u201c\u201d\u201e\u201f]/g, '"'],
  [/[\u2013\u2014\u2015]/g, "-"],
  [/[\u2026]/g, "..."],
  [/[\u00a0\u2007\u202f\u2009\u200a]/g, " "],
  [/[\u2022]/g, "\u00b7"],
  [/[\u200b\u200c\u200d\ufeff]/g, ""],
];

/**
 * Make a string safe for a WinAnsi standard font.
 *
 * Applies the fallbacks above, then drops anything the font still cannot encode
 * so a single exotic character can never fail the whole export.
 */
export function toPdfSafeText(value: string, font: PDFFont): string {
  let text = typeof value === "string" ? value : "";
  for (const [pattern, replacement] of CHARACTER_FALLBACKS) {
    text = text.replace(pattern, replacement);
  }

  let encodable = "";
  for (const char of text) {
    try {
      font.widthOfTextAtSize(char, SIZE_BODY);
      encodable += char;
    } catch {
      // Outside WinAnsi. Dropped rather than throwing; DOCX covers these users.
    }
  }
  return encodable;
}

/**
 * Break text into lines that fit `maxWidth`.
 *
 * A single word longer than the line is split by character, so a long URL
 * cannot overflow the margin.
 */
export function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/).filter((word) => word !== "");
  if (words.length === 0) return [];

  const lines: string[] = [];
  let current = "";

  const widthOf = (value: string) => font.widthOfTextAtSize(value, size);

  for (const word of words) {
    const candidate = current === "" ? word : `${current} ${word}`;
    if (widthOf(candidate) <= maxWidth) {
      current = candidate;
      continue;
    }

    if (current !== "") {
      lines.push(current);
      current = "";
    }

    if (widthOf(word) <= maxWidth) {
      current = word;
      continue;
    }

    // Word alone exceeds the width: split it.
    let chunk = "";
    for (const char of word) {
      if (widthOf(chunk + char) > maxWidth && chunk !== "") {
        lines.push(chunk);
        chunk = char;
      } else {
        chunk += char;
      }
    }
    current = chunk;
  }

  if (current !== "") lines.push(current);
  return lines;
}

/** Mutable cursor threaded through the draw helpers. */
interface Cursor {
  page: PDFPage;
  y: number;
}

/**
 * Render a `ResumeDocument` to real PDF bytes.
 *
 * Server-side, so the route authorizes before any document is produced.
 */
export async function renderResumePdf(doc: ResumeDocument): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const contentWidth = PAGE_WIDTH - MARGIN * 2;
  const bottomLimit = MARGIN;

  const cursor: Cursor = {
    page: pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
    y: PAGE_HEIGHT - MARGIN,
  };

  /** Start a new page when the next block would cross the bottom margin. */
  const ensureSpace = (needed: number) => {
    if (cursor.y - needed >= bottomLimit) return;
    cursor.page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    cursor.y = PAGE_HEIGHT - MARGIN;
  };

  const drawWrapped = (
    text: string,
    font: PDFFont,
    size: number,
    options: { indent?: number; center?: boolean; after?: number } = {}
  ) => {
    const indent = options.indent ?? 0;
    const safe = toPdfSafeText(text, font);
    if (safe === "") return;

    const lines = wrapText(safe, font, size, contentWidth - indent);
    const lineHeight = size * LINE_GAP;

    for (const line of lines) {
      ensureSpace(lineHeight);
      const x = options.center
        ? MARGIN + (contentWidth - font.widthOfTextAtSize(line, size)) / 2
        : MARGIN + indent;
      cursor.page.drawText(line, {
        x,
        y: cursor.y - size,
        size,
        font,
        color: INK,
      });
      cursor.y -= lineHeight;
    }

    if (options.after) cursor.y -= options.after;
  };

  // The user's own header block, when they wrote one.
  doc.headerLines.forEach((line, index) => {
    if (index === 0) {
      drawWrapped(line, bold, SIZE_NAME, { center: true, after: 3 });
    } else {
      drawWrapped(line, regular, SIZE_CONTACT, { center: true });
    }
  });
  if (doc.headerLines.length > 0) cursor.y -= 8;

  for (const section of doc.sections) {
    const headingHeight = SIZE_HEADING * LINE_GAP + 10;
    ensureSpace(headingHeight + SIZE_BODY * LINE_GAP);
    cursor.y -= 6;

    drawWrapped(section.heading.toUpperCase(), bold, SIZE_HEADING);

    // The single non-text mark: a thin rule for hierarchy.
    cursor.y += 2;
    cursor.page.drawLine({
      start: { x: MARGIN, y: cursor.y },
      end: { x: MARGIN + contentWidth, y: cursor.y },
      thickness: 0.6,
      color: RULE,
    });
    cursor.y -= 8;

    for (const block of section.blocks) {
      if (block.kind === "bullets") {
        for (const item of block.items) {
          const lineHeight = SIZE_BODY * LINE_GAP;
          ensureSpace(lineHeight);
          // The marker is drawn once, then the text is wrapped with a hanging
          // indent so continuation lines align under the first.
          cursor.page.drawText("\u00b7", {
            x: MARGIN + BULLET_INDENT,
            y: cursor.y - SIZE_BODY,
            size: SIZE_BODY,
            font: bold,
            color: INK,
          });
          drawWrapped(item, regular, SIZE_BODY, {
            indent: BULLET_INDENT + BULLET_HANGING,
            after: 1.5,
          });
        }
        continue;
      }

      drawWrapped(
        block.text,
        block.emphasized ? bold : regular,
        SIZE_BODY,
        { after: block.emphasized ? 2 : 5 }
      );
    }
  }

  return pdf.save();
}

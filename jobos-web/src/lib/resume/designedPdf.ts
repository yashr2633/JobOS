import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { composeDesign } from "./designScene.ts";
import type { ResumeDocument } from "./documentModel.ts";
import type { ResumeLayout } from "./templates.ts";
const color = (hex: string) => rgb(parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255);
export class UnsupportedDesignPdfError extends Error {
  constructor() { super("Use DOCX or TXT to preserve characters outside the PDF fonts."); this.name = "UnsupportedDesignPdfError"; }
}
export async function renderDesignedPdf(document: ResumeDocument, layout: ResumeLayout) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(layout.font === "serif" ? StandardFonts.TimesRoman : StandardFonts.Helvetica);
  const bold = await pdf.embedFont(layout.font === "serif" ? StandardFonts.TimesRomanBold : StandardFonts.HelveticaBold);
  const pages = composeDesign(document, layout, (text, size, heavy) => { try { return (heavy ? bold : regular).widthOfTextAtSize(text, size); } catch { throw new UnsupportedDesignPdfError(); } });
  for (const scene of pages) {
    const page = pdf.addPage([scene.width, scene.height]);
    for (const item of scene.elements) {
      if (item.kind === "text") page.drawText(item.text, { x: item.x, y: scene.height - item.y - item.size, size: item.size, font: item.bold ? bold : regular, color: color(item.color) });
      else if (item.kind === "rect") page.drawRectangle({ x: item.x, y: scene.height - item.y - item.height, width: item.width, height: item.height, color: item.fill ? color(item.fill) : undefined, borderColor: item.stroke ? color(item.stroke) : undefined, borderWidth: item.stroke ? item.thickness : 0 });
      else page.drawLine({ start: { x: item.x, y: scene.height - item.y }, end: { x: item.x2, y: scene.height - item.y2 }, thickness: item.thickness, color: color(item.color) });
    }
  }
  return pdf.save();
}

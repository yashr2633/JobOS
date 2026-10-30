import { AlignmentType, BorderStyle, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableLayoutType, TableRow, TextRun, VerticalAlign, WidthType } from "docx";
import type { ResumeDocument, ResumeSection } from "./documentModel.ts";
import type { ResumeLayout } from "./templates.ts";
import { designSectionColumns } from "./designScene.ts";

/** Editable Word layouts use paragraphs and, only for designed columns, real table cells. */
export async function renderDesignedDocx(source: ResumeDocument, layout: ResumeLayout) {
  const design = layout.design!, font = layout.font === "serif" ? "Times New Roman" : "Arial", accent = design.accent;
  const bodySize = layout.fontSize * 2, line = Math.round(layout.lineHeight * 240);
  const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const borders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };
  const rule = { style: BorderStyle.SINGLE, size: 8, color: accent, space: 4 };
  const run = (text: string, bold = false, color = "172338", size = bodySize) => new TextRun({ text, font, bold, color, size });
  const dark = ["banner", "blocks"].includes(design.composition) && ["signature", "panel"].includes(design.treatment);
  const heading = (value: string) => new Paragraph({
    heading: HeadingLevel.HEADING_2, keepNext: true,
    spacing: { before: layout.sectionGap * 20, after: 100 },
    shading: design.sectionStyle === "bar" ? { fill: "F0F3F6" } : undefined,
    border: design.sectionStyle === "tab" ? { left: rule } : ["rule", "underline"].includes(design.sectionStyle) ? { bottom: rule } : undefined,
    indent: design.sectionStyle === "tab" ? { left: 160 } : undefined,
    children: [run(value.toUpperCase(), true, accent)],
  });
  const sectionParagraphs = (sections: ResumeSection[]) => sections.flatMap(section => [
    ...(section.heading.trim() ? [heading(section.heading)] : []),
    ...section.blocks.flatMap(block => block.kind === "bullets" ? block.items.map(text => new Paragraph({ bullet: { level: 0 }, spacing: { after: 60, line }, children: [run(text)] }))
      : [new Paragraph({ keepNext: block.emphasized, spacing: { after: block.emphasized ? 60 : 100, line }, children: [run(block.text, block.emphasized)] })]),
  ]);
  const headerParagraphs = (values: string[], offset = 0) => values.map((value, index) => new Paragraph({
    alignment: layout.centeredHeader ? AlignmentType.CENTER : AlignmentType.LEFT,
    spacing: { after: index + offset === 0 ? 100 : 30 },
    children: [run(value, index + offset === 0, dark ? "FFFFFF" : index + offset === 0 ? accent : "465365", index + offset === 0 ? layout.nameSize * 2 : 19)],
  }));
  const pageWidth = layout.pageSize === "a4" ? 11906 : 12240, pageHeight = layout.pageSize === "a4" ? 16838 : 15840;
  const margin = Math.round(layout.margin * 20), available = pageWidth - margin * 2;
  const cell = (children: Paragraph[], width: number, fill = "FFFFFF") => new TableCell({ width: { size: width, type: WidthType.DXA }, borders, shading: { fill }, verticalAlign: VerticalAlign.TOP, margins: { top: 160, bottom: 160, left: 160, right: 160 }, children: children.length ? children : [new Paragraph("")] });
  const table = (cells: TableCell[], widths: number[]) => new Table({ width: { size: available, type: WidthType.DXA }, columnWidths: widths, layout: TableLayoutType.FIXED, borders, rows: [new TableRow({ children: cells })] });
  const children: (Paragraph | Table)[] = [];
  const split = design.composition === "split-header" || design.treatment === "split";
  if (split && source.headerLines.length > 1) {
    const first = Math.round(available * .62), second = available - first;
    children.push(table([cell(headerParagraphs(source.headerLines.slice(0, 1)), first, dark ? accent : "FFFFFF"), cell(headerParagraphs(source.headerLines.slice(1), 1), second, dark ? accent : "F0F3F6")], [first, second]));
  } else if (dark || ["panel", "outline"].includes(design.treatment)) {
    const header = cell(headerParagraphs(source.headerLines), available, dark ? accent : "F0F3F6");
    children.push(table([header], [available]));
  } else children.push(...headerParagraphs(source.headerLines));
  if (["topline", "underline", "masthead", "rail", "frame"].includes(design.composition) || design.treatment === "line") children.push(new Paragraph({ border: { bottom: { ...rule, size: design.composition === "underline" ? 24 : 8 } }, spacing: { after: 120 }, children: [] }));
  const { main, side } = designSectionColumns(source, layout);
  if (side.length && design.columns === 2) {
    const sideWidth = Math.round(available * .34), mainWidth = available - sideWidth;
    const sideCell = cell(sectionParagraphs(side), sideWidth, "F0F3F6"), mainCell = cell(sectionParagraphs(main), mainWidth);
    const left = design.composition === "sidebar-left";
    children.push(table(left ? [sideCell, mainCell] : [mainCell, sideCell], left ? [sideWidth, mainWidth] : [mainWidth, sideWidth]));
  } else if (design.composition === "labels" && source.sections.some(section => section.heading.trim())) {
    for (const section of source.sections) {
      const labelWidth = Math.round(available * .23);
      children.push(table([cell(section.heading.trim() ? [heading(section.heading)] : [], labelWidth, "F0F3F6"), cell(sectionParagraphs([{ ...section, heading: "" }]), available - labelWidth)], [labelWidth, available - labelWidth]));
    }
  } else children.push(...sectionParagraphs(main));
  const document = new Document({ styles: { default: { document: { run: { font, size: bodySize, color: "172338" } } } }, sections: [{
    properties: { page: { size: { width: pageWidth, height: pageHeight }, margin: { top: margin, bottom: margin, left: margin, right: margin } } }, children,
  }] });
  return new Uint8Array(await Packer.toBuffer(document));
}

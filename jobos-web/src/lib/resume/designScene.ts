import type { ResumeDocument, ResumeSection } from "./documentModel.ts";
import type { ResumeLayout } from "./templates.ts";

export type DesignElement =
  | { kind: "text"; text: string; x: number; y: number; size: number; bold: boolean; color: string }
  | { kind: "rect"; x: number; y: number; width: number; height: number; fill?: string; stroke?: string; thickness?: number }
  | { kind: "line"; x: number; y: number; x2: number; y2: number; color: string; thickness: number };
export interface DesignPage { width: number; height: number; elements: DesignElement[] }
export type DesignMeasure = (text: string, size: number, bold: boolean) => number;
export const previewMeasure: DesignMeasure = (text, size, bold) => [...text].reduce((width, char) => width + (/[il.,' !|]/.test(char) ? .25 : /[MW@]/.test(char) ? .85 : /[A-Z]/.test(char) ? .65 : .5) * size * (bold ? 1.025 : 1), 0);
export const designText = (text: string) => text.replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2010-\u2015]/g, "-").replace(/\u2026/g, "...").replace(/[\u200b-\u200d\ufeff]/g, "");

export function designSectionColumns(document: ResumeDocument, layout: ResumeLayout) {
  const two = layout.design?.columns === 2 && document.sections.some(section => section.heading.trim());
  if (!two) return { main: document.sections, side: [] as ResumeSection[] };
  const side = document.sections.filter(section => /skill|education|certification|language|interest|contact/i.test(section.heading));
  if (!side.length || side.length === document.sections.length) return { main: document.sections, side: [] as ResumeSection[] };
  return { main: document.sections.filter(section => !side.includes(section)), side };
}

/** Shared vector composition for browser previews and PDFs. Every content line remains real text. */
export function composeDesign(document: ResumeDocument, layout: ResumeLayout, measure: DesignMeasure = previewMeasure): DesignPage[] {
  if (!layout.design) throw new Error("Choose a designed template.");
  const design = layout.design, width = layout.pageSize === "a4" ? 595.28 : 612, height = layout.pageSize === "a4" ? 841.89 : 792;
  const margin = layout.margin, accent = design.accent, ink = "172338", muted = "465365", tint = "F0F3F6", white = "FFFFFF";
  const pages: DesignPage[] = [], contentWidth = width - 2 * margin, bottom = height - margin;
  const wrap = (input: string, available: number, size: number, bold: boolean) => {
    const lines: string[] = []; let current = "";
    for (const word of designText(input).split(/\s+/).filter(Boolean)) {
      if (current && measure(`${current} ${word}`, size, bold) > available) { lines.push(current); current = ""; }
      if (measure(word, size, bold) <= available) { current = current ? `${current} ${word}` : word; continue; }
      let chunk = "";
      for (const char of word) { if (chunk && measure(chunk + char, size, bold) > available) { lines.push(chunk); chunk = ""; } chunk += char; }
      current = chunk;
    }
    if (current) lines.push(current);
    return lines;
  };
  const add = (page: DesignPage, element: DesignElement) => page.elements.push(element);
  const rect = (page: DesignPage, x: number, y: number, w: number, h: number, fill?: string, stroke?: string, thickness = 1) => add(page, { kind: "rect", x, y, width: w, height: h, fill, stroke, thickness });
  const line = (page: DesignPage, x: number, y: number, x2: number, y2: number, color = accent, thickness = 1) => add(page, { kind: "line", x, y, x2, y2, color, thickness });
  const text = (page: DesignPage, value: string, x: number, y: number, size: number, bold = false, color = ink) => add(page, { kind: "text", text: designText(value), x, y, size, bold, color });
  const newPage = () => {
    const page: DesignPage = { width, height, elements: [] }; pages.push(page);
    rect(page, 0, 0, width, height, white);
    if (design.composition === "frame") rect(page, 23, 23, width - 46, height - 46, undefined, accent, design.treatment === "outline" ? 2 : .8);
    if (design.composition === "rail") rect(page, 22, 24, design.treatment === "panel" ? 17 : 6, height - 48, accent);
    if (design.composition === "topline") rect(page, 0, 0, width, design.treatment === "split" ? 22 : 7, accent);
    if (design.composition === "timeline") line(page, margin - 13, margin, margin - 13, height - margin, "CCD4DE", 1);
    return page;
  };
  const first = newPage(), name = document.headerLines[0] ?? "", contacts = document.headerLines.slice(1);
  const dark = (design.composition === "banner" || design.composition === "blocks") && ["signature", "panel"].includes(design.treatment);
  const centered = design.composition === "masthead" || layout.centeredHeader;
  const split = design.composition === "split-header" || design.treatment === "split";
  const nameWidth = split ? contentWidth * .58 : contentWidth;
  const allNameLines = wrap(name, nameWidth - 10, layout.nameSize, true), nameLines = allNameLines.slice(0, 3);
  const contactWidth = split ? contentWidth * .35 : contentWidth;
  const allContactLines = contacts.flatMap(value => wrap(value, contactWidth - 8, 9.5, false)), contactLines = allContactLines.slice(0, 12);
  const nameHeight = nameLines.length * layout.nameSize * 1.13;
  const headerContentHeight = split ? Math.max(nameHeight, contactLines.length * 13) : nameHeight + 11 + contactLines.length * 13;
  const headerTop = margin, headerBottom = headerTop + headerContentHeight + 19;
  if (dark) rect(first, design.composition === "banner" ? 0 : margin - 14, design.composition === "banner" ? 0 : margin - 14, design.composition === "banner" ? width : contentWidth + 28, headerBottom + (design.composition === "banner" ? 0 : 0) - (design.composition === "banner" ? 0 : margin - 14), accent);
  else if (design.treatment === "panel") rect(first, margin - 14, margin - 14, contentWidth + 28, headerBottom - margin + 25, tint);
  else if (design.treatment === "outline") rect(first, margin - 12, margin - 14, contentWidth + 24, headerBottom - margin + 24, undefined, accent, 1);
  const headerInk = dark ? white : ink;
  let nameY = headerTop;
  for (const value of nameLines) { const x = centered && !split ? margin + (contentWidth - measure(value, layout.nameSize, true)) / 2 : margin; text(first, value, x, nameY, layout.nameSize, true, headerInk); nameY += layout.nameSize * 1.13; }
  let contactY = split ? headerTop + 3 : nameY + 11;
  for (const value of contactLines) { const x = split ? margin + contentWidth * .65 : centered ? margin + (contentWidth - measure(value, 9.5, false)) / 2 : margin; text(first, value, x, contactY, 9.5, false, dark ? white : muted); contactY += 13; }
  if (!dark && design.treatment !== "outline") {
    const ruleY = headerBottom + 5;
    if (["masthead", "split-header", "underline"].includes(design.composition) || design.treatment === "line") {
      line(first, margin, ruleY, design.composition === "underline" ? margin + contentWidth * .3 : width - margin, ruleY, accent, design.composition === "underline" ? 5 : 1.5);
      if (design.composition === "masthead") line(first, margin, ruleY + 4, width - margin, ruleY + 4, accent, .5);
    }
  }
  const start = headerBottom + 29, columns = designSectionColumns(document, layout), side = columns.side;
  const overflow = [...allNameLines.slice(3), ...allContactLines.slice(12)];
  const main = overflow.length ? [{ heading: "", blocks: overflow.map(text => ({ kind: "line" as const, text, emphasized: false })) }, ...columns.main] : columns.main;
  const twoColumns = design.columns === 2 && side.length > 0;
  const sideWidth = Math.min(160, contentWidth * .32), gap = 23;
  const sideLeft = design.composition === "sidebar-left";
  const mainX = twoColumns && sideLeft ? margin + sideWidth + gap : margin;
  const mainWidth = twoColumns ? contentWidth - sideWidth - gap : contentWidth;
  const sideX = sideLeft ? margin : width - margin - sideWidth;
  const decorated = new Set<number>();
  function preparePage(index: number) {
    while (!pages[index]) newPage();
    if (!decorated.has(index)) {
      decorated.add(index);
      if (twoColumns) rect(pages[index], sideX - 9, index === 0 ? start - 8 : margin - 8, sideWidth + 18, bottom - (index === 0 ? start : margin) + 15, tint);
    }
    return pages[index];
  }
  function renderLane(sections: ResumeSection[], x: number, laneWidth: number, sidebar: boolean) {
    let index = 0, y = start;
    const fontSize = sidebar ? Math.min(layout.fontSize, 10.5) : layout.fontSize;
    const lineHeight = fontSize * layout.lineHeight;
    const ensure = (space: number) => { if (y + space > bottom) { index++; y = margin; } return preparePage(index); };
    for (const section of sections) {
      let labelHeight = 0;
      const labelLayout = design.composition === "labels" && !sidebar && section.heading.trim();
      const inset = labelLayout ? Math.min(106, laneWidth * .27) : 0;
      if (section.heading.trim()) {
        y += layout.sectionGap / 2;
        const headingLines = wrap(section.heading.toUpperCase(), labelLayout ? inset - 12 : laneWidth - 18, 10.5, true);
        const headingHeight = headingLines.length * 14 + 13;
        labelHeight = labelLayout ? headingHeight : 0;
        const page = ensure(headingHeight + lineHeight);
        if (!labelLayout) {
          if (design.sectionStyle === "bar") rect(page, x - 4, y - 5, laneWidth + 8, headingHeight - 1, tint);
          if (design.sectionStyle === "tab") rect(page, x - 4, y - 4, 4, headingHeight - 1, accent);
          if (design.sectionStyle === "rule") line(page, x, y + headingHeight - 8, x + laneWidth, y + headingHeight - 8, accent, .7);
          if (design.sectionStyle === "underline") line(page, x, y + headingHeight - 8, x + Math.min(80, laneWidth), y + headingHeight - 8, accent, 2);
        }
        if (design.composition === "timeline") rect(page, margin - 16, y + 2, 6, 6, accent);
        headingLines.forEach((value, row) => text(page, value, x + (design.sectionStyle === "tab" ? 7 : 0), y + row * 14, 10.5, true, accent));
        if (!labelLayout) y += headingHeight;
      }
      const bodyX = x + inset, bodyWidth = laneWidth - inset;
      const startY = y;
      for (const block of section.blocks) {
        const values = block.kind === "bullets" ? block.items.map(value => ({ value, bullet: true, bold: false })) : [{ value: block.text, bullet: false, bold: block.emphasized }];
        for (const item of values) {
          const indent = item.bullet ? 11 : 0;
          const lines = wrap(item.value, bodyWidth - indent, fontSize, item.bold);
          lines.forEach((value, row) => { const page = ensure(lineHeight); if (item.bullet && row === 0) text(page, "-", bodyX, y, fontSize, true); text(page, value, bodyX + indent, y, fontSize, item.bold); y += lineHeight; });
          y += item.bold ? 3 : 5;
        }
      }
      y = Math.max(y, startY + labelHeight) + 7;
    }
  }
  renderLane(main, mainX, mainWidth, false);
  if (twoColumns) renderLane(side, sideX, sideWidth, true);
  return pages;
}

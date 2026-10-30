"use client";
import type { ResumeDocument } from "@/lib/resume/documentModel";
import { formatResumeDocument, resumeLayout, type ResumeFormatInput } from "@/lib/resume/templates";
import DesignPreview from "./DesignPreview";

/** Content and order are shared with server exports; browser pagination may differ. */
export default function DocumentPreview({ document, formatting }: { document: ResumeDocument; formatting: ResumeFormatInput }) {
  const layout = resumeLayout(formatting), ordered = formatResumeDocument(document, formatting);
  if (layout.design) return <div className="document-preview-scroll"><DesignPreview document={ordered} layout={layout} /></div>;
  return <div className="document-preview-scroll"><div className="document-page" aria-label="Document live preview" style={{ fontFamily: layout.font === "serif" ? '"Times New Roman",serif' : 'Arial,sans-serif', fontSize: `${layout.fontSize}pt`, lineHeight: layout.lineHeight, padding: `${layout.margin}px`, aspectRatio: layout.pageSize === "a4" ? "210 / 297" : "8.5 / 11" }}>
    <header style={{ textAlign: layout.centeredHeader ? "center" : "left" }}>{ordered.headerLines.length ? ordered.headerLines.map((line, index) => <p key={index} style={{ fontSize: index === 0 ? `${layout.nameSize}pt` : undefined, fontWeight: index === 0 ? 700 : 400 }}>{line}</p>) : <p className="document-placeholder">Your name and contact details</p>}</header>
    {ordered.sections.some(section => section.blocks.length) ? ordered.sections.map((section, index) => <section key={index} style={{ marginTop: layout.sectionGap }}>
      {section.heading && <h3 style={{ fontSize: "inherit", borderBottom: layout.sectionRule ? "1px solid #9aa0a6" : "none" }}>{section.heading}</h3>}
      {section.blocks.map((block, i) => block.kind === "bullets" ? <ul key={i}>{block.items.map((item, j) => <li key={j}>{item}</li>)}</ul> : <p key={i} style={{ fontWeight: block.emphasized ? 700 : 400 }}>{block.text}</p>)}
    </section>) : <p className="document-placeholder">Your content appears here as you fill in the editor.</p>}
  </div></div>;
}

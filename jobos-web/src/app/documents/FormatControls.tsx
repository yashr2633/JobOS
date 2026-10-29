"use client";
import { RESUME_PRIORITIES, RESUME_STYLES, resumeLayout, type ResumeFormatInput } from "@/lib/resume/templates";
import { useState } from "react";

export default function FormatControls({ value, onChange, letter = false }: { value: ResumeFormatInput; onChange: (value: ResumeFormatInput) => void; letter?: boolean }) {
  const layout = resumeLayout(value), current = value.templateId ?? "classic-original";
  const selectedStyle = RESUME_STYLES.find(style => RESUME_PRIORITIES.some(priority => current === `${style.id}-${priority.id}`)) ?? RESUME_STYLES[0];
  const priority = current.slice(selectedStyle.id.length + 1), [page, setPage] = useState(0);
  return <details className="document-format-panel" open><summary>Template &amp; formatting <span>{selectedStyle.name}</span></summary>
    <p className="document-help">50 single-column typographic layouts. Black text, standard headings and an editable reading order.</p>
    <div className="template-gallery" aria-label="Resume template gallery">{RESUME_STYLES.slice(page * 10, page * 10 + 10).map(style => <button type="button" key={style.id} className="template-choice" aria-pressed={selectedStyle.id === style.id} onClick={() => onChange({ ...value, templateId: `${style.id}-${letter ? "original" : priority}` })}>
      <span className="template-thumbnail" aria-hidden="true" style={{ fontFamily: style.font === "serif" ? "serif" : "sans-serif", textAlign: style.centeredHeader ? "center" : "left", padding: `${style.margin / 6}px` }}><strong style={{ fontSize: style.nameSize / 2 }}>YOUR NAME</strong><span className="template-sample-contact">Contact details</span><span className="template-sample-heading" style={{ borderBottomWidth: style.sectionRule ? 1 : 0 }}>EXPERIENCE</span><i /><i /><i className="short" /><span className="template-sample-heading" style={{ borderBottomWidth: style.sectionRule ? 1 : 0 }}>EDUCATION</span><i /><i className="short" /></span><span>{style.name}</span><small>{style.font === "serif" ? "Serif" : "Sans serif"} · {style.centeredHeader ? "Centred" : "Left header"}</small>
    </button>)}</div>
    <div className="template-pagination"><button type="button" className="product-button" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</button><span>Layouts {page * 10 + 1}–{Math.min((page + 1) * 10, 50)} of 50</span><button type="button" className="product-button" disabled={page === 4} onClick={() => setPage(p => p + 1)}>Next</button></div>
    <div className="document-format-grid">
      {!letter && <label>Section priority<select value={priority} onChange={event => onChange({ ...value, templateId: `${selectedStyle.id}-${event.target.value}` })}>{RESUME_PRIORITIES.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      <label>Page size<select value={layout.pageSize} onChange={event => onChange({ ...value, pageSize: event.target.value as "a4" | "letter" })}><option value="a4">A4</option><option value="letter">US Letter</option></select></label>
      <label>Text size · {layout.fontSize} pt<input type="range" min="10.5" max="12.5" step="0.5" value={layout.fontSize} onChange={event => onChange({ ...value, fontSize: Number(event.target.value) })} /></label>
      <label>Margins · {layout.margin} pt<input type="range" min="40" max="72" step="1" value={layout.margin} onChange={event => onChange({ ...value, margin: Number(event.target.value) })} /></label>
      <label>Line spacing · {layout.lineHeight.toFixed(2)}<input type="range" min="1.15" max="1.5" step="0.01" value={layout.lineHeight} onChange={event => onChange({ ...value, lineHeight: Number(event.target.value) })} /></label>
    </div>
  </details>;
}

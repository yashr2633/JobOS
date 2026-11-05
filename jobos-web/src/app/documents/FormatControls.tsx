"use client";
import { RESUME_PRIORITIES, RESUME_STYLES, resumeLayout, type ResumeFormatInput } from "@/lib/resume/templates";
import { GALLERY_LETTER, GALLERY_SAMPLE } from "@/lib/resume/gallerySample";
import { useEffect, useMemo, useRef, useState } from "react";
import DesignPreview from "./DesignPreview";
import DocumentPreview from "./DocumentPreview";
import Link from "next/link";
import { isFreeTemplate } from "@/lib/resume/templateAccess";
import type { ResumeDesign } from "@/lib/resume/designs";

const GALLERY_STYLES: readonly { id: string; name: string; design?: ResumeDesign }[] = RESUME_STYLES.filter(style =>
  ("design" in style && style.design) || style.id === "classic" || style.id === "modern"
);

export default function FormatControls({ value, onChange, letter = false, mode = "full" }: { value: ResumeFormatInput; onChange: (value: ResumeFormatInput) => void; letter?: boolean; mode?: "gallery" | "settings" | "full" }) {
  const layout = resumeLayout(value), current = value.templateId ?? "classic-original";
  const selectedStyle = RESUME_STYLES.find(style => RESUME_PRIORITIES.some(priority => current === `${style.id}-${priority.id}`)) ?? RESUME_STYLES[0];
  const priority = current.slice(selectedStyle.id.length + 1);
  const [query, setQuery] = useState(""), [category, setCategory] = useState("All"), [columns, setColumns] = useState("All"), [limit, setLimit] = useState(12);
  const [pro, setPro] = useState(false);
  const [lockedDesign, setLockedDesign] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/plans/access", { cache: "no-store", signal: controller.signal })
      .then(response => response.ok ? response.json() : { pro: false })
      .then(value => setPro(value.pro === true))
      .catch(() => {});
    return () => controller.abort();
  }, []);
  const visible = useMemo(() => GALLERY_STYLES.filter(style => {
    const design = style.design;
    return (category === "All" || design?.category === category || (category === "Minimal" && !design)) &&
      (columns === "All" || (design?.columns ?? 1) === Number(columns)) &&
      `${style.name} ${design?.category ?? "Minimal"}`.toLowerCase().includes(query.toLowerCase().trim());
  }), [category, columns, query]);
  const shown = Math.min(limit, visible.length);
  const scrollArea = useRef<HTMLDivElement>(null), moreMarker = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!scrollArea.current || !moreMarker.current || shown >= visible.length || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) setLimit(value => Math.min(value + 12, visible.length));
    }, { root: scrollArea.current, rootMargin: "0px 0px 180px 0px" });
    observer.observe(moreMarker.current);
    return () => observer.disconnect();
  }, [shown, visible.length]);
  const galleryId = `template-gallery-${letter ? "letter" : "resume"}`;
  return <>
    {mode !== "settings" && <section id={galleryId} className="studio-template-library" aria-label={letter ? "Cover Letter templates" : "Resume templates"}>
      <div className="studio-library-heading"><div><p className="product-kicker">Choose your design</p><h2>{letter ? "Cover Letter Templates" : "Resume Templates"}</h2><p>74 designs · 10 Free · 64 Premium. Choose a design and customize your document.</p></div><div className="studio-selected-design"><span>Selected design</span><strong>{selectedStyle.name}</strong><a className="product-button product-button-primary" href={`#document-editor-${letter ? "letter" : "resume"}`}>Customize {letter ? "letter" : "resume"} ↓</a></div></div>
      <div className="studio-gallery-filters"><label>Search templates<input type="search" placeholder="Try Folio, minimal, professional…" value={query} onChange={event => { setQuery(event.target.value); setLimit(12); }} /></label><label>Style<select value={category} onChange={event => { setCategory(event.target.value); setLimit(12); }}>{["All", "Professional", "Minimal", "Editorial", "Creative"].map(name => <option key={name}>{name}</option>)}</select></label>{!letter && <label>Layout<select value={columns} onChange={event => { setColumns(event.target.value); setLimit(12); }}><option value="All">All layouts</option><option value="1">Single column</option><option value="2">Two columns</option></select></label>}</div>
      <p className="studio-gallery-note">Sample text is illustrative and is never added to your resume. For automated application forms, choose a single-column design and review the text order.</p>
      <div ref={scrollArea} className="studio-gallery-scroll studio-gallery-catalog" role="region" aria-label={letter ? "Scroll Cover Letter designs" : "Scroll resume designs"} tabIndex={0}><div className="studio-gallery-grid">{visible.slice(0, shown).map(style => <button type="button" key={style.id} className="studio-template-card" aria-pressed={selectedStyle.id === style.id} onClick={() => {
        if (!pro && !isFreeTemplate(`${style.id}-original`)) { setLockedDesign(style.name); return; }
        onChange({ ...value, templateId: `${style.id}-${letter ? "original" : priority}` });
      }}>
        {style.design
          ? <DesignPreview document={letter ? GALLERY_LETTER : GALLERY_SAMPLE} layout={resumeLayout({ templateId: `${style.id}-original` })} thumbnail />
          : <div className="design-thumbnail legacy-template-thumbnail"><DocumentPreview document={letter ? GALLERY_LETTER : GALLERY_SAMPLE} formatting={{ templateId: `${style.id}-original` }} /></div>}
        <span className="studio-template-card-heading"><strong>{style.name}</strong><span>{isFreeTemplate(`${style.id}-original`) ? "Free" : "Premium"} · {selectedStyle.id === style.id ? "Selected" : "Choose template →"}</span></span><small>{style.design?.category ?? "Minimal"} · {letter || (style.design?.columns ?? 1) === 1 ? "Single column" : "Two columns"}</small>
      </button>)}</div><div ref={moreMarker} aria-hidden="true" style={{ height: 1 }} /></div>
      {lockedDesign && <div className="mt-4 rounded-lg border border-border bg-surface-2 p-4" role="status"><strong>{lockedDesign} · Premium</strong><p className="mt-1 text-sm">Choose a Free template or get Pro access to use this design.</p><div className="mt-3 flex gap-3"><Link href="/plans" className="product-button product-button-primary">View plans</Link><button type="button" className="product-button" onClick={() => setLockedDesign("")}>Keep browsing</button></div></div>}
      {!visible.length && <p className="product-notice">No designs match these filters. Choose another style or clear your search.</p>}
      <div className="studio-browse-footer"><div aria-live="polite"><strong>{shown} of {visible.length} designs</strong><span>Scroll inside the gallery to explore. Your selected design stays applied.</span></div>{shown < visible.length ? <button type="button" className="product-button product-button-primary" onClick={() => setLimit(value => value + 12)}>Show {Math.min(12, visible.length - shown)} more templates ↓</button> : <span className="studio-library-complete">All matching designs loaded ✓</span>}</div>
    </section>}
    {mode !== "gallery" && <section className="document-format-panel" aria-label="Document formatting"><p className="product-kicker">LAYOUT &amp; TYPOGRAPHY</p><div className="studio-format-heading"><h2>Customize your document</h2><a href={`#${galleryId}`}>Change design ↗</a></div><p className="document-help">{selectedStyle.name} · Adjust the page and text below. Your preview updates as you go.</p><div className="document-format-grid">
      {!letter && <label>Section priority<select value={priority} onChange={event => onChange({ ...value, templateId: `${selectedStyle.id}-${event.target.value}` })}>{RESUME_PRIORITIES.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      <label>Page size<select value={layout.pageSize} onChange={event => onChange({ ...value, pageSize: event.target.value as "a4" | "letter" })}><option value="a4">A4</option><option value="letter">US Letter</option></select></label>
      <label className="document-slider-setting"><span>Text size <strong>{layout.fontSize} pt</strong></span><input aria-label="Text size" type="range" min="10.5" max="12.5" step="0.5" value={layout.fontSize} onChange={event => onChange({ ...value, fontSize: Number(event.target.value) })} /><small>Compact <span>Comfortable</span></small></label>
      <label className="document-slider-setting"><span>Page margins <strong>{layout.margin} pt</strong></span><input aria-label="Page margins" type="range" min="40" max="72" step="1" value={layout.margin} onChange={event => onChange({ ...value, margin: Number(event.target.value) })} /><small>Narrow <span>Spacious</span></small></label>
      <label className="document-slider-setting"><span>Line spacing <strong>{layout.lineHeight.toFixed(2)}</strong></span><input aria-label="Line spacing" type="range" min="1.15" max="1.5" step="0.01" value={layout.lineHeight} onChange={event => onChange({ ...value, lineHeight: Number(event.target.value) })} /><small>Tighter <span>More breathing room</span></small></label>
    </div></section>}
  </>;
}

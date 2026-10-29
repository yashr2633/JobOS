"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { createResume, fetchResumes } from "@/lib/api/resumes";
import type { Resume } from "@/lib/ai/types";
import { builderDocument, createLetterDraft, emptyLetter, emptyResume, importResumeText, letterDocument, readWorkspaceDocument, type BuilderResume, type CoverLetter, type DocumentKind, type WorkspaceDocument } from "@/lib/documents/model";
import { formatResumeDocument, resumePlainText } from "@/lib/resume/templates";
import DocumentPreview from "./DocumentPreview";
import FormatControls from "./FormatControls";
import ResumeUploadForm from "../resumes/components/ResumeUploadForm";

type DraftSummary = { id: string; label: string; updatedAt: string };
function blank(kind: DocumentKind): WorkspaceDocument {
  return kind === "resume" ? { version: 1, kind, label: "My resume", formatting: { templateId: "modern-original" }, data: emptyResume() }
    : { version: 1, kind, label: "My cover letter", formatting: { templateId: "minimal-original" }, data: emptyLetter() };
}
async function readResponse(response: Response) {
  const body = await response.json().catch(() => null);
  if (!response.ok || !body) throw new Error(typeof body?.error === "string" ? body.error : "The request could not finish. Keep your edits here and retry.");
  return body;
}

export default function DocumentWorkbench({ kind, initialResumeId, context }: { kind: DocumentKind; initialResumeId?: string; context?: { role: string; company: string; jobDescription: string } }) {
  const [document, setDocument] = useState<WorkspaceDocument>(() => {
    const value = blank(kind);
    return value.kind === "letter" && context ? { ...value, data: { ...value.data, ...context, mode: "tailored" } } : value;
  });
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(document));
  const [draftId, setDraftId] = useState<string | undefined>(), [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null), [draftLoading, setDraftLoading] = useState(true);
  const [library, setLibrary] = useState<Resume[]>([]), [resumeId, setResumeId] = useState(initialResumeId ?? "");
  const [busy, setBusy] = useState<string | null>(null), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [libraryCopy, setLibraryCopy] = useState("");
  const [previewMode, setPreviewMode] = useState<"document" | "text">("document");
  const supabase = useMemo(() => createClient(), []), mounted = useRef(true);
  const dirty = JSON.stringify(document) !== savedSnapshot;
  const model = useMemo(() => document.kind === "resume" ? builderDocument(document.data) : letterDocument(document.data), [document]);
  const text = useMemo(() => resumePlainText(formatResumeDocument(model, document.formatting)), [model, document.formatting]);
  const resume = document.kind === "resume" ? document.data : null, letter = document.kind === "letter" ? document.data : null;
  const updateResume = (change: (value: BuilderResume) => BuilderResume) => setDocument(value => value.kind === "resume" ? { ...value, data: change(value.data) } : value);
  const updateLetter = (change: Partial<CoverLetter>) => setDocument(value => value.kind === "letter" ? { ...value, data: { ...value.data, ...change } } : value);
  function updateContact(field: "name" | "contact", content: string) {
    if (kind === "resume") updateResume(value => ({ ...value, [field]: content }));
    else updateLetter({ [field]: content });
  }
  const loadLibrary = useCallback(async () => {
    try { const values = await fetchResumes(supabase); if (mounted.current) setLibrary(values); }
    catch { if (mounted.current) setError("Your resume library could not load. You can still fill in this document manually; retry uploads before importing."); }
  }, [supabase]);
  const loadDrafts = useCallback(async (offset = 0) => {
    setDraftLoading(true);
    try {
      const body = await readResponse(await fetch(`/api/documents?kind=${kind}&offset=${offset}`, { signal: AbortSignal.timeout(30000), cache: "no-store" }));
      if (!mounted.current) return;
      setDrafts(values => offset ? [...values, ...body.drafts] : body.drafts); setNextOffset(body.nextOffset);
      if (body.warning) setError(body.warning);
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : "Drafts could not load."); }
    finally { if (mounted.current) setDraftLoading(false); }
  }, [kind]);
  useEffect(() => {
    let active = true; mounted.current = true;
    void Promise.allSettled([
      fetchResumes(supabase),
      fetch(`/api/documents?kind=${kind}&offset=0`, { signal: AbortSignal.timeout(30000), cache: "no-store" }).then(readResponse),
    ]).then(([resumes, saved]) => {
      if (!active) return;
      if (resumes.status === "fulfilled") setLibrary(resumes.value);
      if (saved.status === "fulfilled") { setDrafts(saved.value.drafts); setNextOffset(saved.value.nextOffset); if (saved.value.warning) setError(saved.value.warning); }
      if (resumes.status === "rejected" || saved.status === "rejected") setError("Your resume library or saved drafts could not load. Your current edits are safe here; retry before leaving.");
      setDraftLoading(false);
    });
    return () => { active = false; mounted.current = false; };
  }, [kind, supabase]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function mayReplace() { return !dirty || window.confirm("You have unsaved edits. Replace them? Save your draft first if you want to keep them."); }
  function newDraft() {
    if (!mayReplace()) return;
    const value = blank(kind); setDocument(value); setSavedSnapshot(JSON.stringify(value)); setDraftId(undefined); setNotice(null); setError(null); setLibraryCopy("");
  }
  async function openDraft(id: string) {
    if (!id || !mayReplace()) return;
    setBusy("opening"); setError(null);
    try {
      const body = await readResponse(await fetch(`/api/documents?kind=${kind}&id=${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(30000), cache: "no-store" }));
      const value = readWorkspaceDocument(body.document);
      if (!value || value.kind !== kind) throw new Error("This draft could not be read.");
      setDocument(value); setSavedSnapshot(JSON.stringify(value)); setDraftId(id); setNotice("Saved draft opened."); setLibraryCopy("");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Draft could not open."); }
    finally { setBusy(null); }
  }
  async function saveDraft() {
    setBusy("saving"); setError(null); setNotice(null); const snapshot = document;
    try {
      const body = await readResponse(await fetch("/api/documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: draftId, document: snapshot }), signal: AbortSignal.timeout(30000) }));
      setDraftId(body.id); setSavedSnapshot(JSON.stringify(snapshot)); setNotice("Draft saved privately to your account."); void loadDrafts();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Draft was not saved. Keep this page open."); }
    finally { setBusy(null); }
  }
  function importSelected() {
    const selected = library.find(value => value.id === resumeId);
    if (!selected?.extractedText?.trim()) { setError("Choose a resume with readable text, or upload a PDF/DOCX and wait for extraction."); return; }
    if (!mayReplace()) return;
    const imported = importResumeText(selected.extractedText);
    if (document.kind === "resume") { setDocument({ ...document, label: `${selected.label.slice(0, 130)} · edited`, data: imported }); setDraftId(undefined); }
    else updateLetter({ name: imported.name, contact: imported.contact,
      facts: imported.sections.map(section => section.body).join("\n").slice(0, 16000), body: "" });
    setNotice("Resume text imported. Review contact details and section boundaries before saving or exporting."); setError(null);
  }
  async function addToMatch() {
    if (!resume?.name.trim() || !model.sections.some(section => section.blocks.length) || text.length > 60000) { setError("Add your name and resume content first (maximum 60,000 characters)."); return; }
    setBusy("library"); setError(null);
    try { await createResume(supabase, { label: document.label, source: "paste", extractedText: text }); setLibraryCopy(text); setNotice("A copy is now in your Resume Match library. Existing resumes were preserved."); void loadLibrary(); }
    catch { setError("The copy could not be added to Resume Match. Your draft is still here."); }
    finally { setBusy(null); }
  }
  async function exportFile(format: "pdf" | "docx" | "txt") {
    setBusy(format); setError(null);
    try {
      const response = await fetch("/api/documents/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ document, format }), signal: AbortSignal.timeout(45000) });
      if (!response.ok) { await readResponse(response); return; }
      const blob = await response.blob(), url = URL.createObjectURL(blob), anchor = window.document.createElement("a");
      anchor.href = url; anchor.download = response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? `${kind}.${format}`;
      window.document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
      setNotice(`${format.toUpperCase()} downloaded from your current edited content.`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Export did not finish. Keep your edits here and retry."); }
    finally { setBusy(null); }
  }
  function moveSection(index: number, direction: number) {
    setDocument(value => {
      if (value.kind !== "resume") return value;
      const sections = [...value.data.sections], target = index + direction;
      if (target < 0 || target >= sections.length) return value;
      [sections[index], sections[target]] = [sections[target], sections[index]];
      return { ...value, formatting: { ...value.formatting, templateId: (value.formatting.templateId ?? "modern-original").replace(/-(original|experience|graduate|skills|projects)$/, "-original") }, data: { ...value.data, sections } };
    });
  }
  return <div className="document-workbench">
    <header className="product-heading"><div><p className="product-kicker">PREPARE YOUR APPLICATION</p><h1>{kind === "resume" ? "Build a resume that represents you." : "Make your introduction count."}</h1><p className="mt-3 text-sm text-text-secondary">{kind === "resume" ? "Start from a template, customize your sections and export a readable, single-column resume." : "Create a general or job-specific Cover Letter, review the facts, and make it your own."}</p></div></header>
    <div className="document-toolbar"><label className="document-label">Document name<input maxLength={160} value={document.label} onChange={event => setDocument(value => ({ ...value, label: event.target.value }))} /></label><div><button type="button" className="product-button" disabled={busy !== null} onClick={newDraft}>New document</button><button type="button" className="product-button product-button-primary" disabled={busy !== null || !document.label.trim()} onClick={() => void saveDraft()}>{busy === "saving" ? "Saving…" : "Save draft"}</button></div></div>
    <div className="document-saved-row"><label>Saved drafts<select value={draftId ?? ""} disabled={busy !== null || draftLoading} onChange={event => void openDraft(event.target.value)}><option value="">{draftLoading ? "Loading drafts…" : "Choose a saved draft"}</option>{drafts.map(draft => <option key={draft.id} value={draft.id}>{draft.label}</option>)}</select></label>{nextOffset !== null && <button type="button" className="product-button" disabled={draftLoading} onClick={() => void loadDrafts(nextOffset)}>More saved drafts</button>}<span>{dirty ? "Unsaved edits" : draftId ? "Saved" : "New document"}</span></div>
    {error && <div role="alert" className="product-notice product-error">{error}<button type="button" className="ml-3 underline" onClick={() => { setError(null); void loadDrafts(); void loadLibrary(); }}>Retry library / drafts</button></div>}
    {notice && <p role="status" className="product-notice">{notice}</p>}
    <details className="document-import"><summary>Use an existing resume or upload a PDF / DOCX</summary><div className="document-import-row"><label>Saved resume<select value={resumeId} onChange={event => setResumeId(event.target.value)}><option value="">Choose your resume</option>{library.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><button type="button" className="product-button" onClick={importSelected} disabled={busy !== null || !resumeId}>Use selected resume</button></div><ResumeUploadForm onUploaded={loadLibrary} /></details>
    <div className="document-workspace-columns">
      <div className="document-editor">
        <section className="document-editor-panel"><h2>Contact details</h2><label>Your name<input value={document.data.name} maxLength={200} onChange={event => updateContact("name", event.target.value)} placeholder="Full name" /></label>{resume && <label>Professional headline<input maxLength={300} value={resume.headline} onChange={event => updateResume(value => ({ ...value, headline: event.target.value }))} placeholder="e.g. Business Analyst · SQL · Power BI" /></label>}<label>Contact &amp; links<textarea rows={3} maxLength={1500} value={document.data.contact} onChange={event => updateContact("contact", event.target.value)} placeholder="Email · Phone · City&#10;LinkedIn / portfolio URL" /></label></section>
        {resume && <><section className="document-editor-panel"><div className="document-editor-heading"><h2>Your resume sections</h2><button type="button" className="product-button" disabled={resume.sections.length >= 24} onClick={() => updateResume(value => ({ ...value, sections: [...value.sections, { id: crypto.randomUUID(), title: "ADDITIONAL INFORMATION", body: "" }] }))}>+ Add section</button></div><p className="document-help">Use one fact per line. Start a line with “- ” for a bullet. Empty sections stay out of the export.</p>{resume.sections.map((section, index) => <div key={section.id} className="document-section-editor"><div className="document-section-toolbar"><label>Section heading<input value={section.title} maxLength={60} onChange={event => updateResume(value => ({ ...value, sections: value.sections.map(item => item.id === section.id ? { ...item, title: event.target.value } : item) }))} /></label><div><button type="button" disabled={index === 0} aria-label={`Move ${section.title} up`} onClick={() => moveSection(index, -1)}>↑</button><button type="button" disabled={index === resume.sections.length - 1} aria-label={`Move ${section.title} down`} onClick={() => moveSection(index, 1)}>↓</button><button type="button" aria-label={`Remove ${section.title}`} onClick={() => updateResume(value => ({ ...value, sections: value.sections.filter(item => item.id !== section.id) }))}>Remove</button></div></div><label className="sr-only" htmlFor={`section-${section.id}`}>{section.title} content</label><textarea id={`section-${section.id}`} rows={5} maxLength={12000} value={section.body} onChange={event => updateResume(value => ({ ...value, sections: value.sections.map(item => item.id === section.id ? { ...item, body: event.target.value } : item) }))} placeholder={/experience/i.test(section.title) ? "Role — Company | Dates&#10;- Describe work you actually did and its result." : /education/i.test(section.title) ? "Degree — Institution | Dates&#10;Relevant coursework or achievements, if applicable." : /skills/i.test(section.title) ? "Technical: SQL, Excel, Power BI&#10;Add only skills you can support." : "Enter your own details. Nothing is added automatically."} /></div>)}</section><button type="button" className="product-button document-match-copy" disabled={busy !== null || !text || libraryCopy === text} onClick={() => void addToMatch()}>{busy === "library" ? "Adding…" : libraryCopy && libraryCopy === text ? "Added to Resume Match" : "Add a copy to Resume Match"}</button></>}
        {letter && <><section className="document-editor-panel"><h2>Letter details</h2><div className="document-input-grid"><label>Letter type<select value={letter.mode} onChange={event => updateLetter({ mode: event.target.value as CoverLetter["mode"] })}><option value="general">General Cover Letter</option><option value="tailored">Tailored to a role</option></select></label><label>Recipient<input maxLength={250} value={letter.recipient} onChange={event => updateLetter({ recipient: event.target.value })} /></label><label>Role<input maxLength={250} value={letter.role} onChange={event => updateLetter({ role: event.target.value })} placeholder="Role you want to apply for" /></label><label>Company<input maxLength={250} value={letter.company} onChange={event => updateLetter({ company: event.target.value })} placeholder="Company name" /></label><label>Date (optional)<input maxLength={250} value={letter.date} onChange={event => updateLetter({ date: event.target.value })} placeholder="e.g. 30 October 2026" /></label></div>{letter.mode === "tailored" && <label>Job description<textarea rows={6} maxLength={20000} value={letter.jobDescription} onChange={event => updateLetter({ jobDescription: event.target.value })} placeholder="Paste the requirements to prioritize relevant facts from your resume." /></label>}<label>Your supported facts<textarea rows={7} maxLength={16000} value={letter.facts} onChange={event => updateLetter({ facts: event.target.value })} placeholder="One factual experience, project, skill or achievement per line. Import a resume above or enter your own." /></label><label>Why this opportunity? (optional)<textarea rows={3} maxLength={16000} value={letter.motivation} onChange={event => updateLetter({ motivation: event.target.value })} placeholder="Your reason for applying, in your own words." /></label><p className="document-help">The draft prioritizes your entered facts against the JD. It does not add qualifications or call an AI provider.</p><button type="button" className="product-button product-button-primary" disabled={!letter.name.trim() || !letter.facts.trim() || (letter.mode === "tailored" && (!letter.role.trim() || !letter.company.trim() || !letter.jobDescription.trim()))} onClick={() => { if (letter.body.trim() && !window.confirm("Replace your edited letter with a new draft?")) return; updateLetter({ body: createLetterDraft(letter) }); setNotice("Draft created from your inputs. Review the wording and eligibility before sending."); }}>Create {letter.mode === "tailored" ? "tailored" : "general"} draft</button></section><section className="document-editor-panel"><h2>Edit your Cover Letter</h2><label>Letter body<textarea rows={18} maxLength={16000} value={letter.body} onChange={event => updateLetter({ body: event.target.value })} placeholder="Create a draft above, or write your letter here." /></label></section></>}
      </div>
      <aside className="document-preview-column"><FormatControls value={document.formatting} letter={kind === "letter"} onChange={formatting => setDocument(value => ({ ...value, formatting }))} /><section className="document-preview-panel"><div className="document-preview-heading"><h2>Live preview</h2><div><button type="button" aria-pressed={previewMode === "document"} onClick={() => setPreviewMode("document")}>Document</button><button type="button" aria-pressed={previewMode === "text"} onClick={() => setPreviewMode("text")}>Text order</button></div></div>{previewMode === "document" ? <DocumentPreview document={model} formatting={document.formatting} /> : <pre className="document-text-preview">{text || "Your document text appears here."}</pre>}<p className="document-help">Content and section order match the export. Exact pagination can differ in your document viewer.</p><div className="document-export-row"><span>Export current edits</span>{(["docx", "pdf", "txt"] as const).map(format => <button type="button" key={format} className={format === "docx" ? "product-button product-button-primary" : "product-button"} disabled={busy !== null} onClick={() => void exportFile(format)}>{busy === format ? "Preparing…" : format.toUpperCase()}</button>)}</div><p className="document-help">Use DOCX or TXT for non-Latin scripts. Keep this page open until your draft is saved.</p></section><div className="document-cross-link">{kind === "resume" ? <Link href="/cover-letter">Prepare a matching Cover Letter →</Link> : <Link href="/resume-builder">Build or update your resume →</Link>}</div></aside>
    </div>
  </div>;
}

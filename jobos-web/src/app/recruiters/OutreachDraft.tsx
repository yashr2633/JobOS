"use client";

import { useEffect, useRef, useState } from "react";
import { productEvent } from "@/lib/analytics/productClient";
import { createClient } from "@/lib/supabase/client";
import { extractSkills } from "@/lib/jobs/matching";
import {
  buildOutreachDraft,
  createOutreachEmail,
  RESUME_SIZE_LIMIT,
  resumeAttachmentType,
  type OutreachContact,
} from "@/lib/recruiters/draft";

export type { OutreachContact } from "@/lib/recruiters/draft";
type SavedResume = { id: string; label: string; file_name: string; file_path: string; is_default: boolean };

const field = "rounded-lg border border-border bg-surface p-3";
const label = "grid gap-1 text-sm font-medium";

function download(file: Blob, name: string) {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export default function OutreachDraft({ contact }: { contact: OutreachContact }) {
  const [role, setRole] = useState("");
  const [name, setName] = useState("");
  const [draft, setDraft] = useState({ subject: "", message: "" });
  const [saved, setSaved] = useState<SavedResume[]>([]);
  const [savedId, setSavedId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [notice, setNotice] = useState("");
  const [resumeError, setResumeError] = useState("");
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [loadingResumes, setLoadingResumes] = useState(true);
  const roleInput = useRef<HTMLInputElement>(null);
  const changedResume = useRef(false);
  const selected = saved.find(item => item.id === savedId);
  const attachmentName = file?.name ?? selected?.file_name;
  const ready = !!draft.subject.trim() && !!draft.message.trim();

  useEffect(() => {
    roleInput.current?.focus();
    let active = true;
    const client = createClient();
    async function load() {
      try {
        const { data: { user } } = await client.auth.getUser();
        if (!user || !active) return;
        const name = user.user_metadata?.full_name ?? user.user_metadata?.name;
        if (typeof name === "string") setName(name.trim().slice(0, 100));
        const { data, error } = await client.from("resumes")
          .select("id,label,file_name,file_path,is_default")
          .eq("user_id", user.id).not("file_path", "is", null)
          .order("is_default", { ascending: false }).order("created_at", { ascending: false });
        if (error) throw error;
        if (!active) return;
        const available = (data ?? []).filter((item): item is SavedResume => (
          typeof item.file_name === "string" && typeof item.file_path === "string" &&
          item.file_path.startsWith(user.id + "/") && !!resumeAttachmentType(item.file_name)
        ));
        setSaved(available);
        if (!changedResume.current) setSavedId(available[0]?.id ?? "");
      } catch {
        if (active) setResumeError("Saved resumes could not load. You can still choose a file.");
      } finally {
        if (active) setLoadingResumes(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [contact]);

  async function regenerate() {
    if (!role.trim() || generating) return;
    setGenerating(true);
    setNotice("");
    let skills: string[] = [];
    if (selected) {
      try {
        const { data, error } = await createClient().from("resumes").select("extracted_text")
          .eq("id", selected.id).abortSignal(AbortSignal.timeout(3500)).maybeSingle();
        if (!error && data?.extracted_text) {
          const found = extractSkills(data.extracted_text.slice(0, 30000));
          const preferred = /\b(data|analytics|reporting)\b/i.test(role) ? ["SQL", "Power BI", "Excel", "Tableau", "Python", "Data Analysis"] : extractSkills(role);
          skills = [...new Set([...preferred.filter(skill => found.includes(skill)), ...found])].slice(0, 3);
        }
      } catch { /* The draft remains usable when resume text is unavailable. */ }
    }
    setDraft(buildOutreachDraft(contact, role, name, skills));
    setGenerating(false);
    productEvent("outreach_draft_created");
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText("To: " + contact.email + "\nSubject: " + draft.subject + "\n\n" + draft.message);
      setNotice(attachmentName ? "Text copied. Attach the selected resume in your mail app." : "Draft copied.");
    } catch {
      setNotice("You can select and copy the subject and message above.");
    }
  }

  async function getResume() {
    if (file) return file;
    if (!selected) throw new Error("Choose a resume first.");
    const { data, error } = await createClient().storage.from("resumes").download(selected.file_path);
    const type = resumeAttachmentType(selected.file_name);
    if (error || !data || !type) throw new Error("The saved resume could not open. Try choosing a file instead.");
    if (data.size === 0 || data.size > RESUME_SIZE_LIMIT) throw new Error("Choose a PDF or DOCX resume up to 10 MB.");
    return new File([data], selected.file_name, { type });
  }

  async function exportFile(asDraft: boolean) {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      const resume = await getResume();
      if (asDraft) {
        const email = await createOutreachEmail(contact.email, draft.subject, draft.message, resume);
        download(email, "jobtrackos-recruiter-draft.eml");
        setNotice("Email file downloaded with your resume attached.");
      } else {
        download(resume, resume.name);
        setNotice("Resume downloaded. Use the paperclip in Gmail to attach it.");
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The download failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const gmail = new URL("https://mail.google.com/mail/");
  gmail.search = new URLSearchParams({ view: "cm", fs: "1", to: contact.email, su: draft.subject, body: draft.message }).toString();

  return (
    <section aria-labelledby="recruiter-draft-title" className="grid gap-3">
      <h2 id="recruiter-draft-title" className="text-xl font-semibold">Draft an email</h2>
      <p className="text-sm text-text-secondary break-all">To {contact.name || contact.company} · {contact.email}</p>
      <form className="grid items-end gap-2 sm:grid-cols-[1fr_auto]" onSubmit={event => { event.preventDefault(); void regenerate(); }}>
        <label className={label}>Target role<input ref={roleInput} className={field} value={role} maxLength={80} required onChange={event => setRole(event.target.value)} placeholder="e.g. Data Analyst" /></label>
        <button type="submit" disabled={generating || !role.trim()} className="product-button product-button-primary">{generating ? "Preparing…" : draft.subject ? "Update draft" : "Generate draft"}</button>
      </form>
      <div className="grid gap-3">
        <fieldset className="grid gap-2 rounded-lg border border-border p-3">
          <legend className="px-1 text-sm font-semibold">Resume attachment</legend>
          {saved.length > 0 && <label className={label}>Saved resume<select className={field} value={savedId} onChange={event => { changedResume.current = true; setSavedId(event.target.value); setFile(null); setNotice(""); }}><option value="">None selected</option>{saved.map(item => <option key={item.id} value={item.id}>{item.label || item.file_name}{item.is_default ? " (default)" : ""}</option>)}</select></label>}
          <label className={label}>Choose a PDF or DOCX (up to 10 MB)<input type="file" accept=".pdf,.docx" onChange={event => {
            const chosen = event.target.files?.[0];
            event.target.value = "";
            if (!chosen) return;
            if (!resumeAttachmentType(chosen.name) || chosen.size === 0 || chosen.size > RESUME_SIZE_LIMIT) {
              setNotice("Choose a PDF or DOCX resume up to 10 MB.");
              return;
            }
            changedResume.current = true;
            setFile(chosen);
            setSavedId("");
            setNotice("");
          }} /></label>
          {attachmentName && <div className="flex flex-wrap items-center gap-3"><span className="text-sm break-all">{attachmentName}</span><button type="button" className="product-button" onClick={() => { changedResume.current = true; setFile(null); setSavedId(""); setNotice(""); }}>Remove</button></div>}
          {loadingResumes && <p role="status" className="text-sm text-text-secondary">Checking saved resumes…</p>}
          {resumeError && <p className="text-sm text-text-secondary">{resumeError}</p>}
        </fieldset>
        {(draft.subject || draft.message) && <>
          <label className={label}>Subject<input className={field} value={draft.subject} maxLength={280} onChange={event => setDraft({ ...draft, subject: event.target.value })} /></label>
          <label className={label}>Message<textarea className={field} rows={7} value={draft.message} maxLength={3000} onChange={event => setDraft({ ...draft, message: event.target.value })} /></label>
          {attachmentName && <p className="text-xs text-text-secondary">The email download includes the resume. In Gmail, attach it with the paperclip.</p>}
        <div className="flex flex-wrap gap-2">
          {ready && <a className="product-button product-button-primary" href={gmail.href} onClick={() => productEvent("mail_composer_open")} target="_blank" rel="noopener noreferrer">Open in Gmail</a>}
          <button className="product-button" type="button" disabled={!ready} onClick={() => void copy()}>Copy draft</button>
          {attachmentName && <button className="product-button" type="button" disabled={busy || !ready} onClick={() => void exportFile(true)}>Download draft with resume</button>}
          {selected && <button className="product-button" type="button" disabled={busy} onClick={() => void exportFile(false)}>Download resume for Gmail</button>}
        </div>
        </>}
        {notice && <p className="text-sm text-text-muted" role="status">{notice}</p>}
      </div>
    </section>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { productEvent } from "@/lib/analytics/productClient";
import { createClient } from "@/lib/supabase/client";
import {
  buildOutreachDraft,
  createOutreachEmail,
  RESUME_SIZE_LIMIT,
  resumeAttachmentType,
  type DraftDetails,
  type OutreachContact,
} from "@/lib/recruiters/draft";

export type { OutreachContact } from "@/lib/recruiters/draft";
type SavedResume = { id: string; label: string; file_name: string; file_path: string; is_default: boolean };

const emptyDetails: DraftDetails = { role: "", vacancy: true, requirement: "", evidence: "", name: "", portfolio: "" };
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
  const [details, setDetails] = useState(emptyDetails);
  const [draft, setDraft] = useState(() => buildOutreachDraft(contact, emptyDetails));
  const [saved, setSaved] = useState<SavedResume[]>([]);
  const [savedId, setSavedId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [notice, setNotice] = useState("");
  const [resumeError, setResumeError] = useState("");
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const selected = saved.find(item => item.id === savedId);
  const attachmentName = file?.name ?? selected?.file_name;
  const ready = !!draft.subject.trim() && !!draft.message.trim() && !/\[[^\]\n]+\]/.test(draft.subject + draft.message);
  const message = attachmentName
    ? draft.message.replace(/\n\nThank you,\n/, "\n\nI’ve included my resume for your review.\n\nThank you,\n")
    : draft.message;

  useEffect(() => {
    heading.current?.focus();
    let active = true;
    const client = createClient();
    async function load() {
      try {
        const { data: { user } } = await client.auth.getUser();
        if (!user || !active) return;
        const name = user.user_metadata?.full_name ?? user.user_metadata?.name;
        if (typeof name === "string" && name.trim()) {
          const value = name.trim().slice(0, 100);
          setDetails(previous => ({ ...previous, name: previous.name || value }));
          const starter = buildOutreachDraft(contact, emptyDetails);
          setDraft(previous => previous.subject === starter.subject && previous.message === starter.message
            ? buildOutreachDraft(contact, { ...emptyDetails, name: value })
            : previous);
        }
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
        setSavedId(previous => previous || available.find(item => item.is_default)?.id || "");
      } catch {
        if (active) setResumeError("Saved resumes could not load. You can still choose a file.");
      }
    }
    void load();
    return () => { active = false; };
  }, [contact]);

  function update<K extends keyof DraftDetails>(key: K, value: DraftDetails[K]) {
    setDetails(previous => ({ ...previous, [key]: value }));
  }

  function regenerate() {
    setDraft(buildOutreachDraft(contact, details));
    setNotice("Draft updated. Review the subject and message below.");
    productEvent("outreach_draft_created");
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText("To: " + contact.email + "\nSubject: " + draft.subject + "\n\n" + message);
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
        const email = await createOutreachEmail(contact.email, draft.subject, message, resume);
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
  gmail.search = new URLSearchParams({ view: "cm", fs: "1", to: contact.email, su: draft.subject, body: message }).toString();

  return (
    <section className="product-panel mb-6" aria-labelledby="recruiter-draft-title">
      <h2 ref={heading} tabIndex={-1} id="recruiter-draft-title">Draft an email</h2>
      <p className="mt-2 text-sm text-text-secondary">To {contact.name || contact.company} · {contact.email}</p>
      <form className="mt-4 grid gap-3" onSubmit={event => { event.preventDefault(); regenerate(); }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={label}>Target role<input className={field} value={details.role} maxLength={80} onChange={event => update("role", event.target.value)} placeholder="e.g. Data Analyst" /></label>
          <label className={label}>Purpose<select className={field} value={details.vacancy ? "application" : "enquiry"} onChange={event => update("vacancy", event.target.value === "application")}><option value="application">Apply to a listed opening</option><option value="enquiry">Ask about relevant openings</option></select></label>
        </div>
        <label className={label}>Why this role?<textarea className={field} rows={2} maxLength={350} value={details.requirement} onChange={event => update("requirement", event.target.value)} placeholder="e.g. I’m drawn to the role’s focus on turning sales data into decisions for the merchandising team." /></label>
        <label className={label}>Relevant project or achievement<textarea className={field} rows={3} maxLength={650} value={details.evidence} onChange={event => update("evidence", event.target.value)} placeholder="e.g. In my internship, I used SQL to analyse sales data and built a Power BI dashboard that showed which products drove repeat purchases." /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={label}>Your name<input className={field} maxLength={100} value={details.name} onChange={event => update("name", event.target.value)} /></label>
          <label className={label}>Portfolio or work sample link (optional)<input type="url" className={field} maxLength={280} value={details.portfolio} onChange={event => update("portfolio", event.target.value)} placeholder="https://…" /></label>
        </div>
        <button type="submit" className="product-button product-button-primary justify-self-start">Update draft</button>
      </form>
      <div className="mt-4 grid gap-3">
        <label className={label}>Subject<input className={field} value={draft.subject} maxLength={280} onChange={event => setDraft({ ...draft, subject: event.target.value })} /></label>
        <label className={label}>Message<textarea className={field} rows={10} value={draft.message} maxLength={3000} onChange={event => setDraft({ ...draft, message: event.target.value })} /></label>
        <fieldset className="grid gap-2 rounded-lg border border-border p-3">
          <legend className="px-1 text-sm font-semibold">Resume attachment</legend>
          {saved.length > 0 && <label className={label}>Saved resume<select className={field} value={savedId} onChange={event => { setSavedId(event.target.value); setFile(null); setNotice(""); }}><option value="">None selected</option>{saved.map(item => <option key={item.id} value={item.id}>{item.label || item.file_name}{item.is_default ? " (default)" : ""}</option>)}</select></label>}
          <label className={label}>Choose a PDF or DOCX (up to 10 MB)<input type="file" accept=".pdf,.docx" onChange={event => {
            const chosen = event.target.files?.[0];
            event.target.value = "";
            if (!chosen) return;
            if (!resumeAttachmentType(chosen.name) || chosen.size === 0 || chosen.size > RESUME_SIZE_LIMIT) {
              setNotice("Choose a PDF or DOCX resume up to 10 MB.");
              return;
            }
            setFile(chosen);
            setSavedId("");
            setNotice("");
          }} /></label>
          {attachmentName && <div className="flex flex-wrap items-center gap-3"><span className="text-sm break-all">{attachmentName}</span><button type="button" className="product-button" onClick={() => { setFile(null); setSavedId(""); setNotice(""); }}>Remove</button></div>}
          {resumeError && <p className="text-sm text-text-secondary">{resumeError}</p>}
        </fieldset>
        {!ready && <p className="text-sm text-text-secondary">Complete the bracketed details to copy or open the draft.</p>}
        {attachmentName && <p className="text-sm text-text-secondary">Download the email draft to include the attachment. In Gmail, use the paperclip to add the selected file.</p>}
        <div className="flex flex-wrap gap-2">
          {ready && <a className="product-button product-button-primary" href={gmail.href} onClick={() => productEvent("mail_composer_open")} target="_blank" rel="noopener noreferrer">Open in Gmail</a>}
          <button className="product-button" type="button" disabled={!ready} onClick={() => void copy()}>Copy draft</button>
          {attachmentName && <button className="product-button" type="button" disabled={busy || !ready} onClick={() => void exportFile(true)}>Download draft with resume</button>}
          {selected && <button className="product-button" type="button" disabled={busy} onClick={() => void exportFile(false)}>Download resume for Gmail</button>}
        </div>
        <p className="text-sm text-text-muted" role="status">{notice || "Review the email before sending it from your own account."}</p>
      </div>
    </section>
  );
}

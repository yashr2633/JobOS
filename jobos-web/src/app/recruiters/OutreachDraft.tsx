"use client";

import { useEffect, useRef, useState } from "react";
import { productEvent } from "@/lib/analytics/productClient";

export type OutreachContact = { name: string | null; company: string; email: string };

function makeDraft(contact: OutreachContact, role: string, evidence: string) {
  const firstName = contact.name?.trim().split(/\s+/)[0];
  const target = role.trim();
  const proof = evidence.trim();
  return {
    subject: (target ? target : "Career opportunities") + " at " + contact.company,
    message: (firstName ? "Hi " + firstName + "," : "Hello,") + "\n\n" +
      "I’m interested in " + (target ? target + " roles" : "opportunities") + " at " + contact.company + ".\n\n" +
      (proof ? proof + "\n\n" : "") +
      "Could you point me to an opening that might fit? I’d be happy to share my resume.\n\nThank you,",
  };
}

export default function OutreachDraft({ contact }: { contact: OutreachContact }) {
  const [role, setRole] = useState("");
  const [evidence, setEvidence] = useState("");
  const [emailDraft, setEmailDraft] = useState(() => makeDraft(contact, "", ""));
  const { subject, message } = emailDraft;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const [copyStatus, setCopyStatus] = useState("");
  const ready = !!subject.trim() && !!message.trim();

  function draft() {
    productEvent("outreach_draft_created");
    setEmailDraft(makeDraft(contact, role, evidence));
    setCopyStatus("");
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(`To: ${contact.email}\nSubject: ${subject}\n\n${message}`);
      setCopyStatus("Draft copied.");
    } catch {
      setCopyStatus("Copy the subject and message from the fields above.");
    }
  }

  const gmail = new URL("https://mail.google.com/mail/");
  gmail.search = new URLSearchParams({ view: "cm", fs: "1", to: contact.email, su: subject, body: message }).toString();

  return (
    <section className="product-panel mb-6" aria-labelledby="recruiter-draft-title">
      <h2 ref={heading} tabIndex={-1} id="recruiter-draft-title">Draft an email</h2>
      <p className="mt-2 text-sm text-text-secondary">To {contact.name || contact.company} · {contact.email}</p>
      <p className="mt-2 text-sm leading-7 text-text-secondary">Your draft is ready below. Add a target role and one real achievement to personalize it, then review before sending.</p>
      <form className="mt-4 grid gap-3" onSubmit={event => { event.preventDefault(); draft(); }}>
        <label className="grid gap-1 text-sm font-medium">Target role<input className="rounded-lg border border-border bg-surface p-3" value={role} maxLength={80} onChange={event => setRole(event.target.value)} placeholder="e.g. Business Analyst" /></label>
        <label className="grid gap-1 text-sm font-medium">A relevant achievement or skill<textarea className="rounded-lg border border-border bg-surface p-3" rows={2} value={evidence} maxLength={350} onChange={event => setEvidence(event.target.value)} placeholder="Use an example from your resume" /></label>
        <button type="submit" className="product-button product-button-primary justify-self-start">Update draft</button>
      </form>
      {(
        <div className="mt-4 grid gap-3">
          <label className="grid gap-1 text-sm font-medium">Subject<input className="rounded-lg border border-border bg-surface p-3" value={subject} maxLength={280} onChange={event => setEmailDraft({ ...emailDraft, subject: event.target.value })} /></label>
          <label className="grid gap-1 text-sm font-medium">Message<textarea className="rounded-lg border border-border bg-surface p-3" rows={8} value={message} maxLength={2000} onChange={event => setEmailDraft({ ...emailDraft, message: event.target.value })} /></label>
          <div className="flex flex-wrap gap-2">
            {ready && <a className="product-button product-button-primary" href={gmail.href} onClick={() => productEvent("mail_composer_open")} target="_blank" rel="noopener noreferrer">Open in Gmail</a>}
            <button className="product-button" type="button" disabled={!ready} onClick={() => void copy()}>Copy draft</button>
          </div>
          <p className="text-sm text-text-muted" role="status">{copyStatus || "Review the draft and send from your own account."}</p>
        </div>
      )}
    </section>
  );
}

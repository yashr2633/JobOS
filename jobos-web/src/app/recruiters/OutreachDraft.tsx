"use client";

import { useState } from "react";

type Contact = { name: string | null; company: string; email: string };

export default function OutreachDraft({ contact }: { contact: Contact }) {
  const [role, setRole] = useState("");
  const [evidence, setEvidence] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const ready = !!subject.trim() && !!message.trim();

  function draft() {
    const greeting = contact.name ? `Hi ${contact.name.split(/\s+/)[0]},` : "Hello,";
    const relevantEvidence = evidence.trim();
    setSubject(`${role.trim()} opportunities at ${contact.company}`);
    setMessage(
      `${greeting}\n\nI’m exploring ${role.trim()} opportunities at ${contact.company}.\n\n` +
      (relevantEvidence ? `${relevantEvidence}\n\n` : "") +
      "If your team has a suitable opening, could you point me to the right listing?\n\nThank you,",
    );
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
      <h2 id="recruiter-draft-title">Draft an email</h2>
      <p className="mt-2 text-sm text-text-secondary">To {contact.name || contact.company} · {contact.email}</p>
      <form className="mt-4 grid gap-3" onSubmit={event => { event.preventDefault(); if (role.trim()) draft(); }}>
        <label className="grid gap-1 text-sm font-medium">Target role<input className="rounded-lg border border-border bg-surface p-3" value={role} maxLength={80} required onChange={event => setRole(event.target.value)} placeholder="e.g. Business Analyst" /></label>
        <label className="grid gap-1 text-sm font-medium">A relevant achievement or skill<textarea className="rounded-lg border border-border bg-surface p-3" rows={2} value={evidence} maxLength={350} onChange={event => setEvidence(event.target.value)} placeholder="Use an example from your resume" /></label>
        <button type="submit" className="p-outline justify-self-start">Generate draft</button>
      </form>
      {subject && (
        <div className="mt-4 grid gap-3">
          <label className="grid gap-1 text-sm font-medium">Subject<input className="rounded-lg border border-border bg-surface p-3" value={subject} maxLength={280} onChange={event => setSubject(event.target.value)} /></label>
          <label className="grid gap-1 text-sm font-medium">Message<textarea className="rounded-lg border border-border bg-surface p-3" rows={8} value={message} maxLength={2000} onChange={event => setMessage(event.target.value)} /></label>
          <div className="flex flex-wrap gap-2">
            {ready && <a className="p-primary" href={gmail.href} target="_blank" rel="noopener noreferrer">Open in Gmail</a>}
            <button className="p-outline" type="button" disabled={!ready} onClick={() => void copy()}>Copy draft</button>
          </div>
          <p className="text-sm text-text-muted" role="status">{copyStatus || "Review the draft and send from your own account."}</p>
        </div>
      )}
    </section>
  );
}

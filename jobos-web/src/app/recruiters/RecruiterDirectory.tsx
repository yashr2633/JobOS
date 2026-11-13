"use client";

import OutreachDraft, { type OutreachContact } from "./OutreachDraft";
import { useEffect, useRef, useState } from "react";
import { ProUpgradeButton } from "../components/ProUpgrade";

export interface DirectoryContact {
  id: string;
  name: string | null;
  company: string;
  title: string | null;
  location: string | null;
}

export default function RecruiterDirectory({ initialContacts, total, query, pro, nextPage: initialNextPage }: {
  initialContacts: DirectoryContact[]; total: number; query: string; pro: boolean; nextPage: number | null;
}) {
  const [contacts, setContacts] = useState(initialContacts);
  const [count, setCount] = useState(total);
  const [nextPage, setNextPage] = useState(initialNextPage);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const loading = useRef(false);
  const [draft, setDraft] = useState<{ id: string; contact?: OutreachContact; error?: string } | null>(null);
  const draftRequest = useRef(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const draftOpen = draft !== null;

  useEffect(() => {
    const modal = dialog.current;
    if (draftOpen && modal && !modal.open) modal.showModal();
  }, [draftOpen]);

  function closeDraft() {
    draftRequest.current++;
    setDraft(null);
  }

  async function loadMore() {
    if (loading.current || nextPage === null) return;
    loading.current = true; setBusy(true); setError("");
    try {
      const params = new URLSearchParams({ q: query, page: String(nextPage) });
      const response = await fetch(`/api/recruiters?${params}`, { cache: "no-store", signal: AbortSignal.timeout(15000) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(body.contacts)) throw new Error(body.error || "More contacts could not load. Please retry.");
      setContacts(previous => {
        const seen = new Set(previous.map(contact => contact.id));
        return [...previous, ...body.contacts.filter((contact: DirectoryContact) => !seen.has(contact.id))];
      });
      setCount(body.count); setNextPage(body.nextPage);
    } catch (error) { setError(error instanceof Error && !["TimeoutError", "AbortError", "TypeError"].includes(error.name) ? error.message : "More contacts could not load. Please retry."); }
    finally { loading.current = false; setBusy(false); }
  }

  async function openDraft(id: string) {
    const request = ++draftRequest.current;
    setDraft({ id });
    try {
      const params = new URLSearchParams({ contact: id });
      const response = await fetch("/api/recruiters?" + params, { cache: "no-store", signal: AbortSignal.timeout(15000) });
      const body = await response.json();
      if (!response.ok || !body.contact?.email) throw new Error(body.error || "The draft could not open. Please try again.");
      if (request === draftRequest.current) setDraft({ id, contact: body.contact });
    } catch (failure) {
      const message = failure instanceof Error && failure.name === "Error" ? failure.message : "The draft could not open. Please try again.";
      if (request === draftRequest.current) setDraft({ id, error: message });
    }
  }

  return <div aria-busy={busy}>
    {draft && <dialog ref={dialog} className="recruiter-draft-dialog" aria-label="Recruiter email draft" onCancel={closeDraft} onClose={closeDraft} onClick={event => { if (event.target === event.currentTarget) closeDraft(); }}>
      <div className="recruiter-draft-content">
        <div className="flex justify-end"><button type="button" className="product-button" onClick={closeDraft}>Close</button></div>
        {draft.contact ? <OutreachDraft key={draft.id} contact={draft.contact} /> : draft.error ? <div className="grid gap-2"><p role="alert">{draft.error}</p><button type="button" className="product-button justify-self-start" onClick={() => void openDraft(draft.id)}>Try again</button></div> : <p role="status">Opening draft…</p>}
      </div>
    </dialog>}
    {!contacts.length ? <p className="text-sm text-text-secondary">{query ? "No published contacts match this search. Try another name or company." : "No recruiter contacts have been published yet."}</p> : <div className="grid gap-3">
      {contacts.map(item => <div key={item.id}><article className="recruiter-contact-row">
        <div><h3>{item.name || item.company}</h3><p>{[item.name && item.company, item.title, item.location].filter(Boolean).join(" · ")}</p></div>
        {pro ? <button type="button" className="product-button" aria-haspopup="dialog" disabled={draft?.id === item.id && !draft.contact && !draft.error} onClick={() => void openDraft(item.id)}>{draft?.id === item.id && !draft.contact && !draft.error ? "Opening draft…" : "View email & draft →"}</button> : <div className="recruiter-email-lock"><span className="recruiter-email-label">Work email <span className="pro-tag">Pro</span></span><span className="recruiter-email-placeholder" aria-hidden="true">name@company.com</span><ProUpgradeButton label="Unlock email →" reason="Unlock recruiter work emails and prepare a personal introduction." className="recruiter-unlock-button" /></div>}
      </article>
      </div>)}
    </div>}
    {!!contacts.length && <div className="recruiter-load-more"><p aria-live="polite">Showing <strong>{contacts.length.toLocaleString("en-IN")}</strong> of {count.toLocaleString("en-IN")} contacts</p>
      {nextPage !== null ? <button type="button" className="product-button product-button-primary" disabled={busy} onClick={() => void loadMore()}>{busy ? "Loading contacts…" : "Load more recruiters ↓"}</button> : <span className="text-sm text-text-secondary">All matching contacts loaded</span>}
    </div>}
    {error && <p role="status" className="product-notice mt-3">{error} Your loaded contacts are still here.</p>}
  </div>;
}

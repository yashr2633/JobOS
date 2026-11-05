"use client";

import Link from "next/link";
import { useRef, useState } from "react";

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

  function contactHref(id: string) {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    params.set("contact", id);
    return `/recruiters?${params}#recruiter-draft-title`;
  }

  return <div aria-busy={busy}>
    {!contacts.length ? <p className="text-sm text-text-secondary">{query ? "No published contacts match this search. Try another name or company." : "No recruiter contacts have been published yet."}</p> : <div className="grid gap-3">
      {contacts.map(item => <article key={item.id} className="recruiter-contact-row">
        <div><h3>{item.name || item.company}</h3><p>{[item.name && item.company, item.title, item.location].filter(Boolean).join(" · ")}</p></div>
        {pro ? <Link className="product-button" href={contactHref(item.id)}>View email &amp; draft →</Link> : <div className="recruiter-email-lock"><span><span aria-hidden="true" className="mr-2 select-none blur-[2px]">••••••••@••••••••</span>Email · Pro</span><Link href="/plans">Unlock email →</Link></div>}
      </article>)}
    </div>}
    {!!contacts.length && <div className="recruiter-load-more"><p aria-live="polite">Showing <strong>{contacts.length.toLocaleString("en-IN")}</strong> of {count.toLocaleString("en-IN")} contacts</p>
      {nextPage !== null ? <button type="button" className="product-button product-button-primary" disabled={busy} onClick={() => void loadMore()}>{busy ? "Loading contacts…" : "Load more recruiters ↓"}</button> : <span className="text-sm text-text-secondary">All matching contacts loaded</span>}
    </div>}
    {error && <p role="status" className="product-notice mt-3">{error} Your loaded contacts are still here.</p>}
  </div>;
}

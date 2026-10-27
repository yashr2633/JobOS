"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { publicSearchLink, safeSearchSuggestions, type WebSearchResult } from "@/lib/jobs/webSearchContract";
import { buttonClass } from "./CareerProfileForm";

function inline(text: string): ReactNode[] {
  return text.split(/(\[[^\]]+\]\(https:\/\/[^\s)]+\)|\*\*[^*]+\*\*)/g).map((part, index) => {
    const link = part.match(/^\[([^\]]+)\]\((https:\/\/[^\s)]+)\)$/);
    if (link && publicSearchLink(link[2])) return <a key={index} href={link[2]} target="_blank" rel="noopener noreferrer" className="break-words font-medium text-accent underline underline-offset-2">{link[1]}</a>;
    return part.startsWith("**") && part.endsWith("**") ? <strong key={index}>{part.slice(2, -2)}</strong> : <span key={index}>{part}</span>;
  });
}
function SearchSuggestions({ html }: { html: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current || !safeSearchSuggestions(html)) return;
    // Shadow DOM scopes Google's original styles without changing its supplied
    // markup or framing the result. No scripts, handlers or embedded resources.
    const shadow = host.current.shadowRoot ?? host.current.attachShadow({ mode: "open" });
    shadow.innerHTML = html;
    return () => { shadow.replaceChildren(); };
  }, [html]);
  return <div ref={host} aria-label="Google Search suggestions" className="mt-5 min-w-0 max-w-full" style={{ contain: "content" }} />;
}
function GroundedText({ result }: { result: WebSearchResult }) {
  let offset = 0;
  return result.text.split("\n").map((line, index) => {
    const start = offset, end = start + line.length; offset = end + 1;
    const sources = [...new Set(result.citations.filter(citation => citation.start < end && citation.end > start).flatMap(citation => citation.sourceIndexes))];
    const links = sources.map(sourceIndex => {
      const source = result.sources[sourceIndex];
      return source ? <a key={sourceIndex} href={source.url} title={source.title} aria-label={`Source ${sourceIndex + 1}: ${source.title}`} target="_blank" rel="noopener noreferrer" className="ml-1 whitespace-nowrap text-xs font-semibold text-accent underline">[{sourceIndex + 1}]</a> : null;
    });
    if (/^#{1,4}\s/.test(line)) return <h4 key={index} className="mb-2 mt-5 font-semibold text-text">{inline(line.replace(/^#{1,4}\s+/, ""))}{links}</h4>;
    return line.trim() ? <p key={index} className="mb-3 break-words">{inline(line)}{links}</p> : <div key={index} className="h-2" />;
  });
}
export default function WebJobSearch({ keywords, location, automatic = false, requestKey = 0 }: { keywords: string; location: string; automatic?: boolean; requestKey?: number }) {
  const [result, setResult] = useState<WebSearchResult | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  const search = useCallback(async () => {
    if (pending.current && !pending.current.signal.aborted) return;
    const controller = new AbortController(); pending.current = controller;
    setBusy(true); setError(null); setResult(null);
    try {
      const response = await fetch("/api/jobs/web-search", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keywords, location: location.trim() || "India" }), signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Web search is unavailable. Please retry.");
      if (!controller.signal.aborted) setResult(data);
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not complete web search."); }
    finally { if (pending.current === controller) { pending.current = null; if (!controller.signal.aborted) setBusy(false); } }
  }, [keywords, location]);
  useEffect(() => {
    if (!automatic || !keywords.trim()) return;
    // A queued start avoids duplicate calls during React's development replay.
    const timer = setTimeout(() => void search(), 0);
    return () => { clearTimeout(timer); pending.current?.abort(); pending.current = null; };
  }, [automatic, keywords, search, requestKey]);
  useEffect(() => () => pending.current?.abort(), []);
  return <section aria-label={automatic ? "Career Assistant additional source results" : "Search the public web for jobs"} className="mb-5 rounded-xl border border-border bg-surface p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-4"><div className="min-w-0 flex-1"><h2 className="text-sm font-semibold">{automatic ? "Career Assistant · Additional sources" : "Find opportunities beyond these employers"}</h2><p className="mt-1 text-xs leading-5 text-text-secondary">{automatic ? "Your search also checks public hiring pages beyond the connected feeds." : `Search public hiring pages for ${keywords || "jobs"} in ${location || "India"}.`} Open the original source to check details and apply.</p></div>{!automatic && <button type="button" disabled={busy} onClick={() => void search()} className={buttonClass + " shrink-0 border-accent/30 text-accent"}>{busy ? "Searching sources…" : "Search the web ↗"}</button>}</div>
    <p className="mt-2 text-[11px] leading-5 text-text-muted">Powered by Google Search. Only these keywords and location are sent; your resume and profile are not sent.</p>
    {busy && <p role="status" className="mt-4 text-sm text-text-secondary">Looking across public job platforms and employer pages…</p>}
    {error && <p role="alert" className="mt-4 rounded-md bg-warning-bg p-3 text-sm text-warning">{error}</p>}
    {result && <div className="mt-5 border-t border-border pt-5">
      <h3 className="text-base font-semibold">Public web search results</h3><p className="mb-4 mt-1 text-xs leading-5 text-text-muted">Search leads, not independently verified vacancies. Dates, availability and application instructions must be checked on the source. These results are separate from the employer-feed count.</p>
      <article aria-label="Google-grounded search response" className="min-w-0 text-sm leading-7 text-text-secondary"><GroundedText result={result} /></article>
      <nav aria-label="Sources provided with the search response" className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs">{result.sources.map((source, index) => <a key={`${source.url}:${index}`} href={source.url} target="_blank" rel="noopener noreferrer" className="break-words text-accent underline">{source.title}</a>)}</nav>
      <SearchSuggestions html={result.suggestionsHtml} />
    </div>}
  </section>;
}

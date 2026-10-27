"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { publicSearchLink, safeSearchSuggestions, validWebSearchResult, type WebSearchResult } from "@/lib/jobs/webSearchContract";
import { readJobJson } from "@/lib/jobs/response";
import { buttonClass } from "./CareerProfileForm";

// Request metadata only, never a cached grounded response. Once Google reports
// quota exhaustion, changing a role/city must not automatically spend retries.
let providerPause: { until: number; message: string } | null = null;

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
export default function WebJobSearch({ keywords, location, automatic = false, requestKey = 0, embedded = false }: { keywords: string; location: string; automatic?: boolean; requestKey?: number; embedded?: boolean }) {
  const [result, setResult] = useState<WebSearchResult | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  const search = useCallback(async (automaticAttempt = false) => {
    if (pending.current && !pending.current.signal.aborted) return;
    if (automaticAttempt && providerPause && Date.now() < providerPause.until) { setResult(null); setError(providerPause.message); return; }
    const controller = new AbortController(); pending.current = controller;
    const timer = setTimeout(() => controller.abort("timeout"), 55000);
    setBusy(true); setError(null); setResult(null);
    try {
      const response = await fetch("/api/jobs/web-search", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keywords, location: location.trim() || "India" }), signal: controller.signal });
      const data = await readJobJson<WebSearchResult & { error?: string }>(response, "Additional hiring sources are temporarily unavailable. Employer listings below remain available.");
      if (response.status === 429) {
        const seconds = Number(response.headers.get("Retry-After")), delay = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 86400) : 60;
        providerPause = { until: Date.now() + delay * 1000, message: data.error ?? "Additional public search is temporarily paused. Connected employer listings still work." };
      }
      if (!response.ok) throw new Error(data.error ?? "Web search is unavailable. Please retry.");
      if (!validWebSearchResult(data)) throw new Error("A complete source-linked search response was not available. Please retry; employer listings remain below.");
      if (!controller.signal.aborted) { providerPause = null; setResult(data); }
    } catch (error) { if (controller.signal.reason === "timeout") setError("Public-source search took too long. Retry here; employer listings remain available."); else if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not complete web search."); }
    finally { clearTimeout(timer); if (pending.current === controller) { pending.current = null; setBusy(false); } }
  }, [keywords, location]);
  useEffect(() => {
    if (!automatic || !keywords.trim()) return;
    // A queued start avoids duplicate calls during React's development replay.
    const timer = setTimeout(() => void search(true), 0);
    return () => { clearTimeout(timer); pending.current?.abort(); pending.current = null; };
  }, [automatic, keywords, search, requestKey]);
  useEffect(() => () => pending.current?.abort(), []);
  return <section aria-label={automatic ? "Career Assistant additional source results" : "Search the public web for jobs"} className={embedded ? "min-w-0 border-t border-border pt-5" : "mb-5 rounded-xl border border-border bg-surface p-4 sm:p-5"}>
    <div className="flex flex-wrap items-center justify-between gap-4"><div className="min-w-0 flex-1"><h2 className="text-sm font-semibold">{automatic ? "Career Assistant · Additional sources" : "Find opportunities beyond these employers"}</h2><p className="mt-1 text-xs leading-5 text-text-secondary">{automatic ? "Your search also checks public hiring pages beyond the connected feeds." : `Search public hiring pages for ${keywords || "jobs"} in ${location || "India"}.`} Open the original source to check details and apply.</p></div>{!automatic && <button type="button" disabled={busy} onClick={() => void search()} className={buttonClass + " shrink-0 border-accent/30 text-accent"}>{busy ? "Searching sources…" : "Search the web ↗"}</button>}</div>
    <p className="mt-2 text-[11px] leading-5 text-text-muted">Powered by Google Search. Only these keywords and location are sent; your resume and profile are not sent.</p>
    {busy && <p role="status" className="mt-4 text-sm text-text-secondary">Looking across public job platforms and employer pages…</p>}
    {error && <div role="status" className="mt-4 rounded-md border border-border bg-surface-2 p-4 text-sm text-text-secondary"><p className="mb-1 font-semibold text-text">Additional sources are temporarily unavailable</p><p>{error}</p><p className="mt-2 text-xs leading-5">You can still browse connected employer results and change your role or location.</p><button type="button" disabled={busy} onClick={() => void search()} className={buttonClass + " mt-3 bg-surface"}>Retry additional sources</button></div>}
    {result && <div className="mt-5 border-t border-border pt-5">
      <h3 className="text-base font-semibold">Opportunities from public sources</h3><p className="mb-4 mt-1 text-xs leading-5 text-text-muted">Check dates, availability and application instructions at the source. Some links may open a search page rather than a specific vacancy. These leads are separate from the employer-feed count.</p>
      <article aria-label="Google-grounded search response" className="min-w-0 text-sm leading-7 text-text-secondary"><GroundedText result={result} /></article>
      <nav aria-label="Sources provided with the search response" className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs">{result.sources.map((source, index) => <a key={`${source.url}:${index}`} href={source.url} target="_blank" rel="noopener noreferrer" className="break-words text-accent underline">{source.title}</a>)}</nav>
      <SearchSuggestions html={result.suggestionsHtml} />
    </div>}
  </section>;
}

"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { CareerProfile, ResumeEvidence } from "@/lib/jobs/types";
import { EMPTY_INTENT, publicCareerMessage, type CareerIntent } from "@/lib/jobs/careerIntent";
import { selectedResume } from "@/lib/jobs/profile";
import { quickCareerReply, recoverCareerReply, resumeCareerReply, validateCareerReply, type CareerReply } from "@/lib/jobs/careerReply";
import { assistantContext, careerPublicKeywords, careerRoleSuggestions } from "@/lib/jobs/assistantSearch";
import { readJobJson } from "@/lib/jobs/response";
import { publicJobQuery } from "@/lib/jobs/searchSuggestions";
import DiscoveryResumePicker from "@/app/jobs/DiscoveryResumePicker";
import WebJobSearch from "@/app/jobs/WebJobSearch";
import AssistantJobResults from "./AssistantJobResults";

const secondary = "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md border border-border-strong bg-surface px-3 py-2 text-sm font-medium text-accent hover:bg-accent/5 disabled:opacity-50";
const primary = "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-50";
function CaseMark() { return <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-fg"><svg width="24" height="24" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M11 9V7.5A2.5 2.5 0 0 1 13.5 5h5A2.5 2.5 0 0 1 21 7.5V9M6 10h20v15H6zM6 16h20" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg></span>; }
export default function CareerAssistant({ profile, resumes, name, gmailConnected }: { profile: CareerProfile; resumes: ResumeEvidence[]; name?: string; gmailConnected: boolean }) {
  const request = useRef<AbortController | null>(null), input = useRef<HTMLTextAreaElement>(null);
  const [intent, setIntent] = useState<CareerIntent | null>(null), [message, setMessage] = useState(""), [submitted, setSubmitted] = useState("");
  const [history, setHistory] = useState<string[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [clarification, setClarification] = useState<Extract<CareerReply, { kind: "clarify" }> | null>(null), [previous, setPrevious] = useState("");
  const [library, setLibrary] = useState(resumes), [resumeId, setResumeId] = useState<string | null>(profile.resumeId), [pickingResume, setPickingResume] = useState(false), [uploading, setUploading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const resume = selectedResume(library, resumeId);
  useEffect(() => () => request.current?.abort(), []);
  function accept(reply: CareerReply, text: string) {
    if (submitted && submitted !== text) setHistory(items => [...items, submitted].slice(-3));
    setSubmitted(text); setMessage(""); setError(null);
    if (reply.kind === "clarify") { setClarification(reply); setIntent(null); setPrevious(reply.context ? assistantContext(reply.context) : [previous, text].filter(Boolean).join(" ").slice(-400)); }
    else { setIntent(reply.intent); setClarification(null); setPrevious(assistantContext(reply.intent)); setRefreshKey(value => value + 1); }
  }
  async function interpret(text = message) {
    if (busy || uploading || !text.trim()) return;
    const value = text.trim(); setError(null);
    if (!publicCareerMessage(value)) { setError("Use role, company and location preferences only. Leave out contact details, links and resume text."); return; }
    const quick = resumeCareerReply(value, resume, previous || undefined, profile.yearsExperience) ?? quickCareerReply(value, previous || false);
    if (quick) { accept(quick, value); return; }
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    let timeout = false, sessionExpired = false;
    const timer = setTimeout(() => { timeout = true; controller.abort(); }, 22000);
    setBusy(true);
    try {
      const response = await fetch("/api/jobs/intent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: value, previous: previous || undefined }), signal: controller.signal });
      sessionExpired = response.status === 401;
      const data = await readJobJson<Record<string, unknown>>(response, "The assistant could not respond. Retry or search these exact words.");
      const reply = validateCareerReply(data);
      if (reply?.kind === "clarify") { if (!controller.signal.aborted) accept(reply, value); return; }
      if (!response.ok || !reply) throw new Error(typeof data.error === "string" ? data.error : "Add a little more detail, or search these exact words.");
      if (!controller.signal.aborted) accept(reply, value);
    } catch (failure) {
      if (timeout || !controller.signal.aborted) {
        if (sessionExpired) { setError("Your session has expired. Please sign in again."); return; }
        const recovery = recoverCareerReply(value, previous || undefined);
        if (recovery) accept(recovery, value);
        else setError(failure instanceof Error ? failure.message : "Please retry your search.");
      }
    } finally { clearTimeout(timer); if (request.current === controller) { setBusy(false); request.current = null; } }
  }
  function exact() {
    const words = publicJobQuery(message || submitted);
    if (!words) { setError("Enter short job keywords without contact details or links."); return; }
    accept({ kind: "search", intent: { ...EMPTY_INTENT, role: words, location: intent?.location ?? "India" } }, message || submitted);
  }
  function refine(role: string) {
    if (!intent || busy) return;
    accept({ kind: "search", intent: { ...intent, role } }, role + " · " + intent.location + (intent.experience === "entry" ? " · fresher" : ""));
  }
  function changeLocation(location: string) {
    if (!intent || busy) return;
    accept({ kind: "search", intent: { ...intent, location } }, "Search " + (intent.role || intent.qualification || "jobs") + " across " + location);
  }
  function reset() {
    request.current?.abort(); request.current = null; setBusy(false); setIntent(null); setSubmitted(""); setMessage(""); setHistory([]); setPrevious(""); setError(null); setClarification(null); input.current?.focus();
  }
  const resumePanel = <section aria-label="Improve resume match" className="mt-5 rounded-lg border border-accent/25 bg-accent/5 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0 flex-1"><h3 className="text-sm font-semibold">Make your matches more relevant</h3><p className="mt-1 text-xs leading-6 text-text-secondary">Add your resume to compare skills and experience with job requirements.</p>{resume && <p className="mt-1 break-words text-xs font-medium text-accent">Using: {resume.fileName ?? resume.label}</p>}</div><button type="button" className={secondary} onClick={() => setPickingResume(value => !value)}>{resume ? "Change resume" : "Add resume"}</button></div><p className="mt-2 text-xs leading-5 text-text-muted">Optional · resume match reflects available evidence, not your chance of getting hired.</p>{pickingResume && <div className="mt-4 border-t border-border pt-4"><DiscoveryResumePicker resumes={library} value={resumeId} onChange={setResumeId} onResumesChange={setLibrary} onBusyChange={setUploading} /></div>}</section>;
  const searchKey = intent ? JSON.stringify(intent) : "";
  return <section aria-label="Your career workspace" className="career-workspace mb-7">
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><p className="product-kicker">{name ? "Welcome back, " + name : "Your career workspace"}</p><h1 className="mt-2 font-semibold tracking-tight text-text">Find a role that fits you.</h1><p className="mt-2 text-sm text-text-secondary">Search for opportunities. Know your fit. Keep every application on track.</p></div><Link className={secondary} href="/jobs">Browse jobs ↗</Link></div>
    <div className={"grid items-start gap-5" + (intent ? "" : " lg:grid-cols-[minmax(0,2.6fr)_minmax(240px,1fr)]")}>
      <div className="min-w-0 overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4"><div className="flex items-center gap-3"><CaseMark /><h2 className="text-base font-semibold">Career Assistant</h2></div><button type="button" className="min-h-[44px] text-sm font-medium text-accent" onClick={reset}>New search</button></div>
        <div className="p-4 sm:p-6">
          <form onSubmit={event => { event.preventDefault(); void interpret(); }} className="career-composer mb-5">
            <label htmlFor="career-message" className="mb-2 block text-sm font-semibold">Tell us what you are looking for</label>
            <textarea ref={input} id="career-message" rows={2} maxLength={400} value={message} onChange={event => setMessage(event.target.value)} aria-describedby="career-input-help" placeholder={submitted ? "Try: Only operations roles, or show remote options…" : "e.g. I'm a BBA fresher. Find jobs in Kolkata."} className="career-search-input w-full resize-y p-3 text-base text-text placeholder:text-text-muted" />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p id="career-input-help" className="max-w-sm text-xs leading-5 text-text-muted">Public job preferences only. Your resume stays out of public web searches.</p><button type="submit" disabled={busy || uploading || !message.trim()} className={primary}>{busy ? "Understanding…" : "Find opportunities →"}</button></div>
            {busy && <p role="status" className="mt-3 text-sm text-text-secondary">Understanding your request and keeping your earlier preferences…</p>}
            {error && <div role="alert" className="mt-4 rounded-md border border-warning/30 bg-warning-bg p-4 text-sm text-warning"><p>{error}</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy} className={secondary} onClick={() => void interpret()}>Try again</button><button type="button" disabled={busy} className={secondary} onClick={exact}>Search these exact words</button></div></div>}
          </form>
          {resumePanel}
          {intent && <div aria-label="Search preferences" className="mb-5 flex flex-wrap gap-x-4 gap-y-2 border-b border-border pb-4 text-xs text-text-secondary">{[intent.qualification, intent.experience === "entry" ? "Fresher / entry level" : intent.experience ? "Up to " + intent.experience + " years" : "", intent.location, intent.role, intent.company, intent.mode].filter(Boolean).map((value, index) => <span key={index} className="rounded-md bg-surface-2 px-2 py-1">{value}</span>)}</div>}
          {history.length > 0 && <details className="mb-4 text-xs text-text-secondary"><summary className="cursor-pointer py-2">Earlier in this conversation</summary>{history.map((text, index) => <p key={index} className="mt-2 rounded-md bg-surface-2 p-3">You: {text}</p>)}</details>}
          {submitted && <div className="mb-5 flex justify-end"><div className="max-w-[90%]"><p className="mb-1 text-right text-xs text-text-muted">You</p><p className="whitespace-pre-wrap break-words rounded-lg bg-accent/10 px-4 py-3 text-sm leading-6 text-text">{submitted}</p></div></div>}
          {!submitted && <div className="my-5 flex flex-wrap gap-2">{["Fresher jobs", "Data Analyst jobs", "Remote jobs in India"].map(text => <button key={text} type="button" disabled={busy || uploading} className={secondary} onClick={() => void interpret(text)}>{text} →</button>)}</div>}
          {clarification && <section aria-label="Clarify your search" className="mb-5" aria-live="polite"><div className="flex items-start gap-3"><CaseMark /><div className="min-w-0"><p className="text-xs font-semibold text-text-secondary">JobTrackOS</p><h3 className="mt-2 text-base font-semibold leading-7">{clarification.question}</h3><div className="mt-3 flex flex-wrap gap-2">{clarification.suggestions.map(text => <button key={text} type="button" className={secondary} disabled={busy} onClick={() => void interpret(text)}>{text} →</button>)}</div><button type="button" className="mt-2 min-h-[44px] text-sm font-medium text-accent" onClick={exact}>Search these exact words ↗</button></div></div></section>}
          {intent && <><div className="mb-5 flex items-start gap-3"><CaseMark /><div className="min-w-0"><p className="text-xs font-semibold text-text-secondary">{busy || error ? "Previous search results" : "JobTrackOS"}</p><p className="mt-2 text-sm leading-7">{busy || error ? "The results below are from your last completed search in " + intent.location + ". Your new request has not replaced them." : "Searching " + (intent.role || (intent.qualification ? intent.qualification + " opportunities" : "jobs")) + (intent.company ? " at " + intent.company : "") + " in " + intent.location + (intent.experience === "entry" ? " for freshers / entry level." : ".") + " Check each employer's eligibility requirements. Regional alternatives and India-eligible remote roles are labelled separately."}</p></div></div>
            <div className="border-t border-border pt-4"><AssistantJobResults key={searchKey} intent={intent} profile={profile} resume={resume} refreshKey={refreshKey} onLocationChange={changeLocation} /></div>
            {!intent.company && <details className="mt-4 text-sm"><summary className="min-h-[44px] py-3 font-medium text-accent">Refine by a suggested role</summary><div className="mt-2 flex flex-wrap gap-2">{careerRoleSuggestions(intent).map(role => <button key={role} type="button" disabled={busy} className={secondary} onClick={() => refine(role)}>{role} →</button>)}</div></details>}
            <div className="mt-5"><WebJobSearch key={searchKey} keywords={careerPublicKeywords(intent)} location={intent.location} automatic embedded /></div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-xs leading-5 text-text-secondary">Refine by role, company, location or work mode in the search above.</p><button type="button" className="min-h-[44px] text-sm font-medium text-accent" onClick={() => setRefreshKey(value => value + 1)}>Refresh sources ↻</button></div>
          </>}



          <details className="mt-3 text-xs leading-5 text-text-secondary"><summary className="cursor-pointer py-2">How search works &amp; privacy</summary><p className="mt-2">Search combines connected public job feeds with Google-grounded hiring leads. Coverage varies; availability must be checked at the original source. Only public search preferences are sent to AI search services. Your saved resume and application history are not sent to public search. Fit scores compare available resume/profile evidence with source requirements.</p></details>
        </div>
      </div>
      {!intent && <aside className="career-tools space-y-5"><section className="tracking-release-notice"><h2 className="text-base font-semibold">Track My Application</h2><p className="mt-3 text-sm leading-7 text-text-secondary">Keep every application and next step in one place.</p><Link href="/applications" className="product-button mt-4">View my applications →</Link><a href="#gmail-tracking" className="mt-3 block text-xs underline">{gmailConnected ? "Review inbox updates" : "Track my applications from my inbox"}</a></section><section className="resume-tool-notice"><h2 className="text-lg font-semibold">Resume Match &amp; tailoring</h2><p className="mt-3 text-sm leading-7 text-text-secondary">Understand your fit, improve your resume and export a single-column document.</p><p className="mt-4 text-xs text-text-secondary">Match → Tailor → Export</p><Link href="/resumes" className="product-button product-button-primary mt-4 w-full">Match my resume →</Link></section></aside>}
    </div>
  </section>;
}

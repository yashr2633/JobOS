"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CareerProfile, ResumeEvidence } from "@/lib/jobs/types";
import { EMPTY_INTENT, careerSearchUrl, publicCareerMessage, type CareerIntent } from "@/lib/jobs/careerIntent";
import { selectedResume } from "@/lib/jobs/profile";
import { buildSearchVocabulary } from "@/lib/jobs/searchSuggestions";
import { quickCareerReply, validateCareerReply, type CareerReply } from "@/lib/jobs/careerReply";
import { readJobJson } from "@/lib/jobs/response";
import { publicJobQuery } from "@/lib/jobs/searchSuggestions";
import { findCompany } from "@/lib/jobs/companies";
import LocationSearch from "@/app/jobs/LocationSearch";
import CompanySearch from "@/app/jobs/CompanySearch";
import JobSearchInput from "@/app/jobs/JobSearchInput";
import DiscoveryResumePicker from "@/app/jobs/DiscoveryResumePicker";
type Step = "role" | "location" | "experience" | "review" | "other-role" | "other-city";
const secondary = "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-text hover:bg-surface-2 disabled:opacity-50";
const primary = "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-50";
const experienceLabel = (value: string) => ({ entry: "Fresher / entry level", "3": "Up to 3 years", "5": "Up to 5 years", "10": "Up to 10 years", unknown: "Not specified" }[value] ?? "Any experience");
export default function CareerAssistant({ profile, resumes, name, gmailConnected }: { profile: CareerProfile; resumes: ResumeEvidence[]; name?: string; gmailConnected: boolean }) {
  const router = useRouter(), request = useRef<AbortController | null>(null);
  const [intent, setIntent] = useState<CareerIntent>({ ...EMPTY_INTENT });
  const [step, setStep] = useState<Step>("role"), [animate, setAnimate] = useState(false);
  const [library, setLibrary] = useState(resumes), [resumeId, setResumeId] = useState<string | null>(null), [pickingResume, setPickingResume] = useState(false), [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [note, setNote] = useState<string | null>(null);
  const [clarification, setClarification] = useState<Extract<CareerReply, { kind: "clarify" }> | null>(null);
  const [previous, setPrevious] = useState("");
  const [opening, startOpening] = useTransition();
  const resume = selectedResume(library, resumeId);
  const roles = useMemo(() => [...new Set([...(resume?.suggestedRoles ?? []), ...profile.roles, "Data Analyst", "Business Analyst", "MIS Executive", "Sales Executive"])].slice(0, 4), [resume, profile.roles]);
  const roleVocabulary = useMemo(() => buildSearchVocabulary([]), []);
  const company = findCompany(intent.company);
  useEffect(() => () => request.current?.abort(), []);
  function go(next: Step) { setAnimate(true); setError(null); setClarification(null); setStep(next); }
  function choose(key: keyof CareerIntent, value: string, next: Step) { setIntent(previous => ({ ...previous, ...(key === "location" ? { mode: "" } : {}), [key]: value })); go(next); }
  function openSearch(value: CareerIntent) {
    setIntent(value); setClarification(null); setError(null);
    setNote(`Opening jobs for ${[value.role, value.company, value.location].filter(Boolean).join(" · ")}…`);
    startOpening(() => router.push(careerSearchUrl(value, resumeId)));
  }
  function showJobs() { if (!intent.role && !intent.company) { go("role"); setError("Choose a role or company first."); return; } openSearch(intent); }
  function searchExact() {
    const role = publicJobQuery(message);
    if (!role) { setError("Enter a short role or company name without contact details or links."); return; }
    openSearch({ ...EMPTY_INTENT, role });
  }
  function acceptReply(reply: CareerReply, text: string) {
    if (reply.kind === "clarify") { setPrevious(existing => existing.endsWith(text) ? existing : [existing, text].filter(Boolean).join("\n").slice(-400)); setClarification(reply); setNote(null); }
    else openSearch(reply.intent);
  }
  async function interpret(text = message) {
    if (busy || opening || uploading || !text.trim()) return;
    const input = text.trim(); setMessage(input); setError(null); setNote(null);
    if (!publicCareerMessage(input)) { setError("Describe the role, company or location only. Leave out contact details, links and resume text."); return; }
    const quick = quickCareerReply(input, !!previous && input !== previous);
    if (quick && (quick.kind === "clarify" || !previous)) { acceptReply(quick, input); return; }
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 22_000);
    setBusy(true); setClarification(null);
    try {
      const response = await fetch("/api/jobs/intent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: input, previous: previous || undefined }), signal: controller.signal });
      const data = await readJobJson<Record<string, unknown>>(response, "The assistant is temporarily unavailable. Try again or search these exact words.");
      const reply = validateCareerReply(data);
      if (reply?.kind === "clarify") { if (!controller.signal.aborted) acceptReply(reply, input); return; }
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "The assistant could not respond. Try again or use the guided choices.");
      if (!reply) throw new Error("I could not safely understand that request. Add the role and city, or search your exact words.");
      if (!controller.signal.aborted) acceptReply(reply, input);
    } catch (failure) {
      if (timedOut) setError("The assistant took too long. Try again, choose a role below, or search these exact words.");
      else if (!controller.signal.aborted) setError(failure instanceof TypeError ? "Could not reach the assistant. Check your connection and try again, or use the guided choices." : failure instanceof Error ? failure.message : "Choose the guided options to continue.");
    } finally { clearTimeout(timer); if (request.current === controller) { setBusy(false); request.current = null; } }
  }
  const choice = (label: string, onClick: () => void) => <button key={label} type="button" onClick={onClick} className="flex min-h-[48px] w-full items-center justify-between gap-3 rounded-md border border-border-strong bg-surface px-4 py-3 text-left text-sm font-medium hover:border-accent/50 hover:bg-accent/5"><span>{label}</span><span aria-hidden="true" className="text-accent">→</span></button>;
  const heading = (kicker: string, title: string, description: string) => <><p className="mb-2 text-xs font-medium text-text-secondary">{kicker}</p><h2 className="text-xl font-semibold tracking-tight text-text">{title}</h2><p className="mt-2 text-sm leading-6 text-text-secondary">{description}</p></>;
  return <section aria-label="Your career workspace" className="mb-7">
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><p className="product-kicker">{name ? `Welcome back, ${name}` : "Your career workspace"}</p><h1 className="mt-2 text-2xl font-semibold tracking-tight text-text">Find a job that fits you</h1><p className="mt-2 text-sm text-text-secondary">Search opportunities across India and prepare your next application.</p></div><Link className={secondary} href="/jobs">Browse jobs ↗</Link></div>
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,2.1fr)_minmax(230px,1fr)]">
      <div className="min-w-0 overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4"><p className="text-sm font-semibold text-text">Career Assistant</p>{intent.role || intent.company || resumeId || message || clarification ? <button type="button" className="min-h-[36px] text-xs font-medium text-accent" onClick={() => { request.current?.abort(); setBusy(false); setIntent({ ...EMPTY_INTENT }); setResumeId(null); setMessage(""); setPrevious(""); setNote(null); go("role"); }}>Start over</button> : <span className="text-xs text-text-muted">Let&apos;s find your fit</span>}</div>
        <form onSubmit={event => { event.preventDefault(); void interpret(); }} className="border-b border-border bg-surface-2 p-5 sm:p-6">
          <label className="block text-base font-semibold text-text" htmlFor="career-message">What job are you looking for?</label>
          <p id="career-input-help" className="mt-1 text-sm leading-6 text-text-secondary">Tell me the role, city or company. If something is unclear, I’ll ask.</p>
          <div className="mt-3 flex flex-col items-stretch gap-3 sm:flex-row">
            <textarea id="career-message" aria-describedby="career-input-help" rows={2} value={message} onChange={event => { setMessage(event.target.value); setError(null); if (request.current) { request.current.abort(); request.current = null; setBusy(false); } }} maxLength={400} placeholder="e.g. BBA fresher jobs in Kolkata, or analyst roles at Deloitte" className="career-search-input min-h-[88px] min-w-0 flex-1 resize-y border border-border-strong bg-surface p-3 text-base text-text placeholder:text-text-muted" />
            <button type="submit" className={primary + " shrink-0 sm:min-w-[128px]"} disabled={busy || opening || uploading || !message.trim()}>{opening ? "Opening jobs…" : busy ? "Understanding…" : "Find jobs →"}</button>
          </div>
          {clarification && <section aria-label="Clarify your search" className="mt-4 rounded-lg border border-accent/30 bg-surface p-4" aria-live="polite">
            <h2 className="text-base font-semibold">A quick question</h2><p className="mt-2 text-sm leading-6 text-text">{clarification.question}</p>
            <div className="mt-3 flex flex-wrap gap-2">{clarification.suggestions.map(value => <button key={value} type="button" disabled={busy || opening} className={secondary} onClick={() => void interpret(value)}>{value} →</button>)}{publicJobQuery(message) && <button type="button" disabled={busy || opening} className={secondary} onClick={searchExact}>Search these exact words</button>}</div>
            <p className="mt-3 text-xs leading-5 text-text-secondary">You can also edit your message above and press Find jobs.</p>
          </section>}
          {error && <div role="alert" className="mt-4 rounded-lg border border-danger/30 bg-danger-bg p-4 text-sm leading-6 text-danger"><p>{error}</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy || opening} className={secondary} onClick={() => void interpret()}>Try again</button>{publicJobQuery(message) && <button type="button" disabled={busy || opening} className={secondary} onClick={searchExact}>Search these exact words</button>}</div></div>}
          {note && <p role="status" className="mt-3 text-sm leading-6 text-text-secondary">{note}</p>}
          <details className="mt-3 text-xs leading-5 text-text-secondary"><summary className="cursor-pointer py-1">How search works &amp; privacy</summary><p className="mt-2">Your public search preferences may be sent to our AI search services. Your resume stays out of public search requests. Check the original employer page before applying.</p></details>
        </form>
        {(intent.role || intent.location !== "India" || intent.experience) && <div className="flex flex-wrap gap-2 px-5 pt-4" aria-label="Your search choices">{intent.role && <button className="min-h-[32px] rounded-md bg-accent/10 px-2 py-1 text-xs text-accent" onClick={() => go("role")} aria-label={`Change role: ${intent.role}`}>{intent.role} · Edit</button>}{intent.location !== "India" && <button className="min-h-[32px] rounded-md bg-accent/10 px-2 py-1 text-xs text-accent" onClick={() => go("location")}>{intent.location} · Edit</button>}{intent.experience && <button className="min-h-[32px] rounded-md bg-accent/10 px-2 py-1 text-xs text-accent" onClick={() => go("experience")}>{experienceLabel(intent.experience)} · Edit</button>}</div>}
        <div className="p-5">
          <div key={step} className={animate ? "career-stage" : ""} aria-live="polite">
            {step === "role" && <>{heading("Or use guided search · Step 1 of 3", "Choose your role", resume ? "Suggestions use the evidence in your selected resume. You can choose any role." : "Pick a suggestion below, or search for another role.")}<div className="mt-5 grid gap-2 sm:grid-cols-2">{roles.map(role => choice(role, () => choose("role", role, "location")))}</div><div className="mt-4 flex flex-wrap justify-between gap-3"><button className="min-h-[36px] text-xs font-medium text-accent" onClick={() => go("other-role")}>Choose another role</button><button className="min-h-[36px] text-xs font-medium text-accent" onClick={() => go("review")}>Search by company instead</button></div></>}
            {step === "other-role" && <>{heading("Find your role", "What would you like to do?", "Type a role or skill; you can also use your own words.")}<div className="mt-5"><JobSearchInput label="Role or skill" value={intent.role} onChange={value => setIntent(previous => ({ ...previous, role: value }))} vocabulary={roleVocabulary} /></div><div className="mt-4 flex gap-3"><button className={primary} onClick={() => intent.role.trim() ? go("location") : setError("Enter a role first.")}>Continue →</button><button className={secondary} onClick={() => go("role")}>Back</button></div></>}
            {step === "location" && <>{heading("Guided search · Step 2 of 3", "Where would you like to work?", "Choose a city, or explore jobs across India.")}<div className="mt-5 grid gap-2 sm:grid-cols-2">{[...new Set([profile.locations[0] && !/^india$/i.test(profile.locations[0]) ? profile.locations[0] : "Kolkata, West Bengal", "Dhanbad, Jharkhand"])].map(location => choice(location, () => choose("location", location, "experience")))}{choice("Remote — India", () => { setIntent(previous => ({ ...previous, mode: "Remote", location: "India" })); go("experience"); })}{choice("Anywhere in India", () => { setIntent(previous => ({ ...previous, mode: "", location: "India" })); go("experience"); })}</div><div className="mt-4 flex flex-wrap justify-between gap-3"><button className="min-h-[36px] text-xs text-accent" onClick={() => go("other-city")}>Choose another city</button><button className="min-h-[36px] text-xs text-accent" onClick={() => go("role")}>Back to role</button></div></>}
            {step === "other-city" && <>{heading("Choose your location", "Which city do you have in mind?", "Suggestions include Indian cities, towns and states.")}<div className="mt-5"><LocationSearch value={intent.location === "India" ? "" : intent.location} onChange={value => setIntent(previous => ({ ...previous, location: value, mode: "" }))} /></div><div className="mt-4 flex gap-3"><button className={primary} onClick={() => intent.location.trim() ? go("experience") : setError("Choose a city, state or India.")}>Continue →</button><button className={secondary} onClick={() => go("location")}>Back</button></div></>}
            {step === "experience" && <>{heading("Guided search · Step 3 of 3", "Which level fits you best?", "Listings with unstated experience will be labelled; check the full requirements.")}<div className="mt-5 grid gap-2 sm:grid-cols-2">{[["entry", "Fresher / entry level"], ["3", "Up to 3 years"], ["10", "Up to 10 years"], ["", "Show all levels"]].map(([value, label]) => choice(label, () => choose("experience", value, "review")))}</div><button className="mt-4 min-h-[36px] text-xs text-accent" onClick={() => go("location")}>Back to location</button></>}
            {step === "review" && <>{heading("Ready when you are", "Does this look right?", "Search connected feeds and check additional public hiring sources in the same flow.")}<dl className="my-4 divide-y divide-border text-sm">{[["Role", intent.role || "All roles", "other-role"], ["Location", intent.mode === "Remote" ? "Remote — India" : intent.location, "location"], ["Experience", experienceLabel(intent.experience), "experience"]].map(([label, value, target]) => <div key={label} className="flex flex-wrap justify-between gap-3 py-3"><dt className="text-text-muted">{label}</dt><dd><button className="text-accent" onClick={() => go(target as Step)}>{value} · Edit</button></dd></div>)}</dl><CompanySearch value={intent.company} onChange={value => setIntent(previous => ({ ...previous, company: value }))} />{intent.company && !company?.connected && <p className="mt-2 text-xs leading-5 text-text-secondary">Direct company-feed coverage is not confirmed. The assistant will check public sources; search leads will be labelled separately from source-listed vacancies.</p>}<div className="mt-5"><button className={primary} disabled={uploading || busy || opening} onClick={showJobs}>{opening ? "Opening jobs…" : "Find matching jobs →"}</button></div></>}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"><button className="min-h-[36px] font-medium text-accent" onClick={() => { if (!resumeId && profile.resumeId) setResumeId(profile.resumeId); setPickingResume(value => !value); }}> {resume ? resume.fileName ?? resume.label : "Add a resume for fit scores"}</button><span className="text-text-muted">Optional · use your saved resume or upload one</span></div>
          {pickingResume && <div className="mt-3 rounded-lg border border-border p-4"><DiscoveryResumePicker resumes={library} value={resumeId} onChange={setResumeId} onResumesChange={setLibrary} onBusyChange={setUploading} /></div>}

        </div>

      </div>
      <aside className="rounded-xl border border-border bg-surface p-5"><p className="text-xs font-semibold text-accent">Your application tracker</p><h2 className="mt-3 text-base font-semibold text-text">Keep track after you apply.</h2><p className="mt-2 text-sm leading-6 text-text-secondary">Track where you applied, review updates, and know what needs your attention.</p><div className="mt-4 flex flex-wrap items-center gap-3"><a className={secondary} href="#gmail-tracking">{gmailConnected ? "Scan Gmail ↓" : "Connect Gmail ↓"}</a><Link className="min-h-[44px] py-3 text-sm font-medium text-accent" href="/applications">Open tracker ↗</Link></div><p className="mt-4 border-t border-border pt-4 text-xs leading-5 text-text-muted">Save progress and follow up from one place.</p></aside>
    </div>
    <style jsx>{`@keyframes career-in{from{opacity:.5;transform:translateY(7px)}to{opacity:1;transform:translateY(0)}}.career-stage{animation:career-in .18s ease-out}@media(prefers-reduced-motion:reduce){.career-stage{animation:none}}`}</style>
  </section>;
}

"use client";
import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import DocumentWorkbench, { type LetterSeed, type PreparedResume } from "./DocumentWorkbench";

export default function ResumeStudio() {
  const snapshot = useRef<PreparedResume | null>(null);
  const [active, setActive] = useState<"resume" | "letter">("resume");
  const [letter, setLetter] = useState<{ seed: LetterSeed; revision: number } | null>(null);
  const remember = useCallback((value: PreparedResume) => { snapshot.current = value; }, []);
  function prepare(value: PreparedResume | null, replace = false) {
    if (letter && !replace) { setActive("letter"); return; }
    if (letter && !window.confirm("Replace the current letter inputs with this resume? Save any letter edits you want to keep first.")) return;
    setLetter({ revision: (letter?.revision ?? 0) + 1, seed: value ? { name: value.data.name, contact: value.data.contact, facts: value.data.sections.map(section => section.body).join("\n"), formatting: value.formatting } : {} });
    setActive("letter");
  }
  return <section className="resume-studio"><header className="product-heading"><div><p className="product-kicker">YOUR APPLICATION DOCUMENTS</p><h1>Resume &amp; Cover Letter Studio</h1><p className="mt-3 text-sm text-text-secondary">Choose a design. Build your resume. Prepare a matching Cover Letter in the same workspace.</p></div></header>
    <nav className="studio-document-tabs" aria-label="Application document"><button type="button" aria-pressed={active === "resume"} onClick={() => setActive("resume")}>1. Resume &amp; templates</button><button type="button" aria-pressed={active === "letter"} onClick={() => prepare(snapshot.current)}>2. Matching Cover Letter</button><Link href="/resumes">Match &amp; tailor to a job →</Link></nav>
    <div hidden={active !== "resume"}><DocumentWorkbench kind="resume" embedded onResumeChange={remember} onPrepareLetter={value => prepare(value, true)} /></div>
    {letter && <div hidden={active !== "letter"}><p className="product-notice">Your resume details and chosen design are carried over. Add the employer and job description below for a role-specific letter. Both documents have their own Save and Export controls.</p><button type="button" className="product-button studio-update-letter" onClick={() => prepare(snapshot.current, true)}>Update letter from current resume</button><DocumentWorkbench key={letter.revision} kind="letter" seed={letter.seed} embedded /></div>}
  </section>;
}

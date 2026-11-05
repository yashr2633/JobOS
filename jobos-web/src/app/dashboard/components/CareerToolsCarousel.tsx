"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const tools = [
  { title: "Resume Match", href: "/resumes", label: "Job requirements", first: "Skills that match", second: "Evidence to strengthen", tone: "bg-[#d9e8dc]", detail: "See what to highlight before you apply." },
  { title: "Resume Templates", href: "/resume-builder", label: "Resume layouts", first: "Classic", second: "Projects first", tone: "bg-[#e7dff3]", detail: "Choose a layout that puts your strongest experience first." },
  { title: "Cover Letter Templates", href: "/cover-letter", label: "Cover letter", first: "Dear Hiring Team,", second: "Why I fit this role", tone: "bg-[#efdece]", detail: "Write a short introduction around a relevant achievement." },
  { title: "Recruiter Outreach", href: "/recruiters", label: "Recruiter contact", first: "Company and hiring role", second: "Draft an introduction", tone: "bg-[#d9e8ee]", detail: "Find recruiter profiles and prepare a personal email." },
  { title: "Job Alerts", href: "/settings/alerts", label: "Email preferences", first: "Role and location", second: "Daily or weekly", tone: "bg-[#efe7d3]", detail: "Get updates when matching roles appear." },
];

export default function CareerToolsCarousel() {
  const [index, setIndex] = useState(0);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const timer = window.setInterval(() => {
      if (!focused && !reducedMotion.matches && !document.hidden) setIndex(previous => (previous + 1) % tools.length);
    }, 5500);
    return () => window.clearInterval(timer);
  }, [focused]);
  const tool = tools[index];

  return (
    <aside className="product-panel h-fit" aria-label="Career tools" onFocusCapture={() => setFocused(true)} onBlurCapture={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
    }}>
      <h2>Career tools</h2>
      <Link href={tool.href} className="mt-3 block rounded-lg border border-border bg-surface">
        <div className={`grid min-h-36 place-items-center rounded-t-lg p-4 ${tool.tone}`} aria-hidden="true">
          <div className="w-full max-w-44 rounded-lg border border-black/10 bg-white p-3 text-xs text-slate-800 shadow-sm">
            <strong>{tool.label}</strong>
            <div className="mt-2 grid gap-2 border-t border-slate-200 pt-2">
              <span>{tool.first}</span>
              <span className="text-slate-600">{tool.second}</span>
            </div>
          </div>
        </div>
        <div className="grid gap-1 p-3">
          <strong>{tool.title}</strong>
          <span className="text-sm text-text-secondary">{tool.detail}</span>
        </div>
      </Link>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-sm text-text-muted">{index + 1} of {tools.length}</span>
        <div className="flex gap-2">
          <button className="p-outline" type="button" aria-label="Previous tool" onClick={() => setIndex((index + tools.length - 1) % tools.length)}>←</button>
          <button className="p-outline" type="button" aria-label="Next tool" onClick={() => setIndex((index + 1) % tools.length)}>→</button>
        </div>
      </div>
    </aside>
  );
}

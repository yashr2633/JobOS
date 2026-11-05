"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

const tools = [
  { title: "Resume Match", href: "/resumes", label: "Job requirements", first: "Skills that match", second: "Evidence to strengthen", tone: "bg-[#d9e8dc]", detail: "See what to highlight before you apply." },
  { title: "Resume Templates", href: "/resume-builder", label: "Resume layouts", first: "Classic", second: "Projects first", tone: "bg-[#e7dff3]", detail: "Choose a layout that puts your strongest experience first." },
  { title: "Cover Letter Templates", href: "/cover-letter", label: "Cover letter", first: "Dear Hiring Team,", second: "Why I fit this role", tone: "bg-[#efdece]", detail: "Write a short introduction around a relevant achievement." },
  { title: "Recruiter Outreach", href: "/recruiters", label: "Recruiter contact", first: "Company and hiring role", second: "Draft an introduction", tone: "bg-[#d9e8ee]", detail: "Find recruiter profiles and prepare a personal email." },
  { title: "Job Alerts", href: "/settings/alerts", label: "Email preferences", first: "Role and location", second: "Daily or weekly", tone: "bg-[#efe7d3]", detail: "Get updates when matching roles appear." },
];

export default function CareerToolsCarousel() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const container = useRef<HTMLElement>(null);
  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => {
      if (!document.hidden && !container.current?.querySelector("a:focus-visible")) {
        setIndex(previous => (previous + 1) % tools.length);
      }
    }, 4500);
    return () => window.clearInterval(timer);
  }, [paused]);

  return (
    <aside ref={container} className="product-panel career-carousel h-fit" aria-label="Career tools">
      <h2>Career tools</h2>
      <div className="career-carousel-viewport">
        <div className="career-carousel-track" style={{ transform: `translateX(-${index * 100}%)` }}>
          {tools.map((tool, slide) => <Link key={tool.href} href={tool.href} className="career-carousel-slide" tabIndex={slide === index ? 0 : -1} aria-hidden={slide !== index}>
            <Image className="career-carousel-image" src={`/career-tools/${["resume-match", "resume-templates", "cover-letter-templates", "recruiter-outreach", "job-alerts"][slide]}.webp`} width={672} height={840} sizes="(max-width: 767px) calc(100vw - 70px), 336px" loading={slide === 0 ? "eager" : "lazy"} alt={`${tool.title} — ${tool.detail}`} />
            <div className="career-carousel-copy sr-only">
              <strong>{tool.title}</strong>
              <span>{tool.detail}</span>
              <span className="career-carousel-link">Open {tool.title} →</span>
            </div>
          </Link>)}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-sm text-text-muted">{index + 1} of {tools.length}</span>
        <div className="career-carousel-controls flex gap-2">
          <button className="product-button" type="button" aria-label={paused ? "Resume automatic slides" : "Pause automatic slides"} aria-pressed={paused} onClick={() => setPaused(value => !value)}>{paused ? "Play" : "Pause"}</button>
          <button className="product-button" type="button" aria-label="Previous tool" onClick={() => setIndex((index + tools.length - 1) % tools.length)}>←</button>
          <button className="product-button" type="button" aria-label="Next tool" onClick={() => setIndex((index + 1) % tools.length)}>→</button>
        </div>
      </div>
    </aside>
  );
}

"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, isNavItemActive } from "./navItems";

const CAREER_TOOLS = [
  ["/resumes", "Resume Match"],
  ["/resume-builder", "Resume Templates"],
  ["/cover-letter", "Cover Letter Templates"],
  ["/recruiters", "Recruiter Outreach"],
  ["/settings/alerts", "Job Alerts"],
] as const;

export default function DesktopNav() {
  const pathname = usePathname();
  return <nav className="product-desktop-nav" aria-label="Primary">
    {NAV_ITEMS.filter(item => item.href === "/" || item.href === "/jobs").map(item => <Link key={item.href} href={item.href} aria-current={isNavItemActive(item, pathname) ? "page" : undefined}>{item.icon}<span>{item.label}</span></Link>)}
    <details className="relative">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium hover:bg-surface-2">
        Career tools <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </summary>
      <div className="absolute right-0 top-full z-40 mt-2 grid min-w-52 gap-1 rounded-lg border border-border bg-surface p-2 shadow-lg">
        {CAREER_TOOLS.map(([href, label]) => <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined} onClick={event => event.currentTarget.closest("details")?.removeAttribute("open")}>{label}</Link>)}
        <Link href="/applications" onClick={event => event.currentTarget.closest("details")?.removeAttribute("open")}>Applications</Link>
      </div>
    </details>
  </nav>;
}

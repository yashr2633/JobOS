"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { NAV_ITEMS, isNavItemActive } from "./navItems";

/**
 * Desktop navigation rail.
 *
 * Hidden below `md`, where `MobileNav` provides a bottom bar instead. The rail
 * previously rendered as a 64px icon-only strip on phones, which spent scarce
 * horizontal space and left labels invisible; a bottom bar is both easier to
 * reach and cheaper in layout width.
 *
 * `sticky top-0 h-dvh` rather than `h-screen`: `dvh` accounts for mobile browser
 * chrome, and sticky keeps the rail in view while a long page scrolls without
 * taking it out of the flex flow.
 *
 * Destinations come from the shared `NAV_ITEMS`, so this rail and the mobile bar
 * cannot drift apart.
 */
export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border bg-surface md:flex">
      <div className="flex h-14 items-center gap-2 border-b border-border px-5">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent text-xs font-bold text-accent-fg">
          J
        </span>
        <span className="text-[15px] font-semibold text-text">JobTrackOS</span>
      </div>

      <nav aria-label="Primary" className="flex-1 space-y-0.5 p-3">
        {NAV_ITEMS.map((item) => {
          const active = isNavItemActive(item, pathname);

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-[13.5px] font-medium transition-colors ${
                active
                  ? "bg-accent/10 text-accent"
                  : "text-text-secondary hover:bg-surface-2 hover:text-text"
              }`}
            >
              <span className={active ? "text-accent" : "text-text-muted"}>
                {item.icon}
              </span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border p-3">
        <p className="px-3 py-1 text-[11px] text-text-muted">
          Track your job search in one place
        </p>
      </div>
    </aside>
  );
}

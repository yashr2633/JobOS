"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { NAV_ITEMS, isNavItemActive } from "./navItems";

/**
 * Bottom navigation, phones only (hidden from `md` up, where the rail takes over).
 *
 * Why a bottom bar rather than a narrow icon rail: on a phone the thumb reaches
 * the bottom of the screen, not the left edge, and a 64px rail stole horizontal
 * room from content that is already tight at 320px.
 *
 * Details that matter here:
 *  - Reads the SAME `NAV_ITEMS` as the desktop rail, so every destination stays
 *    reachable on mobile. That is the property a phone layout most often breaks.
 *  - `pb-safe` adds the home-indicator inset, so the last row of labels is not
 *    under the gesture bar on a notched device.
 *  - Each target is at least 44px tall, the minimum comfortable touch size.
 *  - Pages pair this with `pb-mobile-nav`, which reserves the bar's height so
 *    fixed navigation never covers the end of a page.
 */
export default function MobileNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface md:hidden"
    >
      <ul className="flex items-stretch">
        {NAV_ITEMS.map((item) => {
          const active = isNavItemActive(item, pathname);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-[56px] flex-col items-center justify-center gap-1 px-0.5 py-2 text-[10px] font-medium leading-none transition-colors ${
                  active ? "text-accent" : "text-text-muted hover:text-text-secondary"
                }`}
              >
                <span aria-hidden="true">{item.icon}</span>
                {/* Truncate rather than wrap: a wrapped label would change the
                    bar's height and shift the page content above it. */}
                <span className="max-w-full truncate">{item.shortLabel}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

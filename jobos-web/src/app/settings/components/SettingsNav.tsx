"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Settings section navigation.
 *
 * A wrapping row rather than a horizontally scrolling tab strip: §15 forbids
 * horizontal overflow, and a scroll strip hides sections off-screen on a phone
 * with no affordance that they exist. Wrapping keeps every section visible at
 * 320px.
 */
const SECTIONS: ReadonlyArray<{ href: string; label: string; exact: boolean }> = [
  { href: "/settings", label: "Profile", exact: true },
  { href: "/settings/account", label: "Account", exact: false },
  { href: "/settings/security", label: "Security", exact: false },
  { href: "/settings/preferences", label: "Preferences", exact: false },
  { href: "/settings/integrations", label: "Integrations", exact: false },
];

export default function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Settings sections" className="border-b border-border">
      <ul className="-mb-px flex flex-wrap gap-x-1 gap-y-0">
        {SECTIONS.map((section) => {
          const active = section.exact
            ? pathname === section.href
            : pathname.startsWith(section.href);

          return (
            <li key={section.href}>
              <Link
                href={section.href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-[44px] items-center border-b-2 px-3 text-sm font-medium transition-colors ${
                  active
                    ? "border-accent text-text"
                    : "border-transparent text-text-muted hover:text-text-secondary"
                }`}
              >
                {section.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

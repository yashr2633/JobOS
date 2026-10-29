import type { ReactNode } from "react";
import Link from "next/link";

import MobileNav from "./MobileNav";
import Navbar from "./Navbar";

interface AppShellProps {
  children: ReactNode;
  /**
   * Constrain the content column. Most pages read better with a bounded
   * measure; the Dashboard and Applications use the full width for their grids.
   */
  maxWidth?: "none" | "3xl" | "5xl" | "7xl";
}

const MAX_WIDTH_CLASS: Record<NonNullable<AppShellProps["maxWidth"]>, string> = {
  none: "",
  "3xl": "mx-auto max-w-3xl",
  "5xl": "mx-auto max-w-5xl",
  "7xl": "mx-auto max-w-7xl",
};

/**
 * The application shell: rail + top bar + content + mobile bottom bar.
 *
 * WHY THIS EXISTS
 *
 * Five pages each imported `Navbar` and `Sidebar` and hand-rolled their own
 * `<main>` wrapper. They had already drifted — one used `bg-bg` (broken in
 * light mode) and padding varied between them — and adding mobile navigation
 * would have meant repeating it five times, with five chances to miss one and
 * leave a route unreachable on a phone. One shell means one place to get the
 * layout, the safe-area handling, and the skip link right.
 *
 * Structure notes:
 *  - `min-h-dvh` uses the dynamic viewport unit, so mobile browser chrome cannot
 *    cause a short page to scroll.
 *  - `min-w-0` on the content column is what actually prevents horizontal
 *    overflow: without it a flex child refuses to shrink below its content's
 *    intrinsic width, and one long unbroken string scrolls the whole page.
 *  - `pb-mobile-nav` reserves the bottom bar's height plus the safe-area inset,
 *    so the fixed bar never covers the last control on the page.
 */
export default function AppShell({ children, maxWidth = "7xl" }: AppShellProps) {
  return (
    <div className="product-app flex min-h-dvh bg-bg">
      {/* Keyboard users should not have to tab through navigation on every page. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-text focus:shadow-lg"
      >
        Skip to content
      </a>

      <div className="flex min-w-0 flex-1 flex-col">
        <Navbar />

        <main
          id="main-content"
          className="product-main pb-mobile-nav flex-1 p-4 text-text sm:p-6 lg:p-8"
        >
          <div className={MAX_WIDTH_CLASS[maxWidth]}>{children}</div>
        </main>
        <footer className="workspace-footer"><strong>JobTrackOS</strong><p>Discover. Prepare. Apply. Track.</p><div className="workspace-footer-links"><Link href="/jobs">Find jobs</Link><Link href="/resumes">Resume Match</Link><Link href="/resume-builder">Resume Builder</Link><Link href="/cover-letter">Cover Letter</Link><Link href="/profile">Account settings</Link><Link href="/privacy-policy">Privacy &amp; contact</Link><Link href="/terms">Terms of service</Link></div></footer>
      </div>

      <MobileNav />
    </div>
  );
}

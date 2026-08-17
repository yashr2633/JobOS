import type { ReactNode } from "react";

import MobileNav from "./MobileNav";
import Navbar from "./Navbar";
import Sidebar from "./Sidebar";

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
    <div className="flex min-h-dvh bg-bg">
      {/* Keyboard users should not have to tab through navigation on every page. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-text focus:shadow-lg"
      >
        Skip to content
      </a>

      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <Navbar />

        <main
          id="main-content"
          className="pb-mobile-nav flex-1 p-4 text-text sm:p-6 lg:p-8"
        >
          <div className={MAX_WIDTH_CLASS[maxWidth]}>{children}</div>
        </main>
      </div>

      <MobileNav />
    </div>
  );
}

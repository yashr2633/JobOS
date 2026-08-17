import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import AuthButton from "./AuthButton";
import { ThemeToggle } from "./theme";

/**
 * The top bar — a slim utility strip, not a second brand header.
 *
 * On desktop the rail carries the JobTrackOS identity, so this bar holds only the
 * theme control and account menu and stays visually quiet. On mobile the rail is
 * hidden, so the brand appears here instead — otherwise a phone user would see
 * no product identity anywhere on the screen.
 *
 * `sticky top-0` keeps the account and theme controls reachable on a long page
 * without a second scroll to the top.
 */
export default async function Navbar() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <header className="sticky top-0 z-30 flex h-14 w-full shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-4 sm:px-6">
      {/* Brand, phones only — the rail covers this from `md` up. */}
      <Link href="/" className="flex items-center gap-2 md:invisible md:w-0">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent text-xs font-bold text-accent-fg">
          J
        </span>
        <span className="text-[15px] font-semibold text-text">JobTrackOS</span>
      </Link>

      <div className="flex items-center gap-2 sm:gap-3">
        {/* Hidden on the narrowest phones, where the account control matters
            more; the full three-way control lives in Settings -> Preferences. */}
        <ThemeToggle className="hidden sm:inline-flex" />
        <AuthButton userEmail={user?.email} />
      </div>
    </header>
  );
}

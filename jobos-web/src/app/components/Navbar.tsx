import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import AuthButton from "./AuthButton";
import Brand from "./Brand";
import DesktopNav from "./DesktopNav";
import { CAREER_TOOL_LINKS } from "./navItems";

/**
 * Shared brand, desktop navigation and account controls. Phone navigation uses
 * the bottom bar so the header keeps enough room for the account controls.
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
    <header className="product-header sticky top-0 z-30 flex w-full shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-4 sm:px-6">
      <Brand />
      <DesktopNav />

      <div className="flex items-center gap-2 sm:gap-3">
        <details className="relative md:hidden">
          <summary className="cursor-pointer rounded-lg px-2 py-2 text-sm">Tools</summary>
          <div className="absolute right-0 z-50 mt-2 grid min-w-52 gap-1 rounded-lg border border-border bg-surface p-2 shadow-lg">
            {CAREER_TOOL_LINKS.map(item => <Link key={item.href} href={item.href} className="rounded-md px-3 py-2 text-sm">{item.label}</Link>)}
          </div>
        </details>
        <Link href="/profile" className="product-account-link" aria-label="Your profile and settings">Profile</Link>
        <AuthButton userEmail={user?.email} />
      </div>
    </header>
  );
}

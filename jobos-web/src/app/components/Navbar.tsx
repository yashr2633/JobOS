import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import AuthButton from "./AuthButton";
import Brand from "./Brand";
import DesktopNav from "./DesktopNav";

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
        <Link href="/profile" className="product-account-link" aria-label="Your profile and settings">Profile</Link>
        <AuthButton userEmail={user?.email} />
      </div>
    </header>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

/**
 * Sign out, from Settings.
 *
 * Uses the same `auth.signOut()` + `router.refresh()` sequence as the header
 * control, so the server components re-read the (now absent) session rather than
 * leaving a stale authenticated shell on screen. No session material is touched
 * directly and nothing is written to client storage.
 */
export default function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignOut() {
    setBusy(true);
    setError(null);

    const supabase = createClient();
    const { error: signOutError } = await supabase.auth.signOut();

    if (signOutError) {
      setError("Could not sign out. Please try again.");
      setBusy(false);
      return;
    }

    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={() => void handleSignOut()}
        disabled={busy}
        className="rounded-md border border-border-strong px-3.5 py-2 text-sm font-medium text-text transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Signing out..." : "Sign out"}
      </button>
      {error && (
        <span role="alert" className="text-sm text-danger">
          {error}
        </span>
      )}
    </div>
  );
}

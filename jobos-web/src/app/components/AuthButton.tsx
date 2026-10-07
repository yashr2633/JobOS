"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface AuthButtonProps {
  userEmail?: string;
}

export default function AuthButton({ userEmail }: AuthButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  async function handleLogout() {
    setLoading(true);
    setError(null);
    try {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;
      router.push("/login");
      router.refresh();
    } catch {
      setError("Could not sign out. Please retry.");
    } finally {
      setLoading(false);
    }
  }

  if (!userEmail) {
    return null;
  }

  return (
    <div className="flex items-center gap-3">
      <span className="hidden text-sm text-text-secondary sm:inline">
        {userEmail}
      </span>
      <button
        onClick={handleLogout}
        disabled={loading}
        className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-2 hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "..." : "Log out"}
      </button>
      {error && <span role="alert" className="text-sm text-danger">{error}</span>}
    </div>
  );
}

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
  const supabase = createClient();

  async function handleLogout() {
    setLoading(true);
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  if (!userEmail) {
    return null;
  }

  return (
    <div className="flex items-center gap-3">
      <span className="hidden text-sm text-slate-400 sm:inline">
        {userEmail}
      </span>
      <button
        onClick={handleLogout}
        disabled={loading}
        className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "..." : "Log out"}
      </button>
    </div>
  );
}

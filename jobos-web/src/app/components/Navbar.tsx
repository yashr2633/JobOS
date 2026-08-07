import { createClient } from "@/lib/supabase/server";
import AuthButton from "./AuthButton";

export default async function Navbar() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <nav className="w-full border-b border-slate-800 bg-slate-900 px-6 py-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">JobOS</h1>

        <div className="flex items-center gap-4">
          <span className="hidden text-sm text-slate-400 sm:inline">
            AI Career Operating System
          </span>
          <AuthButton userEmail={user?.email} />
        </div>
      </div>
    </nav>
  );
}
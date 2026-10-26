import type { SupabaseClient } from "@supabase/supabase-js";

/** Owner-only RLS applies as with fetchResumes; never put these in a shared cache. */
export async function fetchResumeOptions(supabase: SupabaseClient): Promise<{ id: string; label: string }[]> {
  const { data, error } = await supabase.from("resumes").select("id,label")
    .order("is_default", { ascending: false }).order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

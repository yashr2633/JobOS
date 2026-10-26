import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export interface Company { id: string; name: string; website: string; location: string; description: string }
export interface EmployerJob { id: string; company_id: string; title: string; location: string; work_mode: string; employment_type: string; description: string; requirements: string; salary: string; deadline: string | null; status: string; published_at: string | null; created_at: string }
export interface Submission { id: string; job_id: string; candidate_name: string; candidate_email: string; stage: string; created_at: string; updated_at: string; resume_name: string; resume_text: string; cover_note: string }

export async function employerSession() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/employer/login");
  const result = await supabase.from("employer_companies").select("id,name,website,location,description").eq("owner_id", user.id).maybeSingle();
  return { supabase, user, company: result.data as Company | null, setupError: !!result.error };
}

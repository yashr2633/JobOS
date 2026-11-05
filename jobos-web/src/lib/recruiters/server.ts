import "server-only";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "@/lib/supabase/env";

export const CONTACT_PAGE_SIZE = 20;

function recruiterDatabase() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Recruiter directory is not configured.");
  return createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function readRecruiterDirectory(query: string, page: number) {
  const start = (page - 1) * CONTACT_PAGE_SIZE;
  const search = query.replace(/[^\p{L}\p{N} .&'-]/gu, " ").trim();
  let rows = recruiterDatabase()
    .from("recruiter_contacts")
    .select("id, name, company, title, location", { count: "exact" })
    .not("approved_at", "is", null)
    .is("removed_at", null);
  if (search) rows = rows.or(`name.ilike.%${search}%,company.ilike.%${search}%`);
  const { data, error, count } = await rows
    .order("company")
    .order("name")
    .order("id")
    .range(start, start + CONTACT_PAGE_SIZE - 1);
  if (error) throw new Error("Recruiter directory is temporarily unavailable.");
  return { contacts: data ?? [], count: count ?? 0 };
}

export async function hasCandidateProAccess(userId: string) {
  const db = recruiterDatabase();
  const [manual, paid] = await Promise.all([
    db.from("candidate_pro_access").select("user_id").eq("user_id", userId).gt("valid_until", new Date().toISOString()).maybeSingle(),
    db.rpc("billing_access_until", { p_user_id: userId }),
  ]);
  if (manual.data || (!paid.error && paid.data)) return true;
  if (manual.error || paid.error) throw new Error("Pro access could not be verified.");
  return false;
}

export async function readProRecruiterContact(userId: string, id: string) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) return null;
  if (!(await hasCandidateProAccess(userId))) return null;
  const { data, error } = await recruiterDatabase()
    .from("recruiter_contacts")
    .select("name, company, email")
    .eq("id", id)
    .not("approved_at", "is", null)
    .is("removed_at", null)
    .maybeSingle();
  if (error) throw new Error("Recruiter contact could not be loaded.");
  return data;
}

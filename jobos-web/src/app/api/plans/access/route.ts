import { createClient } from "@/lib/supabase/server";
import { hasCandidateProAccess } from "@/lib/recruiters/server";

export async function GET() {
  const { data: { user } } = await (await createClient()).auth.getUser();
  const headers = { "Cache-Control": "private, no-store" };
  if (!user) return Response.json({ pro: false }, { status: 401, headers });
  try {
    return Response.json({ pro: await hasCandidateProAccess(user.id) }, { headers });
  } catch {
    return Response.json({ error: "Plan access could not be checked." }, { status: 503, headers });
  }
}

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, AdminAuthError } from "@/lib/analytics/admin";
import { UUID } from "@/lib/analytics/productModel";
const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex", "Vary": "Cookie" };
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) return Response.json({ error: "Please sign in." }, { status: 401, headers });
  try { await requireAdmin(user.id); } catch (error) { return Response.json({ error: "Admin access required." }, { status: error instanceof AdminAuthError ? error.statusCode : 500, headers }); }
  const { id } = await context.params; if (!UUID.test(id)) return Response.json({ error: "Invalid account ID." }, { status: 400, headers });
  const db = createAdminClient();
  const [events, matches] = await Promise.all([
    db.from("product_analytics_events").select("id,event_name,properties,occurred_at").eq("user_id", id).order("occurred_at", { ascending: false }).limit(50),
    db.from("match_results").select("id,status,created_at,completed_at").eq("user_id", id).order("created_at", { ascending: false }).limit(20),
  ]);
  if (events.error || matches.error) return Response.json({ error: "This activity history could not load. No empty history was assumed." }, { status: 503, headers });
  return Response.json({ events: events.data, matches: matches.data }, { headers });
}

import { createClient } from "@/lib/supabase/server";
import { requireAdmin, AdminAuthError } from "@/lib/analytics/admin";
import { analyticsPeriod } from "@/lib/analytics/productModel";
import { adminSnapshot } from "@/lib/analytics/snapshot";
export const runtime = "nodejs";
export const maxDuration = 40;
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow", "Vary": "Cookie" };
export async function GET(request: Request) {
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) return Response.json({ error: "Please sign in." }, { status: 401, headers });
  try { await requireAdmin(user.id); }
  catch (error) { return Response.json({ error: "Admin access is required." }, { status: error instanceof AdminAuthError ? error.statusCode : 500, headers }); }
  const params = new URL(request.url).searchParams, days = analyticsPeriod(params.get("days"));
  const page = Number(params.get("page") ?? 1), query = (params.get("q") ?? "").trim(), plan = params.get("plan") ?? "all", staff = params.get("staff") ?? "false";
  if (!days || !Number.isSafeInteger(page) || page < 1 || page > 10000 || query.length > 80 || !["all", "free", "pro"].includes(plan) || !["true", "false"].includes(staff)) return Response.json({ error: "Choose a valid reporting period and filters." }, { status: 400, headers });
  try { return Response.json(await adminSnapshot({ days, page, query, plan, includeStaff: staff === "true" }), { headers }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Analytics are temporarily unavailable." }, { status: 503, headers }); }
}

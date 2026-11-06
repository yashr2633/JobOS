import { createClient } from "@/lib/supabase/server";
import { isDocumentRequestOrigin } from "@/lib/documents/requestOrigin";
import { reconcilePayU } from "@/lib/billing/payu";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  if (!isDocumentRequestOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403, headers });
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) return Response.json({ error: "Please sign in." }, { status: 401, headers });
  try { await reconcilePayU(user.id); return Response.json({ refreshed: true }, { headers }); }
  catch { return Response.json({ error: "Payment verification is pending. Do not pay again; try refreshing shortly." }, { status: 503, headers }); }
}

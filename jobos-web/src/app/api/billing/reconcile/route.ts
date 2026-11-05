import { createClient } from "@/lib/supabase/server";
import { isDocumentRequestOrigin } from "@/lib/documents/requestOrigin";
import { reconcileSubscription } from "@/lib/billing/server";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  if (!isDocumentRequestOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403, headers });
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) return Response.json({ error: "Please sign in." }, { status: 401, headers });
  try {
    const raw = await request.text();
    if (raw.length > 1000) throw new Error("Invalid request.");
    const body = JSON.parse(raw);
    if (typeof body?.checkoutId !== "string") return Response.json({ error: "Invalid checkout reference." }, { status: 400, headers });
    await reconcileSubscription(user.id, body.checkoutId);
    return Response.json({ checked: true }, { headers });
  } catch { return Response.json({ error: "Gateway status could not be refreshed. Your recorded payments are still available." }, { status: 503, headers }); }
}

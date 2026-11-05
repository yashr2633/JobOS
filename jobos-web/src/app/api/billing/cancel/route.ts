import { createClient } from "@/lib/supabase/server";
import { isDocumentRequestOrigin } from "@/lib/documents/requestOrigin";
import { cancelSubscription } from "@/lib/billing/server";
export const runtime = "nodejs";
export const maxDuration = 45;
export async function POST(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  if (!isDocumentRequestOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403, headers });
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) return Response.json({ error: "Please sign in." }, { status: 401, headers });
  try {
    const raw = await request.text();
    if (raw.length > 1000) throw new Error("Invalid request.");
    const body = JSON.parse(raw);
    if (typeof body?.checkoutId !== "string" || body.confirm !== true) return Response.json({ error: "Confirm cancellation first." }, { status: 400, headers });
    await cancelSubscription(user.id, body.checkoutId);
    return Response.json({ message: "Renewal cancellation requested. Your confirmed paid access continues through its expiry date." }, { headers });
  } catch { return Response.json({ error: "Cancellation could not be confirmed. Refresh the billing status or contact support." }, { status: 503, headers }); }
}

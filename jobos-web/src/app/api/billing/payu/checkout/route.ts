import { createClient } from "@/lib/supabase/server";
import { isDocumentRequestOrigin } from "@/lib/documents/requestOrigin";
import { createPayUCheckout } from "@/lib/billing/payu";
import { validatePayUCheckout } from "@/lib/billing/payuCheckoutInput";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  if (!isDocumentRequestOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403, headers });
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) return Response.json({ error: "Please sign in before checkout." }, { status: 401, headers });
  try {
    const raw = await request.text();
    if (raw.length > 2000) return Response.json({ error: "Invalid checkout request." }, { status: 400, headers });
    const body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Invalid checkout request." }, { status: 400, headers });
    const input = validatePayUCheckout(body);
    if (!input.ok) return Response.json({ error: input.error, field: input.field }, { status: 400, headers });
    return Response.json(await createPayUCheckout(user, input.value.plan, input.value.firstname, input.value.phone), { headers });
  } catch {
    return Response.json({ error: "Checkout could not start. Your payment has not been initiated. Refresh your payment status before retrying." }, { status: 503, headers });
  }
}

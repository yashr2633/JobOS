import { createClient } from "@/lib/supabase/server";
import { isDocumentRequestOrigin } from "@/lib/documents/requestOrigin";
import { createCheckout } from "@/lib/billing/server";
import { isBillingPlan } from "@/lib/billing/plans";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  if (!isDocumentRequestOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403, headers });
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) return Response.json({ error: "Please sign in before checkout." }, { status: 401, headers });
  try {
    const raw = await request.text();
    if (raw.length > 1000) return Response.json({ error: "Invalid checkout request." }, { status: 400, headers });
    const body = JSON.parse(raw);
    if (!isBillingPlan(body?.plan) || body.renewalConsent !== true) return Response.json({ error: "Choose a plan and accept its renewal terms." }, { status: 400, headers });
    return Response.json({ ...await createCheckout(user.id, body.plan), email: user.email }, { headers });
  } catch (error) {
    if (error instanceof SyntaxError) return Response.json({ error: "Invalid checkout request." }, { status: 400, headers });
    const message = error instanceof Error ? error.message : "Checkout could not start. Please retry shortly.";
    return Response.json({ error: message }, { status: 503, headers });
  }
}

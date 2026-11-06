import { createClient } from "@/lib/supabase/server";
import { isDocumentRequestOrigin } from "@/lib/documents/requestOrigin";
import { createPayUCheckout } from "@/lib/billing/payu";
import { isBillingPlan } from "@/lib/billing/plans";
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
    const name = typeof body.firstname === "string" ? body.firstname.trim() : "";
    const phone = typeof body.phone === "string" ? body.phone.replace(/[\s()-]/g, "").replace(/^\+91/, "") : "";
    if (!isBillingPlan(body.plan) || body.purchaseConsent !== true || !/^[\p{L}\p{M} .'-]{2,70}$/u.test(name) || !/^[6-9]\d{9}$/.test(phone)) return Response.json({ error: "Choose a plan, enter your name and Indian mobile number, and accept the one-time purchase terms." }, { status: 400, headers });
    return Response.json(await createPayUCheckout(user, body.plan, name, phone), { headers });
  } catch {
    return Response.json({ error: "Checkout could not start. Your payment has not been initiated. Refresh your payment status before retrying." }, { status: 503, headers });
  }
}

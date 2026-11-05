import { createClient } from "@/lib/supabase/server";
import { isDocumentRequestOrigin } from "@/lib/documents/requestOrigin";
import { ownedSubscription, syncPayment } from "@/lib/billing/server";
import { providerId, validSignature } from "@/lib/billing/verification";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  if (!isDocumentRequestOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403, headers });
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) return Response.json({ error: "Please sign in." }, { status: 401, headers });
  try {
    const raw = await request.text();
    if (raw.length > 2000) return Response.json({ error: "Invalid payment reference." }, { status: 400, headers });
    const body = JSON.parse(raw);
    if (typeof body?.checkoutId !== "string" || !providerId(body.paymentId, "pay") || typeof body.signature !== "string") return Response.json({ error: "Invalid payment reference." }, { status: 400, headers });
    const row = await ownedSubscription(user.id, body.checkoutId);
    if (!row?.provider_subscription_id) return Response.json({ error: "Subscription not found." }, { status: 404, headers });
    // The subscription id comes from our user-owned server record, never from Checkout.
    if (!validSignature(`${body.paymentId}|${row.provider_subscription_id}`, body.signature, process.env.RAZORPAY_KEY_SECRET ?? "")) return Response.json({ error: "Payment verification failed." }, { status: 400, headers });
    const confirmed = await syncPayment(row, body.paymentId);
    return Response.json({ confirmed, testMode: row.mode === "test", message: confirmed ? "Your payment is confirmed." : "Payment is still being confirmed. Do not pay again; refresh your billing status shortly." }, { status: confirmed ? 200 : 202, headers });
  } catch {
    return Response.json({ error: "Confirmation could not finish. Do not pay again; refresh your billing status or contact support." }, { status: 503, headers });
  }
}

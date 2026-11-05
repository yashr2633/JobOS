import { processWebhook } from "@/lib/billing/server";
import { validSignature } from "@/lib/billing/verification";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "Webhook setup incomplete." }, { status: 503 });
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 250000) return Response.json({ error: "Payload too large." }, { status: 413 });
    if (!validSignature(raw, request.headers.get("x-razorpay-signature"), secret)) return Response.json({ error: "Invalid signature." }, { status: 400 });
    const eventId = request.headers.get("x-razorpay-event-id");
    if (!eventId || !/^[A-Za-z0-9_-]{6,200}$/.test(eventId)) return Response.json({ error: "Missing event reference." }, { status: 400 });
    const body = JSON.parse(raw);
    if (typeof body?.event !== "string") return Response.json({ error: "Invalid event." }, { status: 400 });
    await processWebhook(body, eventId);
    return Response.json({ received: true });
  } catch { return Response.json({ error: "Event was not processed. Retry delivery." }, { status: 503 }); }
}

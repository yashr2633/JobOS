import "server-only";
import { receivePayU } from "./payu";
import { SITE_ORIGIN } from "@/lib/seo/metadata";
export async function payuCallback(request: Request, redirect: boolean) {
  const headers = { "Cache-Control": "no-store" };
  if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) return Response.json({ error: "Expected form notification." }, { status: 415, headers });
  const raw = await request.text();
  if (raw.length > 65536) return Response.json({ error: "Invalid notification." }, { status: 413, headers });
  const params = new URLSearchParams(raw), fields: Record<string, string> = {};
  for (const [key, value] of params) {
    if (Object.hasOwn(fields, key)) return Response.json({ error: "Duplicate notification field." }, { status: 400, headers });
    Object.defineProperty(fields, key, { value, enumerable: true });
  }
  try {
    const result = await receivePayU(fields);
    if (!result.valid) return Response.json({ error: "Notification verification failed." }, { status: 400, headers });
    if (redirect) return Response.redirect(`${SITE_ORIGIN}/plans?payment=${result.confirmed ? "verified" : "pending"}`, 303);
    return Response.json({ received: true, confirmed: result.confirmed }, { headers });
  } catch {
    if (redirect) return Response.redirect(`${SITE_ORIGIN}/plans?payment=pending`, 303);
    return Response.json({ error: "Confirmation pending. Retry notification." }, { status: 503, headers });
  }
}

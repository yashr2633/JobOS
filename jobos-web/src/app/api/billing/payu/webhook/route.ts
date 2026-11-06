import { payuCallback } from "@/lib/billing/payuCallback";
import { payuReady } from "@/lib/billing/payu";
export const runtime = "nodejs";
export const POST = (request: Request) => payuCallback(request, false);
export const GET = () => Response.json({ provider: "PayU", endpoint: "payment notifications", method: "POST", checkoutEnabled: payuReady() }, { headers: { "Cache-Control": "no-store" } });

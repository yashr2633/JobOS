import { payuCallback } from "@/lib/billing/payuCallback";
export const runtime = "nodejs";
export const POST = (request: Request) => payuCallback(request, true);

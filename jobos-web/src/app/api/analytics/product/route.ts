import { createClient } from "@/lib/supabase/server";
import { isDocumentRequestOrigin } from "@/lib/documents/requestOrigin";
import { parseProductEvent } from "@/lib/analytics/productModel";
import { recordProductEvent } from "@/lib/analytics/productServer";
export const runtime = "nodejs";
const attempts = new Map<string, { count: number; until: number }>();
const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
export async function POST(request: Request) {
  if (!isDocumentRequestOrigin(request)) return Response.json({ error: "Invalid origin." }, { status: 403, headers });
  if (!request.headers.get("content-type")?.includes("application/json")) return new Response(null, { status: 415, headers });
  if (/bot|crawler|spider|headless/i.test(request.headers.get("user-agent") ?? "")) return new Response(null, { status: 204, headers });
  const key = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"; const now = Date.now();
  for (const [id, row] of attempts) if (row.until < now) attempts.delete(id);
  const row = attempts.get(key) ?? { count: 0, until: now + 60000 };
  if (row.count >= 90 || (!attempts.has(key) && attempts.size >= 2500)) return new Response(null, { status: 429, headers });
  row.count++; attempts.set(key, row);
  const reader = request.body?.getReader(); if (!reader) return new Response(null, { status: 400, headers });
  const decoder = new TextDecoder(); let size = 0, raw = "";
  try {
    for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength;
      if (size > 3500) { await reader.cancel(); return new Response(null, { status: 413, headers }); }
      raw += decoder.decode(chunk.value, { stream: true });
    }
    raw += decoder.decode();
  } catch { return new Response(null, { status: 400, headers }); }
  let value; try { value = parseProductEvent(JSON.parse(raw)); } catch { return new Response(null, { status: 400, headers }); }
  if (!value) return new Response(null, { status: 400, headers });
  const { data: { user } } = await (await createClient()).auth.getUser();
  // IP addresses and user agents are used only for the in-memory burst guard; never persisted.
  await recordProductEvent(user?.id ?? null, value.event, value.properties, value.session, value.id);
  return new Response(null, { status: 204, headers });
}

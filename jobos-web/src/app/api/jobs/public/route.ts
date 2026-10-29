import { NextResponse } from "next/server";
import { publicJobFilters } from "@/lib/jobs/publicBrowsing";
import { readPublicJobFeed } from "@/lib/jobs/publicFeed";
export const runtime = "nodejs";
export const maxDuration = 35;
const attempts = new Map<string, { count: number; since: number }>();
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };
  const params = new URL(request.url).searchParams, filters = publicJobFilters(params), offset = Number(params.get("offset") ?? 0);
  if (!filters || !Number.isInteger(offset) || offset < 0 || offset > 10000) return NextResponse.json({ error: "Use a valid short role, company, city and filter selection." }, { status: 400, headers });
  const now = Date.now(), key = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "public";
  for (const [id, item] of attempts) if (now - item.since >= 60000) attempts.delete(id);
  const previous = attempts.get(key);
  if ((previous?.count ?? 0) >= 60 || (!previous && attempts.size >= 2000)) return NextResponse.json({ error: "Please wait briefly before searching again." }, { status: 429, headers: { ...headers, "Retry-After": "60" } });
  attempts.set(key, { count: (previous?.count ?? 0) + 1, since: previous?.since ?? now });
  try { return NextResponse.json(await readPublicJobFeed(filters, offset), { headers }); }
  catch { return NextResponse.json({ error: "Job sources could not finish loading. Retry here; no vacancy count could be confirmed." }, { status: 503, headers }); }
}

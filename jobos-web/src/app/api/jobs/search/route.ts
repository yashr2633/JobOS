import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCachedRemoteCatalog } from "@/lib/jobs/cachedCatalog";
import { publicJobQuery } from "@/lib/jobs/searchSuggestions";

export const runtime = "nodejs";
export const maxDuration = 40;
const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };
// Lightweight per-instance burst guard; public provider quotas still apply.
const attempts = new Map<string, { since: number; count: number }>();
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401, headers });
  const raw = new URL(request.url).searchParams.get("q") ?? "", query = publicJobQuery(raw);
  if (raw.length > 120 || (raw.trim() && !query)) return NextResponse.json({ error: "Use role, skill or company keywords without contact details or URLs." }, { status: 400, headers });
  const now = Date.now(), previous = attempts.get(user.id);
  if (previous && now - previous.since < 60_000 && previous.count >= 10) return NextResponse.json({ error: "Please wait before another search." }, { status: 429, headers: { ...headers, "Retry-After": "60" } });
  if (attempts.size >= 2000) for (const [id, entry] of attempts) if (now - entry.since >= 60_000) attempts.delete(id);
  if (attempts.size >= 2000 && !previous) return NextResponse.json({ error: "Additional sources are busy. Please retry." }, { status: 429, headers });
  attempts.set(user.id, { since: previous && now - previous.since < 60_000 ? previous.since : now, count: previous && now - previous.since < 60_000 ? previous.count + 1 : 1 });
  try { return NextResponse.json(await getCachedRemoteCatalog(query), { headers }); }
  catch { return NextResponse.json({ error: "Additional job sources are temporarily unavailable. Employer listings are still available." }, { status: 503, headers }); }
}

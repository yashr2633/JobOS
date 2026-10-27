import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { searchPublicJobs, WebSearchError } from "@/lib/jobs/webSearch";
import { validateWebQuery } from "@/lib/jobs/webSearchContract";
import { withinJobDeadline } from "@/lib/jobs/response";

export const runtime = "nodejs";
export const maxDuration = 60;
// Request counters only, never search responses/links. This is a per-instance
// burst guard, not a distributed billing cap. Provider project quotas also apply.
const requests = new Map<string, { day: string; count: number; minute: number; turns: number; pending: boolean }>();
let total = { day: "", count: 0 }, inFlight = 0;
const headers = { "Cache-Control": "private, no-store, max-age=0", "X-Robots-Tag": "noindex, nofollow" };
async function search(request: Request, deadline: number) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in to search." }, { status: 401, headers });
  let query;
  try { const raw = await request.text(); if (raw.length > 1000) throw new Error(); query = validateWebQuery(JSON.parse(raw)); } catch { query = null; }
  if (!query) return NextResponse.json({ error: "Enter job keywords and an Indian city or state, without contact details or URLs." }, { status: 400, headers });
  if (Date.now() > deadline) return NextResponse.json({ error: "Search took too long to start. Please retry." }, { status: 503, headers });
  const day = new Date().toISOString().slice(0, 10), now = Date.now();
  if (total.day !== day) { total = { day, count: 0 }; requests.clear(); }
  const previous = requests.get(user.id);
  if (inFlight >= 2 || total.count >= 100 || (previous && (previous.pending || (now - previous.minute < 60_000 && previous.turns >= 4) || previous.count >= 20)))
    return NextResponse.json({ error: "Please wait before another web search, or try again later if today's allowance is reached." }, { status: 429, headers: { ...headers, "Retry-After": "30" } });
  if (requests.size >= 3000) return NextResponse.json({ error: "Web search is busy. Please retry later." }, { status: 429, headers });
  const sameMinute = previous && now - previous.minute < 60_000;
  const entry = { day, count: (previous?.count ?? 0) + 1, minute: sameMinute ? previous.minute : now, turns: sameMinute ? previous.turns + 1 : 1, pending: true };
  requests.set(user.id, entry); total.count++; inFlight++;
  try { return NextResponse.json(await searchPublicJobs(query), { headers }); }
  catch (error) { return NextResponse.json({ error: error instanceof WebSearchError ? error.message : "Web search did not complete. Please retry shortly." }, { status: error instanceof WebSearchError ? error.status : 503, headers: { ...headers, ...(error instanceof WebSearchError && error.retryAfterSeconds ? { "Retry-After": String(error.retryAfterSeconds) } : {}) } }); }
  finally { entry.pending = false; inFlight--; }
}
export async function POST(request: Request) {
  try { return await withinJobDeadline(() => search(request, Date.now() + 5000), 53000); }
  catch { return NextResponse.json({ error: "Public-source search could not respond. Retry; employer listings remain available." }, { status: 503, headers }); }
}

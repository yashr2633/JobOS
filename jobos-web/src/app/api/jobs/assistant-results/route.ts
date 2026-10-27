import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCachedCatalog, getCachedRemoteCatalog } from "@/lib/jobs/cachedCatalog";
import { validateCareerIntent } from "@/lib/jobs/careerIntent";
import { assistantJobs, assistantPage } from "@/lib/jobs/assistantSearch";
import { withinJobDeadline } from "@/lib/jobs/response";

export const runtime = "nodejs";
export const maxDuration = 40;
const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };
const attempts = new Map<string, { since: number; count: number }>();
export async function POST(request: Request) {
  if (request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers });
  try {
    return await withinJobDeadline(async () => {
      const client = await createClient(), { data: { user } } = await client.auth.getUser();
      if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401, headers });
      let input;
      try { const text = await request.text(); if (text.length > 1500) throw new Error(); input = JSON.parse(text); } catch { return NextResponse.json({ error: "Enter a short job-search request." }, { status: 400, headers }); }
      const intent = validateCareerIntent(input?.intent), offset = input?.offset ?? 0;
      if (!intent || !(intent.role || intent.company || intent.experience === "entry") || !Number.isInteger(offset) || offset < 0 || offset > 10000) return NextResponse.json({ error: "Use a valid role, company or fresher search." }, { status: 400, headers });
      const now = Date.now(), previous = attempts.get(user.id);
      if (previous && now - previous.since < 60000 && previous.count >= 20) return NextResponse.json({ error: "Please wait before loading more jobs." }, { status: 429, headers });
      for (const [id, value] of attempts) if (now - value.since >= 60000) attempts.delete(id);
      if (attempts.size >= 2000 && !previous) return NextResponse.json({ error: "Job search is busy. Please retry shortly." }, { status: 429, headers });
      attempts.set(user.id, { since: previous && now - previous.since < 60000 ? previous.since : now, count: previous && now - previous.since < 60000 ? previous.count + 1 : 1 });
      const results = await Promise.allSettled([
        withinJobDeadline(() => getCachedCatalog(), 25000),
        withinJobDeadline(() => getCachedRemoteCatalog([intent.role, intent.company].filter(Boolean).join(" ")), 18000),
      ]);
      const catalogs = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
      if (!catalogs.length) return NextResponse.json({ error: "The connected job feeds could not load. Public-source search remains available in this conversation." }, { status: 503, headers });
      const checkedAt = new Date().toISOString();
      return NextResponse.json({ ...assistantPage(assistantJobs(catalogs.flatMap(catalog => catalog.jobs), intent, Date.now()), offset), checkedAt,
        warnings: [...new Set([...catalogs.flatMap(catalog => catalog.warnings), ...(results.some(result => result.status === "rejected") ? ["Some feeds could not load. Results may be incomplete."] : [])])] }, { headers });
    }, 35000);
  } catch { return NextResponse.json({ error: "Job feeds took too long to respond. Retry here; public-source search is separate." }, { status: 503, headers }); }
}

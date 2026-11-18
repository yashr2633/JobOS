import { NextResponse } from "next/server";
import { getCachedCatalog, getCachedRemoteCatalog } from "@/lib/jobs/cachedCatalog";
import { isActiveRecommendation } from "@/lib/jobs/ranking";
import { plainText, safeJobUrl } from "@/lib/jobs/normalize";
import { withinJobDeadline } from "@/lib/jobs/response";

export const runtime = "nodejs";
export const maxDuration = 20;

const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  const query = (params.get("q") ?? "").trim();
  if (!id || id.length > 150 || query.length > 100) {
    return NextResponse.json({ error: "Invalid job listing." }, { status: 400, headers });
  }

  try {
    const catalog = await withinJobDeadline(getCachedCatalog, 7_000);
    let job = catalog.jobs.find(item => item.id === id);
    if (!job && query) {
      const remote = await withinJobDeadline(() => getCachedRemoteCatalog(query), 6_000);
      job = remote.jobs.find(item => item.id === id);
    }
    if (!job || !isActiveRecommendation(job, Date.now())) {
      return NextResponse.json({ error: "This listing is no longer in the current feed." }, { status: 404, headers });
    }
    return NextResponse.json({
      job: {
        id: job.id,
        description: plainText(job.description).slice(0, 24_000),
        requirements: job.requirements.map(plainText).filter(Boolean).slice(0, 30),
        applicationUrl: safeJobUrl(job.applicationUrl),
        sourceUrl: safeJobUrl(job.sourceUrl),
      },
    }, { headers });
  } catch {
    return NextResponse.json({ error: "Job details could not load. Please try again." }, { status: 503, headers });
  }
}

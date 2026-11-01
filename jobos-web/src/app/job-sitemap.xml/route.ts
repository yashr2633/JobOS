import { getCachedCatalog } from "@/lib/jobs/cachedCatalog";
import { JOB_CITIES, opportunitySitemap, isPublicOpportunity } from "@/lib/seo/jobs";
import { SITE_ORIGIN } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const catalog = await getCachedCatalog();
    if (!catalog.jobs.length && catalog.warnings.length) throw new Error("Sources unavailable");
    const urls = opportunitySitemap(catalog.jobs);
    for (const city of JOB_CITIES) {
      if (catalog.jobs.some(job => isPublicOpportunity(job) && city.aliases.test(job.location))) urls.push(`${SITE_ORIGIN}/locations/${city.slug}`);
    }
    const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(url => `<url><loc>${escape(url)}</loc></url>`).join("")}</urlset>`;
    return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=0, s-maxage=300, must-revalidate" } });
  } catch {
    // Never replace a healthy sitemap with an empty successful response on outage.
    return new Response("Job sources could not be checked. Please retry.", { status: 503, headers: { "Retry-After": "300", "Cache-Control": "no-store" } });
  }
}

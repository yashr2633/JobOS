import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { notFound } from "next/navigation";
import PublicInfoPage from "../../components/PublicInfoPage";
import PublicJobBrowser from "../../components/PublicJobBrowser";
import { getCachedCatalog } from "@/lib/jobs/cachedCatalog";
import { DEFAULT_PUBLIC_FILTERS, publicJobPage } from "@/lib/jobs/publicBrowsing";
import { JOB_CITIES, isPublicOpportunity } from "@/lib/seo/jobs";
import { publicPageMetadata } from "@/lib/seo/metadata";
import "../../public-home.css";

export const dynamic = "force-dynamic";
const readCity = cache(async (slug: string) => {
  const city = JOB_CITIES.find(item => item.slug === slug);
  if (!city) notFound();
  const catalog = await getCachedCatalog();
  const filters = { ...DEFAULT_PUBLIC_FILTERS, location: city.name };
  const initial = { ...publicJobPage(catalog.jobs, filters), warnings: catalog.warnings, vocabulary: [], loadedAt: catalog.checkedAt };
  const indexable = catalog.jobs.some(job => isPublicOpportunity(job) && city.aliases.test(job.location));
  return { city, filters, initial, indexable };
});
export async function generateMetadata({ params }: { params: Promise<{ city: string }> }): Promise<Metadata> {
  const { city, indexable } = await readCity((await params).city);
  const metadata = publicPageMetadata(`/locations/${city.slug}`, `Jobs in ${city.name}, India`, `Explore jobs in ${city.name} from connected employer sources. Check available roles, requirements and source dates, then sign in to continue your application.`);
  return indexable ? metadata : { ...metadata, robots: { index: false, follow: true } };
}
export default async function CityJobsPage({ params }: { params: Promise<{ city: string }> }) {
  const { city, filters, initial } = await readCity((await params).city);
  return <PublicInfoPage><p className="seo-kicker">EXPLORE OPPORTUNITIES BY LOCATION</p><h1>Jobs in {city.name}</h1><p className="seo-lead">Browse opportunities from connected sources for {city.name}. Requirements and current availability come from the employer; source coverage varies.</p><section className="seo-card"><h2>Find a role that fits your experience</h2><p>Use the experience, work mode and publication filters below. An unknown publication date is not a new posting. India-eligible remote alternatives may also appear and are labelled separately.</p><p>Read the full role details before applying. You can browse here without an account; sign in to continue your application or compare your resume with a job description.</p><Link className="seo-link" href="/features/resume-match">How Resume Match works</Link></section><form action="/jobs" className="seo-search"><label>Role, skill or company<input name="q" type="search" placeholder="For example, Sales Executive" maxLength={120} /></label><input type="hidden" name="location" value={city.name} /><button className="seo-button" type="submit">Search jobs in {city.name}</button></form><div className="public-home"><PublicJobBrowser initial={initial} initialFilters={filters} /></div><section className="seo-card"><h2>Explore other locations</h2><div className="seo-info-links">{JOB_CITIES.filter(other => other.slug !== city.slug).map(other => <Link key={other.slug} href={`/locations/${other.slug}`}>{other.name}</Link>)}</div><Link className="seo-link" href="/jobs">Search all India jobs</Link></section></PublicInfoPage>;
}

import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import PublicInfoPage from "../components/PublicInfoPage";
import { getCachedCatalog } from "@/lib/jobs/cachedCatalog";
import { isPublicListing, JOB_CITIES, opportunityPath } from "@/lib/seo/jobs";
import { publicPageMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const pagePath = (page: number) => page === 1 ? "/opportunities" : `/opportunities?page=${page}`;
const readPage = cache(async (raw: string | string[] | undefined) => {
  if (Array.isArray(raw) || (raw !== undefined && !/^[1-9]\d{0,4}$/.test(raw))) notFound();
  if (raw === "1") redirect("/opportunities");
  const page = Number(raw ?? 1), catalog = await getCachedCatalog();
  if (!catalog.jobs.length && catalog.warnings.length) throw new Error("Job sources temporarily unavailable. Please try again shortly.");
  const jobs = [...new Map(catalog.jobs.filter(job => isPublicListing(job)).map(job => [job.id, job])).values()]
    .sort((a, b) => a.company.localeCompare(b.company) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  const pages = Math.max(1, Math.ceil(jobs.length / 50));
  if (page > pages) notFound();
  return { page, pages, total: jobs.length, jobs: jobs.slice((page - 1) * 50, page * 50), warnings: catalog.warnings };
});
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { page, total } = await readPage((await searchParams).page);
  const metadata = publicPageMetadata(pagePath(page), `India job directory${page > 1 ? ` — Page ${page}` : ""}`, "Browse employer-sourced job openings in India by company and role. Open a vacancy for requirements and application details.");
  return total ? metadata : { ...metadata, robots: { index: false, follow: true } };
}
export default async function OpportunityDirectory({ searchParams }: Props) {
  const { page, pages, total, jobs, warnings } = await readPage((await searchParams).page);
  return <PublicInfoPage>
    <p className="seo-kicker">BROWSE EMPLOYER-SOURCED OPENINGS</p>
    <h1>India job directory{page > 1 ? ` — Page ${page}` : ""}</h1>
    <p className="seo-lead">Explore roles by company, read the employer’s requirements and prepare before applying. These are listings from connected sources, not a complete count of jobs in India.</p>
    <div className="seo-actions"><Link className="seo-button" href="/jobs">Search and filter jobs</Link><Link className="seo-link" href="/job-search">Browse jobs by role and city</Link><Link className="seo-link" href="/guides/tailor-resume-to-job-description">Prepare a resume for your chosen role</Link></div>
    <p>{total.toLocaleString("en-IN")} source-listed openings · Page {page} of {pages}. Listings can change as employers update their feeds.</p>
    {warnings.length > 0 && <p role="status">Some employer sources are temporarily unavailable; this directory may be incomplete.</p>}
    <section aria-label="Job openings">{jobs.map(job => <article className="seo-card" key={job.id}>
      <p className="seo-kicker">{job.company}</p><h2><Link className="seo-link" prefetch={false} href={opportunityPath(job.id)}>{job.title}</Link></h2>
      <p>{job.location}{job.employmentType ? ` · ${job.employmentType}` : ""}{job.workMode ? ` · ${job.workMode}` : ""}</p>
      <p>Source: {job.source}. Review the full description and eligibility before applying.</p>
    </article>)}</section>
    <nav className="seo-info-links" aria-label="Job directory pages">
      {page > 1 && <Link prefetch={false} href={pagePath(page - 1)}>← Previous page</Link>}
      {Array.from({ length: pages }, (_, i) => i + 1).map(number => <Link key={number} prefetch={false} href={pagePath(number)} aria-current={page === number ? "page" : undefined}>{number}</Link>)}
      {page < pages && <Link prefetch={false} href={pagePath(page + 1)}>Next page →</Link>}
    </nav>
    <section className="seo-card"><h2>Explore by location</h2><div className="seo-info-links">{JOB_CITIES.map(city => <Link key={city.slug} href={`/locations/${city.slug}`}>{city.name}</Link>)}</div></section>
  </PublicInfoPage>;
}

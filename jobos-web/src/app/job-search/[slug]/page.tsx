import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { notFound } from "next/navigation";
import PublicInfoPage from "../../components/PublicInfoPage";
import { getCachedCatalog } from "@/lib/jobs/cachedCatalog";
import { buildJobCollections, collectionPath, JOB_COLLECTIONS, MIN_COLLECTION_JOBS } from "@/lib/seo/jobCollections";
import { opportunityPath } from "@/lib/seo/jobs";
import { publicPageMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }> };

const readCollection = cache(async (slug: string) => {
  if (!JOB_COLLECTIONS.some(item => item.slug === slug)) notFound();
  const { jobs, warnings } = await getCachedCatalog();
  const all = buildJobCollections(jobs);
  const item = all.find(candidate => candidate.slug === slug)!;
  const related = all.filter(candidate => candidate.slug !== slug &&
    candidate.jobs.length >= MIN_COLLECTION_JOBS &&
    (candidate.city?.slug === item.city?.slug || candidate.role === item.role)
  ).slice(0, 8);
  return { item, related, warnings };
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { item } = await readCollection((await params).slug);
  const metadata = publicPageMetadata(collectionPath(item), item.title,
    `Browse ${item.title.toLowerCase()} from connected employer sources. Check requirements, location and application details.`);
  return item.jobs.length >= MIN_COLLECTION_JOBS ? metadata : { ...metadata, robots: { index: false, follow: true } };
}

export default async function JobCollectionPage({ params }: Props) {
  const { item, related, warnings } = await readCollection((await params).slug);
  const filters = new URLSearchParams({ q: item.role.query, location: item.city?.name ?? "India" });
  return (
    <PublicInfoPage>
      <Link className="seo-link" href="/job-search">Browse roles and cities</Link>
      <h1>{item.title}</h1>
      <p className="seo-lead">{item.jobs.length ? `${item.jobs.length} matching employer listings in the connected feeds.` : "No matching jobs are available from the connected feeds right now."}</p>
      {!!warnings.length && <p role="status">Some employer feeds are temporarily unavailable. Results may be incomplete.</p>}
      <div className="seo-actions">
        <Link className="seo-button" href={`/job-alerts?${filters}`}>Get job alerts by email</Link>
        <Link className="seo-link" href={`/jobs?${filters}`}>Search with more filters</Link>
      </div>
      {item.jobs.length > 40 && <p>Showing 40 listings. Use search to filter by company, location or date.</p>}
      <section aria-label="Matching job openings">
        {item.jobs.slice(0, 40).map(job => (
          <article className="seo-card" key={job.id}>
            <h2><Link className="seo-link" prefetch={false} href={opportunityPath(job.id)}>{job.title}</Link></h2>
            <p>{[job.company, job.location, job.workMode, job.employmentType].filter(Boolean).join(" · ")}</p>
            <p>Source {job.source}{job.postedAt ? ` · Posted ${job.postedAt.slice(0, 10)}` : ""}</p>
          </article>
        ))}
      </section>
      <section className="seo-card">
        <h2>Before you apply</h2><p>{item.role.tip}</p>
        <Link className="seo-link" href="/guides/tailor-resume-to-job-description">See how to tailor your resume to a job description</Link>
      </section>
      {related.length > 0 && <section className="seo-card"><h2>Related searches</h2>
        <div className="seo-info-links">{related.map(other => <Link key={other.slug} prefetch={false} href={collectionPath(other)}>{other.title}</Link>)}</div>
      </section>}
    </PublicInfoPage>
  );
}


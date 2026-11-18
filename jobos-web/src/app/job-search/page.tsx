import Link from "next/link";
import PublicInfoPage from "../components/PublicInfoPage";
import { getCachedCatalog } from "@/lib/jobs/cachedCatalog";
import { buildJobCollections, collectionPath, MIN_COLLECTION_JOBS } from "@/lib/seo/jobCollections";
import { catalogJobCities } from "@/lib/seo/jobCities";
import { publicPageMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";
export const metadata = publicPageMetadata("/job-search", "Find jobs by role, experience and city", "Browse employer-sourced roles in India by job type, city and experience, including fresher jobs and internships.");

export default async function JobSearchHub() {
  const { jobs, warnings } = await getCachedCatalog();
  const collections = buildJobCollections(jobs).filter(item => item.jobs.length >= MIN_COLLECTION_JOBS);
  const cities = catalogJobCities(jobs);
  return (
    <PublicInfoPage>
      <h1>Find jobs by role and city</h1>
      <p className="seo-lead">Choose a collection to see matching employer listings, read the job requirements and prepare your application.</p>
      {!!warnings.length && <p role="status">Some employer feeds are temporarily unavailable. Results may be incomplete.</p>}
      {collections.length > 0 && <section className="seo-card">
        <h2>Job categories</h2>
        <ul>{collections.filter(item => !item.city).map(item => (
          <li key={item.slug}><Link className="seo-link" prefetch={false} href={collectionPath(item)}>{item.title}</Link> ({item.jobs.length})</li>
        ))}</ul>
      </section>}
      {cities.map(city => {
        const local = collections.filter(item => item.city?.slug === city.slug);
        return <section className="seo-card" key={city.slug}>
          <h2><Link className="seo-link" prefetch={false} href={`/locations/${city.slug}`}>Jobs in {city.name}</Link></h2>
          {local.length > 0 && <ul>{local.map(item => (
            <li key={item.slug}><Link className="seo-link" prefetch={false} href={collectionPath(item)}>{item.title}</Link> ({item.jobs.length})</li>
          ))}</ul>}
        </section>;
      })}
      <div className="seo-actions"><Link className="seo-button" href="/jobs">Search all jobs</Link><Link className="seo-link" href="/job-alerts">Get jobs by email</Link></div>
    </PublicInfoPage>
  );
}


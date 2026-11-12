import Link from "next/link";
import PublicInfoPage from "../components/PublicInfoPage";
import { publicPageMetadata } from "@/lib/seo/metadata";
import { publicJobQuery } from "@/lib/jobs/searchSuggestions";

export const metadata = publicPageMetadata("/job-alerts", "Job alerts by email", "Choose a role and city and get matching employer listings by email from JobTrackOS.");

type Props = { searchParams: Promise<{ q?: string | string[]; location?: string | string[] }> };

export default async function JobAlertsLanding({ searchParams }: Props) {
  const params = await searchParams;
  const query = typeof params.q === "string" ? publicJobQuery(params.q.slice(0, 100)) : "";
  const city = typeof params.location === "string" && /^[a-z ,.-]{1,100}$/i.test(params.location) ? params.location : "India";
  const preferences = new URLSearchParams({ q: query, location: city });
  const destination = `/settings/alerts?${preferences}`;
  const signup = new URLSearchParams({ next: destination, utm_source: "job_alerts_landing" });
  return (
    <PublicInfoPage>
      <h1>Get matching jobs by email</h1>
      <p className="seo-lead">Choose the role and city you want to follow. When matching new listings are available, JobTrackOS can send them to your verified account email.</p>
      <section className="seo-card">
        <h2>Set up your alert</h2>
        <ol>
          <li>Create your free account or open your existing alert settings.</li>
          <li>Review the role and city, choose daily or weekly, then enable email alerts.</li>
          <li>Open the job details when a listing interests you. Change or stop alerts anytime.</li>
        </ol>
        {query && <p>Suggested alert for <strong>{query}</strong> in <strong>{city}</strong>. You can edit it before saving.</p>}
        <div className="seo-actions">
          <Link className="seo-button" href={`/signup?${signup}`}>Create an account</Link>
          <Link className="seo-link" href={destination}>Open alert settings</Link>
        </div>
      </section>
      <Link className="seo-link" href="/job-search">Browse job collections</Link>
    </PublicInfoPage>
  );
}


import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { notFound } from "next/navigation";
import PublicInfoPage from "../../components/PublicInfoPage";
import { getLiveJob } from "@/lib/jobs/providers";
import { plainText } from "@/lib/jobs/normalize";
import { isPublicOpportunity, jobPosting, opportunityPath, opportunityId, safeJsonLd } from "@/lib/seo/jobs";
import { publicPageMetadata } from "@/lib/seo/metadata";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const read = unstable_cache((id: string) => getLiveJob(id), ["public-opportunity-detail-v1"], { revalidate: 60 });
const getOpportunity = cache(async (value: string) => {
  // Next may supply encoded page params and decoded metadata params. Normalize
  // exactly once, then validate before the allowlisted provider lookup.
  const id = opportunityId(value);
  if (!id) notFound();
  const job = await read(id);
  if (!job || !isPublicOpportunity(job)) notFound();
  return job;
});
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const job = await getOpportunity((await params).id);
  return publicPageMetadata(opportunityPath(job.id), `${job.title} at ${job.company}`, `${job.title} at ${job.company} in ${job.location}. Read the source job description, requirements and application information on JobTrackOS.`);
}
export default async function OpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const job = await getOpportunity((await params).id), structured = jobPosting(job);
  const next = `/jobs?${new URLSearchParams({ job: job.id, jobSource: job.sourceUrl })}`;
  const { data: { user } } = await (await createClient()).auth.getUser();
  const applyHref = user ? next : `/login?next=${encodeURIComponent(next)}`;
  const when = (value: string) => new Date(value).toLocaleDateString("en-IN", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });
  return <PublicInfoPage>{structured && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(structured) }} />}<Link className="seo-link" href="/jobs">← All India opportunities</Link><p className="seo-kicker">{job.company} · {job.source}</p><h1>{job.title}</h1><div className="seo-meta"><span>{job.location}</span>{job.workMode && <span>{job.workMode}</span>}{job.employmentType && <span>{job.employmentType}</span>}</div><div className="seo-actions"><Link className="seo-button" href={applyHref}>{user ? "View & apply" : "Sign in to view & apply"}</Link><Link className="seo-link" href="/features/resume-match">Prepare your resume for this role</Link></div><section className="seo-card"><h2>Job description</h2><div className="seo-description">{plainText(job.description)}</div></section>{job.requirements.length > 0 && <section className="seo-card"><h2>Requirements from the source</h2><ul>{job.requirements.map((requirement, index) => <li key={index}>{requirement}</li>)}</ul></section>}<section className="seo-card"><h2>Source and application information</h2><p>Employer: {job.company}. Source: <a className="seo-link" href={job.sourceUrl} target="_blank" rel="noopener noreferrer">{job.source}</a>.</p><p>{job.postedAt ? `Originally posted: ${when(job.postedAt)}.` : "The source has not supplied an original posting date."} {job.expiresAt ? `Application deadline: ${when(job.expiresAt)}.` : "No application deadline was supplied."}</p><p>Last source check: {when(job.fetchedAt)}. A source check is not a new publication date. Confirm availability and eligibility with the employer before applying.</p><p>This opportunity is sourced externally. Sign in to continue to the source application destination. JobTrackOS does not submit an application simply because you open a link.</p></section><div className="seo-actions"><Link className="seo-button" href={applyHref}>Continue to application</Link><Link className="seo-link" href="/features/cover-letter">Prepare a cover letter</Link></div></PublicInfoPage>;
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import PublicInfoPage from '../../../components/PublicInfoPage';
import { getCachedCatalog } from '@/lib/jobs/cachedCatalog';
import { plainText } from '@/lib/jobs/normalize';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Your job opportunity | JobTrackOS', robots: { index: false, follow: true } };

export default async function AlertJobPage({params}: {params: Promise<{id:string}>}) {
  const {id:rawId}=await params;
  let id:string;
  try { id=decodeURIComponent(rawId); } catch { notFound(); }
  // Resolve only jobs in our public catalog; never accept a caller-supplied redirect URL.
  const catalog=await getCachedCatalog().catch(()=>null);
  if(!catalog) return <PublicInfoPage><h1>We could not load this job just now.</h1><p>Please reload shortly. Your email link is still valid.</p><Link className="seo-button" href="/jobs">Browse jobs</Link></PublicInfoPage>;
  const job=catalog.jobs.find(item=>item.id===id);
  const expired=job?.expiresAt ? Date.parse(job.expiresAt)<=Date.parse(catalog.checkedAt) : false;
  if(!job || job.availability==='closed' || job.availability==='unavailable' || expired) return <PublicInfoPage><h1>This job is no longer in our current listings.</h1><p>The employer may have closed or changed this vacancy. Explore other opportunities on JobTrackOS.</p><Link className="seo-button" href="/jobs">Find more jobs</Link></PublicInfoPage>;
  const {data:{user}}=await (await createClient()).auth.getUser();
  const next=`/jobs?${new URLSearchParams({job:job.id,jobSource:job.sourceUrl,q:job.title,location:job.location})}`;
  const apply=user ? next : `/login?next=${encodeURIComponent(next)}`;
  return <PublicInfoPage>
    <Link className="seo-link" href="/jobs">← Explore more jobs</Link>
    <p className="seo-kicker">{job.company} is hiring</p><h1>{job.title}</h1>
    <div className="seo-meta"><span>{job.location}</span>{job.workMode&&<span>{job.workMode}</span>}{job.employmentType&&<span>{job.employmentType}</span>}</div>
    <div className="seo-actions"><Link className="seo-button" href={apply}>Apply now</Link><Link className="seo-link" href="/resume-match">Check your resume match</Link></div>
    {!user&&<p>Sign in when you apply to continue with this job and use your resume tools.</p>}
    <section className="seo-card"><h2>Job description</h2><div className="seo-description">{plainText(job.description)||'Open the full listing after signing in to review the employer’s requirements.'}</div></section>
    {job.requirements.length>0&&<section className="seo-card"><h2>Requirements</h2><ul>{job.requirements.map((item,index)=><li key={index}>{item}</li>)}</ul></section>}
    <section className="seo-card"><h2>About this listing</h2><p>Employer: {job.company} · Source: {job.source}</p>{job.postedAt&&<p>Posted: {job.postedAt.slice(0,10)}</p>}<p>JobTrackOS helps you discover and prepare for this opportunity. Final applications are completed on the employer’s application site.</p></section>
    <div className="seo-actions"><Link className="seo-button" href={apply}>Apply now</Link><Link className="seo-link" href="/resume-builder">Build your resume</Link></div>
  </PublicInfoPage>;
}

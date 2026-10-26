import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { discoveryData } from "@/lib/jobs/data";
import { getCatalog } from "@/lib/jobs/providers";
import { rankJob, compareRanked } from "@/lib/jobs/ranking";
import { selectedResume } from "@/lib/jobs/profile";
import { normalizeIndiaLocation } from "@/lib/jobs/sources-india";

export default async function RecommendedJobs() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const loaded = await Promise.all([discoveryData(supabase, user.id), getCatalog()]).catch(() => null);
  const hasResume = !!(loaded && selectedResume(loaded[0].resumes, loaded[0].profile.resumeId));
  const jobs = loaded ? loaded[1].jobs.filter(job => normalizeIndiaLocation(job.location).isIndia).map(job => rankJob(job, loaded[0].profile, selectedResume(loaded[0].resumes, loaded[0].profile.resumeId), Date.parse(loaded[1].checkedAt))).filter(item => item.eligible).sort((a, b) => compareRanked(a, b)).slice(0, 3) : [];
  return <section className="product-panel mt-6"><div className="flex items-center justify-between gap-4"><h2>Top jobs for you</h2><Link href="/jobs" className="text-sm text-accent">View all jobs →</Link></div>{jobs.length ? <div className="product-list mt-5">{jobs.map(({ job, fit }) => <Link className="product-list-row" key={job.id} href={`/jobs?job=${encodeURIComponent(job.id)}`}><div><strong>{job.title}</strong><p>{job.company} · {job.location}</p></div><span className="product-badge">{hasResume ? `${fit.score}/100 resume match` : "Based on your preferences"}</span></Link>)}</div> : <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-lg bg-surface-2 p-5"><p className="max-w-xl text-sm leading-6 text-text-secondary">Select a resume and preferred roles to improve recommendations. Available India opportunities appear in Find jobs.</p><Link className="product-button" href="/jobs">Find jobs</Link></div>}</section>;
}

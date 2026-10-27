import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { discoveryData } from "@/lib/jobs/data";
import { getCachedCatalog } from "@/lib/jobs/cachedCatalog";
import { rankJob, compareRanked } from "@/lib/jobs/ranking";
import { selectedResume } from "@/lib/jobs/profile";
import { normalizeIndiaLocation } from "@/lib/jobs/sources-india";
import { matchesDateWindow } from "@/lib/jobs/browsing";
import { EMPTY_PROFILE } from "@/lib/jobs/types";

export default async function RecommendedJobs() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const [personal, catalog] = await Promise.allSettled([discoveryData(supabase, user.id), getCachedCatalog()]);
  const profile = personal.status === "fulfilled" ? personal.value.profile : { ...EMPTY_PROFILE };
  const resume = personal.status === "fulfilled" ? selectedResume(personal.value.resumes, profile.resumeId) : undefined;
  const checkedAt = catalog.status === "fulfilled" ? Date.parse(catalog.value.checkedAt) : 0;
  const ranked = catalog.status === "fulfilled" ? catalog.value.jobs.filter(job => normalizeIndiaLocation(job.location).isIndia && matchesDateWindow(job, "30", checkedAt)).map(job => rankJob(job, profile, resume, checkedAt)).sort((a, b) => compareRanked(a, b)) : [];
  const eligible = ranked.filter(item => item.eligible), personalized = !!(profile.roles.length || profile.skills.length || resume);
  const recommendations = personalized && eligible.length > 0;
  const jobs = (recommendations ? eligible : [...ranked].sort((a, b) => Date.parse(b.job.postedAt ?? b.job.releasedAt ?? b.job.updatedAt ?? "") - Date.parse(a.job.postedAt ?? a.job.releasedAt ?? a.job.updatedAt ?? ""))).slice(0, 3);
  return <section className="product-panel mb-6"><div className="flex flex-wrap items-center justify-between gap-4"><h2>{recommendations ? "Top jobs for you" : "Recent opportunities to explore"}</h2><Link href="/jobs" className="text-sm text-accent">View all jobs →</Link></div>{jobs.length ? <div className="product-list mt-5">{jobs.map(({ job, fit }) => <Link className="product-list-row" key={job.id} href={`/jobs?job=${encodeURIComponent(job.id)}`}><div><strong>{job.title}</strong><p>{job.company} · {job.location}</p></div><span className="product-badge">{job.descriptionPending ? "Open to check resume fit" : resume ? `${fit.score}/100 resume fit` : "View requirements"}</span></Link>)}</div> : <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-lg bg-surface-2 p-5"><p className="max-w-xl text-sm leading-6 text-text-secondary">{catalog.status === "rejected" || catalog.value.warnings.length ? "Employer sources could not all be checked. Find Jobs can also search additional public sources." : "No source-dated listings are available in this window. Find Jobs lets you choose a wider date range and check additional sources."}</p><Link className="product-button" href="/jobs">Find jobs</Link></div>}</section>;
}

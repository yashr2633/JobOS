import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function InternalJobs() {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase.from("employer_jobs").select("id,title,location,work_mode,published_at,employer_companies(name)").eq("status", "Published").or(`deadline.is.null,deadline.gte.${today}`).order("published_at", { ascending: false }).limit(30);
  if (error || !data?.length) return null;
  return <section className="mt-10"><p className="product-kicker">Apply within JobTrackOS</p><h2 className="mb-5 text-xl font-semibold">Jobs posted by employers</h2><div className="product-list">{data.map(job => { const relation = job.employer_companies as unknown as { name: string } | { name: string }[] | null; const company = Array.isArray(relation) ? relation[0] : relation; return <Link key={job.id} className="product-list-row" href={`/jobs/internal/${job.id}`}><div><strong>{job.title}</strong><p>{company?.name ?? "Company"} · {job.location} · {job.work_mode}</p></div><span className="product-badge">Apply on JobTrackOS</span></Link>; })}</div></section>;
}

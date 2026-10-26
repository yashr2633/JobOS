import Link from "next/link";
import { employerSession, type EmployerJob } from "@/lib/employer/data";
import SetupNotice from "../../components/SetupNotice";
export default async function EmployerJobs() {
  const { supabase, company, setupError } = await employerSession();
  if (setupError) return <SetupNotice />;
  const { data, error } = company ? await supabase.from("employer_jobs").select("*").eq("company_id", company.id).order("created_at", { ascending: false }) : { data: [], error: null };
  return <><div className="product-heading"><div><p className="product-kicker">Job management</p><h1>Your job listings</h1><p>Publish, edit, pause or close roles from one workspace.</p></div><Link className="product-button product-button-primary" href={company ? "/employer/jobs/new" : "/employer/company"}>+ Create job</Link></div>{error && <p role="alert" className="product-notice product-error">Jobs could not load. Please retry.</p>}<div className="product-list">{((data ?? []) as EmployerJob[]).map(job => <div className="product-list-row" key={job.id}><div><strong>{job.title}</strong><p>{job.location} · {job.employment_type} · {job.work_mode}</p></div><div className="flex flex-wrap items-center gap-4"><span className="product-badge">{job.status}</span><Link href={`/employer/applicants?job=${job.id}`} className="text-sm text-accent">Applicants</Link><Link href={`/employer/jobs/${job.id}/edit`} className="product-button">Edit job</Link></div></div>)}</div>{!data?.length && !error && <div className="product-empty">No job listings yet. Create your company profile and add your first role.</div>}</>;
}

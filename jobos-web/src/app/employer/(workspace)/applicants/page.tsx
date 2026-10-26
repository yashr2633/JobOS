import Link from "next/link";
import { employerSession, type Submission } from "@/lib/employer/data";
import { STAGES, isUuid } from "@/lib/employer/validation";
import SetupNotice from "../../components/SetupNotice";

export default async function ApplicantsPage({ searchParams }: { searchParams: Promise<{ q?: string; stage?: string; job?: string }> }) {
  const { supabase, company, setupError } = await employerSession();
  if (setupError) return <SetupNotice />;
  const filters = await searchParams;
  const jobsResult = company ? await supabase.from("employer_jobs").select("id,title").eq("company_id", company.id) : { data: [], error: null };
  const jobs = jobsResult.data ?? [];
  const jobIds = jobs.map(job => job.id);
  let query = supabase.from("employer_submissions").select("id,job_id,candidate_name,candidate_email,stage,created_at").in("job_id", jobIds).order("created_at", { ascending: false }).limit(200);
  if (filters.stage && STAGES.includes(filters.stage as typeof STAGES[number])) query = query.eq("stage", filters.stage);
  if (filters.job && isUuid(filters.job) && jobIds.includes(filters.job)) query = query.eq("job_id", filters.job);
  const result = jobIds.length ? await query : { data: [], error: null };
  const search = (filters.q ?? "").slice(0, 200).toLowerCase();
  const applicants = (result.data ?? []).filter(row => !search || `${row.candidate_name} ${row.candidate_email}`.toLowerCase().includes(search));
  return <><div className="product-heading"><div><p className="product-kicker">Applicants</p><h1>Review your candidates</h1><p>Applications submitted to jobs owned by your company.</p></div></div><form className="product-panel mb-6"><div className="product-form-grid"><label className="product-field">Search candidate<input name="q" defaultValue={filters.q} maxLength={200} placeholder="Name or email" /></label><label className="product-field">Job<select name="job" defaultValue={filters.job ?? ""}><option value="">All your jobs</option>{jobs.map(job => <option key={job.id} value={job.id}>{job.title}</option>)}</select></label><label className="product-field">Stage<select name="stage" defaultValue={filters.stage ?? ""}><option value="">All stages</option>{STAGES.map(stage => <option key={stage}>{stage}</option>)}</select></label><div className="flex items-end"><button type="submit" className="product-button">Apply filters</button></div></div></form>{(result.error || jobsResult.error) && <p className="product-notice product-error" role="alert">Applicants could not load. Please retry.</p>}<section className="product-list">{applicants.map(row => { const applicant = row as Pick<Submission, "id" | "candidate_name" | "candidate_email" | "job_id" | "stage" | "created_at">; return <Link className="product-list-row" key={applicant.id} href={`/employer/applicants/${applicant.id}`}><div><strong>{applicant.candidate_name}</strong><p>{jobs.find(job => job.id === applicant.job_id)?.title} · Applied {new Date(applicant.created_at).toLocaleDateString("en-GB", { timeZone: "UTC" })}</p></div><div className="flex items-center gap-5"><span className="product-badge">{applicant.stage}</span><span className="text-sm text-accent">Review →</span></div></Link>; })}</section>{!applicants.length && !result.error && !jobsResult.error && <div className="product-empty">No applications match these filters.</div>}<p className="mt-5 text-xs text-text-muted">Showing up to the latest 200 submissions. Use a job or stage filter to narrow results.</p></>;
}

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import AppShell from "../../../components/AppShell";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/employer/validation";
import ApplyForm from "../ApplyForm";
export default async function InternalJobDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/jobs/internal/${id}`);
  const { data: job, error } = await supabase.from("employer_jobs").select("*,employer_companies(name,description)").eq("id", id).eq("status", "Published").maybeSingle();
  if (error) return <AppShell><p role="alert" className="product-notice product-error">Job details could not load. Please retry.</p></AppShell>;
  if (!job || (job.deadline && job.deadline < new Date().toISOString().slice(0, 10))) notFound();
  const relation = job.employer_companies as unknown as { name: string; description: string } | { name: string; description: string }[] | null;
  const company = Array.isArray(relation) ? relation[0] : relation;
  const [resumes, existing] = await Promise.all([supabase.from("resumes").select("id,label,extracted_text").eq("user_id", user.id).order("created_at", { ascending: false }), supabase.from("employer_submissions").select("id").eq("job_id", id).eq("candidate_id", user.id).maybeSingle()]);
  return <AppShell><Link href="/jobs" className="mb-6 inline-block text-sm text-text-muted">← Back to jobs</Link><div className="product-heading"><div><p className="product-kicker">{company?.name ?? "Company"} · Apply on JobTrackOS</p><h1>{job.title}</h1><p>{job.location} · {job.work_mode} · {job.employment_type}</p></div><span className="product-badge">{job.deadline ? `Apply by ${job.deadline}` : "Open for applications"}</span></div><div className="product-two-column"><div className="product-section-stack"><section className="product-panel"><h2>About the role</h2><div className="job-description mt-5">{job.description}</div></section><section className="product-panel"><h2>Requirements</h2><div className="job-description mt-5">{job.requirements || "See the job description."}</div>{job.salary && <p className="mt-5 text-sm">Salary: {job.salary}</p>}</section>{company?.description && <section className="product-panel"><h2>About {company.name}</h2><p className="job-description mt-5">{company.description}</p></section>}</div><aside>{resumes.error || existing.error ? <p role="alert" className="product-notice product-error">Your application details could not load. Reload before applying.</p> : existing.data ? <section className="product-panel"><h2>You have applied</h2><Link className="product-button mt-5" href={`/jobs/applied/${existing.data.id}`}>View confirmation</Link></section> : <ApplyForm jobId={id} resumes={(resumes.data ?? []).filter(resume => !!resume.extracted_text?.trim()).map(({ id, label }) => ({ id, label }))} name={typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : ""} />}</aside></div></AppShell>;
}

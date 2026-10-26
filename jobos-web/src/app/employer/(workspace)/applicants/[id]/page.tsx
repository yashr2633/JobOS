import Link from "next/link";
import { notFound } from "next/navigation";
import { employerSession, type Submission } from "@/lib/employer/data";
import { isUuid } from "@/lib/employer/validation";
import { ApplicantForm } from "../../../components/EmployerForms";
import SetupNotice from "../../../components/SetupNotice";

export default async function ApplicantDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { supabase, company, setupError } = await employerSession();
  if (setupError) return <SetupNotice />;
  if (!company) notFound();
  const { data, error } = await supabase.from("employer_submissions").select("*").eq("id", id).maybeSingle();
  if (error) return <p role="alert" className="product-notice product-error">Application could not load. Please retry.</p>;
  if (!data) notFound();
  const applicant = data as Submission;
  // Explicit ownership check in addition to RLS: a candidate may read their own
  // submission, but that does not grant them employer management access.
  const jobResult = await supabase.from("employer_jobs").select("id,title,company_id").eq("id", applicant.job_id).eq("company_id", company.id).maybeSingle();
  if (!jobResult.data) notFound();
  const { data: note, error: noteError } = await supabase.from("employer_submission_notes").select("note").eq("submission_id", id).maybeSingle();
  return <><Link href="/employer/applicants" className="mb-6 inline-block text-sm text-text-muted">← Back to applicants</Link><div className="product-panel mb-7"><div className="product-heading mb-0"><div><p className="product-kicker">Applicant · {jobResult.data.title}</p><h1>{applicant.candidate_name}</h1><p>Applied {new Date(applicant.created_at).toLocaleDateString("en-GB", { timeZone: "UTC" })}</p></div><span className="product-badge">{applicant.stage}</span></div></div><div className="product-two-column"><div className="product-section-stack"><section className="product-panel"><h2>Application information</h2><p className="mt-3 text-sm text-text-secondary">Information provided with the candidate’s consent.</p><a className="product-button mt-5" href={`mailto:${applicant.candidate_email}`}>Email candidate</a><p className="mt-5 whitespace-pre-wrap text-sm leading-7 text-text-secondary">{applicant.cover_note || "No covering note provided."}</p></section><section className="product-panel"><h2>Submitted resume</h2><p className="mt-2 text-xs text-text-muted">{applicant.resume_name} · Snapshot shared at application time</p><div className="job-description mt-6">{applicant.resume_text}</div></section></div><aside className="product-section-stack">{noteError ? <p role="alert" className="product-notice product-error">The private note could not load. Reload before editing it to avoid overwriting existing notes.</p> : <ApplicantForm applicant={applicant} note={note?.note ?? ""} />}<section className="product-panel"><h2>Application timeline</h2><p className="mt-5 text-sm">Submitted · {new Date(applicant.created_at).toLocaleString("en-GB", { timeZone: "UTC" })} UTC</p><p className="mt-4 text-sm">Current stage · {applicant.stage}</p><p className="mt-2 text-xs text-text-muted">Last updated {new Date(applicant.updated_at).toLocaleString("en-GB", { timeZone: "UTC" })} UTC</p></section></aside></div></>;
}

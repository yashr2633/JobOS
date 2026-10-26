"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { employerSession } from "@/lib/employer/data";
import { field, allowed, isUuid, deadlineValue, websiteValue, JOB_STATUSES, WORK_MODES, EMPLOYMENT_TYPES, STAGES } from "@/lib/employer/validation";

export interface ActionResult { error?: string; success?: string }

export async function saveCompany(_previous: ActionResult, form: FormData): Promise<ActionResult> {
  const { supabase, user } = await employerSession();
  try {
    const values = { owner_id: user.id, name: field(form, "name", 2, 160), website: websiteValue(field(form, "website", 0, 500)), location: field(form, "location", 0, 200), description: field(form, "description", 0, 5000) };
    const { error } = await supabase.from("employer_companies").upsert(values, { onConflict: "owner_id" });
    if (error) return { error: "Company could not be saved. Check workspace setup and retry." };
  } catch (error) { return { error: error instanceof Error ? error.message : "Check the company details." }; }
  revalidatePath("/employer", "layout");
  return { success: "Company profile saved." };
}

export async function saveJob(_previous: ActionResult, form: FormData): Promise<ActionResult> {
  const { supabase, company } = await employerSession();
  if (!company) return { error: "Create your company profile first." };
  let jobId: string | undefined;
  try {
    const id = field(form, "id", 0, 36);
    if (id && !isUuid(id)) throw new Error("Invalid job.");
    const status = allowed(field(form, "status", 1, 20), JOB_STATUSES);
    const values = { title: field(form, "title", 2, 200), location: field(form, "location", 2, 200), work_mode: allowed(field(form, "work_mode", 1, 20), WORK_MODES), employment_type: allowed(field(form, "employment_type", 1, 20), EMPLOYMENT_TYPES), description: field(form, "description", 40, 45000), requirements: field(form, "requirements", 0, 10000), salary: field(form, "salary", 0, 200), deadline: deadlineValue(field(form, "deadline", 0, 10)), status, updated_at: new Date().toISOString() };
    if (id) {
      const { data: existing } = await supabase.from("employer_jobs").select("id,published_at").eq("id", id).eq("company_id", company.id).maybeSingle();
      if (!existing) throw new Error("Job unavailable.");
      const { data, error } = await supabase.from("employer_jobs").update({ ...values, published_at: existing.published_at ?? (status === "Published" ? new Date().toISOString() : null) }).eq("id", id).eq("company_id", company.id).select("id").single();
      if (error) return { error: "Could not update this job. Please retry." };
      jobId = data.id;
    } else {
      const { data, error } = await supabase.from("employer_jobs").insert({ ...values, company_id: company.id, published_at: status === "Published" ? new Date().toISOString() : null }).select("id").single();
      if (error) return { error: "Could not create the job. Please retry." };
      jobId = data.id;
    }
  } catch (error) { return { error: error instanceof Error ? error.message : "Check the job details." }; }
  revalidatePath("/employer", "layout");
  revalidatePath("/jobs");
  redirect(`/employer/jobs/${jobId}/edit?saved=1`);
}

export async function updateApplicant(_previous: ActionResult, form: FormData): Promise<ActionResult> {
  const { supabase, company } = await employerSession();
  if (!company) return { error: "Company access required." };
  try {
    const id = field(form, "id", 36, 36);
    if (!isUuid(id)) throw new Error("Invalid applicant.");
    const stage = allowed(field(form, "stage", 1, 20), STAGES);
    const note = field(form, "note", 0, 5000);
    const { error } = await supabase.rpc("set_employer_application_stage", { p_submission: id, p_stage: stage });
    if (error) return { error: "Could not update the stage. Your access may have changed." };
    const { error: noteError } = await supabase.from("employer_submission_notes").upsert({ submission_id: id, note, updated_at: new Date().toISOString() });
    revalidatePath("/employer", "layout");
    revalidatePath("/applications");
    return noteError ? { error: "Stage updated, but the private note could not save. Please retry." } : { success: "Application stage and private note saved." };
  } catch (error) { return { error: error instanceof Error ? error.message : "Could not update this applicant." }; }
}

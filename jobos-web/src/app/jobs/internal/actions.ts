"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { field, isUuid } from "@/lib/employer/validation";
import type { ActionResult } from "@/app/employer/actions";

export async function submitApplication(_previous: ActionResult, form: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/jobs");
  let submission: string;
  try {
    const job = field(form, "job_id", 36, 36), resume = field(form, "resume_id", 36, 36);
    if (!isUuid(job) || !isUuid(resume)) throw new Error("Select a valid job and resume.");
    if (form.get("consent") !== "on") throw new Error("Confirm consent before submitting.");
    const { data, error } = await supabase.rpc("submit_employer_application", { p_job: job, p_resume: resume, p_name: field(form, "candidate_name", 1, 160), p_note: field(form, "cover_note", 0, 5000), p_consent: true });
    if (error || !isUuid(data)) return { error: "Application could not be submitted. Check that the job is open and your selected resume has readable text, then retry." };
    submission = data;
  } catch (error) { return { error: error instanceof Error ? error.message : "Check the application details." }; }
  revalidatePath("/applications");
  redirect(`/jobs/applied/${submission}`);
}

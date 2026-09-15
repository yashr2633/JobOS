import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getLiveJob } from "@/lib/jobs/providers";

const actions = ["save", "unsave", "hide", "restore", "apply", "dismiss", "confirm"];
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  try {
    const text = await request.text();
    if (text.length > 2000) return NextResponse.json({ error: "Request too large." }, { status: 413 });
    const { jobId, action, appliedDate } = JSON.parse(text);
    if (typeof jobId !== "string" || jobId.length > 150 || !actions.includes(action)) return NextResponse.json({ error: "Invalid job action." }, { status: 400 });
    if (action === "confirm") {
      if (typeof appliedDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(appliedDate) || !Number.isFinite(Date.parse(appliedDate))) return NextResponse.json({ error: "Choose the date you applied." }, { status: 400 });
      const { data, error } = await supabase.rpc("confirm_discovery_application", { p_job_id: jobId, p_applied_date: appliedDate });
      if (error) return NextResponse.json({ error: "Could not confirm. Open the application page first, then retry." }, { status: 409 });
      return NextResponse.json({ applicationId: data });
    }
    // Unsave/restore/dismiss do not require the listing to still be open.
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (action === "save" || action === "unsave") patch.saved = action === "save";
    if (action === "hide" || action === "restore") patch.hidden = action === "hide";
    if (action === "dismiss") patch.apply_started_at = null;
    if (["save", "hide", "apply"].includes(action)) {
      const job = await getLiveJob(jobId);
      if (!job) return NextResponse.json({ error: "This job is no longer listed by the employer. Refresh your feed." }, { status: 410 });
      if (action === "apply") { patch.apply_started_at = new Date().toISOString(); patch.saved = true; }
      // Seed once, then patch only the fields this action owns. Never overwrite
      // a confirmation or a concurrent saved/hidden action with stale defaults.
      const { error: seedError } = await supabase.from("discovery_job_states").upsert({ user_id: user.id, job_id: jobId, snapshot: job }, { onConflict: "user_id,job_id", ignoreDuplicates: true });
      if (seedError) throw new Error("Could not retain job context.");
      patch.snapshot = job;
    }
    const { data, error } = await supabase.from("discovery_job_states").update(patch).eq("user_id", user.id).eq("job_id", jobId).select("job_id,saved,hidden,apply_started_at,application_id,snapshot").maybeSingle();
    if (error || !data) throw new Error("Could not save this action. Please retry.");
    return NextResponse.json({ state: data, applicationUrl: action === "apply" ? data.snapshot.applicationUrl : undefined });
  } catch {
    return NextResponse.json({ error: "Job source or saved preferences unavailable. Please retry." }, { status: 503 });
  }
}

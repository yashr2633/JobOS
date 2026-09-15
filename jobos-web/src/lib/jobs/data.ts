import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchResumes } from "../api/resumes";
import { readProfile } from "./profile";
import { discoveryResumes } from "./resumeLibrary";
import type { JobState } from "./types";

export async function discoveryData(supabase: SupabaseClient, userId: string) {
  const [profile, states, resumes] = await Promise.all([
    supabase.from("career_profiles").select("preferences,resume_id").eq("user_id", userId).maybeSingle(),
    supabase.from("discovery_job_states").select("job_id,saved,hidden,apply_started_at,application_id,snapshot").eq("user_id", userId).order("updated_at", { ascending: false }).limit(1000),
    fetchResumes(supabase),
  ]);
  if (profile.error || states.error) throw new Error("Job Discovery preferences could not load. Please retry. If setup is incomplete, ask the operator to apply the Job Discovery migration.");
  return { profile: readProfile(profile.data), states: (states.data ?? []) as JobState[], resumes: discoveryResumes(resumes) };
}

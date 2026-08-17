/**
 * Job intelligence data access: JD text + parse cache on `applications`, and
 * the `match_results` analysis lifecycle.
 *
 * An analysis run is created in 'pending' state before any heavy work begins.
 * The same lifecycle serves a synchronous route handler today and a background
 * worker later, so moving processing off the request path requires no schema or
 * API change: a worker claims rows where status = 'pending'.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { validateParsedJD } from "@/lib/ai/schemas";
import type {
  AnalysisStatus,
  MatchConfidence,
  MatchInterpretation,
  MatchResult,
  MatchScoreResult,
  ParsedJD,
  ScoreComponent,
  SkillAssessment,
  ExperienceGap,
  EducationGap,
} from "@/lib/ai/types";

interface MatchResultRow {
  id: string;
  application_id: string;
  resume_id: string | null;
  status: AnalysisStatus;
  failure_reason: string | null;
  match_score: number | null;
  scoring_version: number | null;
  confidence: MatchConfidence | null;
  score_breakdown: ScoreComponent[] | null;
  required_skills: SkillAssessment[] | null;
  preferred_skills: SkillAssessment[] | null;
  missing_required_skills: string[] | null;
  missing_preferred_skills: string[] | null;
  experience_gap: ExperienceGap | null;
  education_gap: EducationGap | null;
  ai_summary: string | null;
  recommendations: string[] | null;
  model: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

function mapMatchResult(row: MatchResultRow): MatchResult {
  return {
    id: row.id,
    applicationId: row.application_id,
    resumeId: row.resume_id,
    status: row.status,
    failureReason: row.failure_reason,
    score: row.match_score,
    scoringVersion: row.scoring_version,
    confidence: row.confidence,
    components: row.score_breakdown,
    requiredSkills: row.required_skills,
    preferredSkills: row.preferred_skills,
    missingRequiredSkills: row.missing_required_skills,
    missingPreferredSkills: row.missing_preferred_skills,
    experienceGap: row.experience_gap,
    educationGap: row.education_gap,
    summary: row.ai_summary,
    recommendations: row.recommendations,
    model: row.model,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}

async function requireUserId(supabase: SupabaseClient): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("User not authenticated");
  }

  return user.id;
}

// ---------------------------------------------------------------------------
// Job description on the application
// ---------------------------------------------------------------------------

export interface ApplicationIntelligenceInput {
  jobDescription: string | null;
  parsedJd: ParsedJD | null;
}

export async function getApplicationIntelligenceInput(
  supabase: SupabaseClient,
  applicationId: string
): Promise<ApplicationIntelligenceInput | null> {
  const userId = await requireUserId(supabase);

  const { data, error } = await supabase
    .from("applications")
    .select("job_description, parsed_jd")
    .eq("id", applicationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("Error fetching application intelligence input:", error);
    throw error;
  }

  if (!data) return null;

  // jsonb carries no shape guarantee, so revalidate rather than cast.
  let parsedJd: ParsedJD | null = null;
  if (data.parsed_jd !== null && data.parsed_jd !== undefined) {
    const validated = validateParsedJD(data.parsed_jd);
    parsedJd = validated.ok ? validated.value : null;
  }

  return { jobDescription: data.job_description ?? null, parsedJd };
}

/** Saving new JD text invalidates the parse cache derived from the old text. */
export async function saveJobDescription(
  supabase: SupabaseClient,
  applicationId: string,
  jobDescription: string
): Promise<void> {
  const userId = await requireUserId(supabase);

  const { error } = await supabase
    .from("applications")
    .update({
      job_description: jobDescription,
      parsed_jd: null,
      parsed_jd_at: null,
    })
    .eq("id", applicationId)
    .eq("user_id", userId);

  if (error) {
    console.error("Error saving job description:", error);
    throw error;
  }
}

export async function saveParsedJD(
  supabase: SupabaseClient,
  applicationId: string,
  parsedJd: ParsedJD
): Promise<void> {
  const userId = await requireUserId(supabase);

  const { error } = await supabase
    .from("applications")
    .update({ parsed_jd: parsedJd, parsed_jd_at: new Date().toISOString() })
    .eq("id", applicationId)
    .eq("user_id", userId);

  if (error) {
    console.error("Error saving parsed job description:", error);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Analysis run lifecycle
// ---------------------------------------------------------------------------

/**
 * Create a pending run after confirming the caller owns both the application
 * and the resume. Ownership is checked explicitly here rather than relying on
 * RLS alone, matching the defense-in-depth pattern used for application writes.
 */
export async function createAnalysisRun(
  supabase: SupabaseClient,
  applicationId: string,
  resumeId: string
): Promise<MatchResult> {
  const userId = await requireUserId(supabase);

  const { data: application, error: applicationError } = await supabase
    .from("applications")
    .select("id")
    .eq("id", applicationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (applicationError) {
    console.error("Error verifying application ownership:", applicationError);
    throw applicationError;
  }
  if (!application) {
    throw new Error("Application not found");
  }

  const { data: resume, error: resumeError } = await supabase
    .from("resumes")
    .select("id")
    .eq("id", resumeId)
    .eq("user_id", userId)
    .maybeSingle();

  if (resumeError) {
    console.error("Error verifying resume ownership:", resumeError);
    throw resumeError;
  }
  if (!resume) {
    throw new Error("Resume not found");
  }

  const { data, error } = await supabase
    .from("match_results")
    .insert({
      application_id: applicationId,
      resume_id: resumeId,
      user_id: userId,
      status: "pending",
    })
    .select()
    .single();

  if (error) {
    console.error("Error creating analysis run:", error);
    throw error;
  }

  return mapMatchResult(data);
}

export async function markAnalysisProcessing(
  supabase: SupabaseClient,
  id: string
): Promise<void> {
  const userId = await requireUserId(supabase);

  const { error } = await supabase
    .from("match_results")
    .update({ status: "processing", started_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId);

  if (error) {
    console.error("Error marking analysis processing:", error);
    throw error;
  }
}

export interface CompleteAnalysisInput {
  /** Deterministic scoring output. Supplies every numeric field. */
  score: MatchScoreResult;
  /** Advisory text only. Never contributes to the score. */
  interpretation: MatchInterpretation;
  /** Model identifier, recorded for auditability. */
  model: string;
}

export async function completeAnalysisRun(
  supabase: SupabaseClient,
  id: string,
  input: CompleteAnalysisInput
): Promise<MatchResult> {
  const userId = await requireUserId(supabase);
  const { score, interpretation, model } = input;

  const { data, error } = await supabase
    .from("match_results")
    .update({
      status: "complete",
      failure_reason: null,
      match_score: score.score,
      scoring_version: score.scoringVersion,
      confidence: score.confidence,
      score_breakdown: score.components,
      required_skills: score.requiredSkills,
      preferred_skills: score.preferredSkills,
      missing_required_skills: score.missingRequiredSkills,
      missing_preferred_skills: score.missingPreferredSkills,
      experience_gap: score.experienceGap,
      education_gap: score.educationGap,
      ai_summary: interpretation.summary,
      recommendations: interpretation.recommendations,
      model,
      completed_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", userId)
    .select()
    .single();

  if (error) {
    console.error("Error completing analysis run:", error);
    throw error;
  }

  return mapMatchResult(data);
}

export async function failAnalysisRun(
  supabase: SupabaseClient,
  id: string,
  reason: string
): Promise<void> {
  const userId = await requireUserId(supabase);

  const { error } = await supabase
    .from("match_results")
    .update({
      status: "failed",
      failure_reason: reason,
      completed_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", userId);

  if (error) {
    console.error("Error recording analysis failure:", error);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getLatestMatchResult(
  supabase: SupabaseClient,
  applicationId: string
): Promise<MatchResult | null> {
  const userId = await requireUserId(supabase);

  const { data, error } = await supabase
    .from("match_results")
    .select("*")
    .eq("application_id", applicationId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Error fetching latest match result:", error);
    throw error;
  }

  return data ? mapMatchResult(data) : null;
}

/**
 * Latest completed score per application, for list badges.
 * Returns a map keyed by application id.
 */
export async function fetchLatestScoresByApplication(
  supabase: SupabaseClient
): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from("match_results")
    .select("application_id, match_score, created_at")
    .eq("status", "complete")
    .not("match_score", "is", null)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching latest scores:", error);
    throw error;
  }

  const scores: Record<string, number> = {};
  // Rows arrive newest first, so the first entry per application wins.
  for (const row of data ?? []) {
    if (row.application_id in scores) continue;
    if (typeof row.match_score !== "number") continue;
    scores[row.application_id] = row.match_score;
  }

  return scores;
}

/** Supports the per-user daily quota without a dedicated counter table. */
export async function countAnalysesSince(
  supabase: SupabaseClient,
  since: Date
): Promise<number> {
  const userId = await requireUserId(supabase);

  const { count, error } = await supabase
    .from("match_results")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", since.toISOString());

  if (error) {
    console.error("Error counting analyses:", error);
    throw error;
  }

  return count ?? 0;
}

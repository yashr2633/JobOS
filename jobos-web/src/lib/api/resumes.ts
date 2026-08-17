/**
 * Resume data access.
 *
 * Mirrors the conventions in `applications.ts`: the Supabase client is passed
 * in so the same functions work from a client component and a server component,
 * mutations verify the authenticated user and constrain writes by both row id
 * and user_id, and RLS backs everything as a second layer.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { validateParsedResume } from "@/lib/ai/schemas";
import type { ParsedResume, Resume, ResumeSource, StageStatus } from "@/lib/ai/types";

interface ResumeRow {
  id: string;
  label: string;
  source: ResumeSource;
  file_name: string | null;
  file_path: string | null;
  extracted_text: string | null;
  extraction_status: StageStatus;
  extraction_error: string | null;
  parsed: unknown;
  parsed_at: string | null;
  parse_status: StageStatus;
  parse_error: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * `parsed` is jsonb, so its shape is not guaranteed by the database. Revalidate
 * on read rather than casting, so the `ParsedResume | null` type is honest.
 */
function mapResume(row: ResumeRow): Resume {
  let parsed: ParsedResume | null = null;
  if (row.parsed !== null && row.parsed !== undefined) {
    const validated = validateParsedResume(row.parsed);
    parsed = validated.ok ? validated.value : null;
  }

  return {
    id: row.id,
    label: row.label,
    source: row.source,
    fileName: row.file_name,
    filePath: row.file_path,
    extractedText: row.extracted_text,
    extractionStatus: row.extraction_status,
    extractionError: row.extraction_error,
    parsed,
    parsedAt: row.parsed_at,
    parseStatus: row.parse_status,
    parseError: row.parse_error,
    isDefault: row.is_default,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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

export async function fetchResumes(
  supabase: SupabaseClient
): Promise<Resume[]> {
  const { data, error } = await supabase
    .from("resumes")
    .select("*")
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching resumes:", error);
    throw error;
  }

  return (data ?? []).map(mapResume);
}

export async function fetchResume(
  supabase: SupabaseClient,
  id: string
): Promise<Resume | null> {
  const userId = await requireUserId(supabase);

  const { data, error } = await supabase
    .from("resumes")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("Error fetching resume:", error);
    throw error;
  }

  return data ? mapResume(data) : null;
}

export async function getDefaultResume(
  supabase: SupabaseClient
): Promise<Resume | null> {
  const userId = await requireUserId(supabase);

  const { data, error } = await supabase
    .from("resumes")
    .select("*")
    .eq("user_id", userId)
    .eq("is_default", true)
    .maybeSingle();

  if (error) {
    console.error("Error fetching default resume:", error);
    throw error;
  }

  return data ? mapResume(data) : null;
}

export interface CreateResumeInput {
  label: string;
  source: ResumeSource;
  /** Present immediately for pasted text; filled in later for uploads. */
  extractedText?: string | null;
  fileName?: string | null;
  filePath?: string | null;
}

export async function createResume(
  supabase: SupabaseClient,
  input: CreateResumeInput
): Promise<Resume> {
  const userId = await requireUserId(supabase);

  const hasText =
    typeof input.extractedText === "string" && input.extractedText.trim() !== "";

  const { data, error } = await supabase
    .from("resumes")
    .insert({
      user_id: userId,
      label: input.label.trim(),
      source: input.source,
      file_name: input.fileName ?? null,
      file_path: input.filePath ?? null,
      extracted_text: hasText ? input.extractedText!.trim() : null,
      // Pasted text needs no extraction stage; uploads start pending.
      extraction_status: hasText ? "complete" : "pending",
      parse_status: "pending",
    })
    .select()
    .single();

  if (error) {
    console.error("Error creating resume:", error);
    throw error;
  }

  return mapResume(data);
}

/**
 * Deletes the resume row and, for uploaded files, the underlying Storage
 * object. The Storage removal is best-effort: if it fails (e.g. the object
 * was already gone), the row is still deleted rather than leaving the user
 * unable to remove a resume from their library.
 */
export async function deleteResume(
  supabase: SupabaseClient,
  id: string
): Promise<void> {
  const userId = await requireUserId(supabase);

  const { data: existing } = await supabase
    .from("resumes")
    .select("file_path")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  const { error } = await supabase
    .from("resumes")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  if (error) {
    console.error("Error deleting resume:", error);
    throw error;
  }

  if (existing?.file_path) {
    const { error: storageError } = await supabase.storage
      .from("resumes")
      .remove([existing.file_path]);

    if (storageError) {
      console.error("Error deleting resume file from storage:", storageError);
    }
  }
}

/**
 * A partial unique index allows only one default per user, so the existing
 * default is cleared before the new one is set.
 */
export async function setDefaultResume(
  supabase: SupabaseClient,
  id: string
): Promise<void> {
  const userId = await requireUserId(supabase);

  const { error: clearError } = await supabase
    .from("resumes")
    .update({ is_default: false })
    .eq("user_id", userId)
    .eq("is_default", true);

  if (clearError) {
    console.error("Error clearing default resume:", clearError);
    throw clearError;
  }

  const { error } = await supabase
    .from("resumes")
    .update({ is_default: true })
    .eq("id", id)
    .eq("user_id", userId);

  if (error) {
    console.error("Error setting default resume:", error);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Pipeline stage writes
// ---------------------------------------------------------------------------

/** Stage 1 result. Invalidates the stage 2 cache because the source changed. */
export async function saveResumeExtraction(
  supabase: SupabaseClient,
  id: string,
  extractedText: string
): Promise<void> {
  const userId = await requireUserId(supabase);

  const { error } = await supabase
    .from("resumes")
    .update({
      extracted_text: extractedText,
      extraction_status: "complete",
      extraction_error: null,
      parsed: null,
      parsed_at: null,
      parse_status: "pending",
      parse_error: null,
    })
    .eq("id", id)
    .eq("user_id", userId);

  if (error) {
    console.error("Error saving resume extraction:", error);
    throw error;
  }
}

export async function failResumeExtraction(
  supabase: SupabaseClient,
  id: string,
  reason: string
): Promise<void> {
  const userId = await requireUserId(supabase);

  const { error } = await supabase
    .from("resumes")
    .update({ extraction_status: "failed", extraction_error: reason })
    .eq("id", id)
    .eq("user_id", userId);

  if (error) {
    console.error("Error recording resume extraction failure:", error);
    throw error;
  }
}

/** Stage 2 result: the cached structured resume, reused across applications. */
export async function saveResumeParse(
  supabase: SupabaseClient,
  id: string,
  parsed: ParsedResume
): Promise<void> {
  const userId = await requireUserId(supabase);

  const { error } = await supabase
    .from("resumes")
    .update({
      parsed,
      parsed_at: new Date().toISOString(),
      parse_status: "complete",
      parse_error: null,
    })
    .eq("id", id)
    .eq("user_id", userId);

  if (error) {
    console.error("Error saving resume parse:", error);
    throw error;
  }
}

export async function failResumeParse(
  supabase: SupabaseClient,
  id: string,
  reason: string
): Promise<void> {
  const userId = await requireUserId(supabase);

  const { error } = await supabase
    .from("resumes")
    .update({ parse_status: "failed", parse_error: reason })
    .eq("id", id)
    .eq("user_id", userId);

  if (error) {
    console.error("Error recording resume parse failure:", error);
    throw error;
  }
}

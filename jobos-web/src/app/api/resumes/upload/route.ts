/**
 * POST /api/resumes/upload
 *
 * Accepts a resume file (PDF or DOCX) as multipart/form-data, stores it in
 * the private `resumes` Storage bucket under the authenticated user's own
 * folder, extracts its text server-side, and creates the `resumes` row.
 *
 * This feeds the existing AI Intelligence pipeline: once `extracted_text` is
 * populated here, this resume behaves identically to a pasted-text resume
 * everywhere else in the app (Resume Match, IntelligencePanel, the analyze
 * route) — no changes were needed to that pipeline.
 *
 * Runtime: nodejs (required for Buffer + the PDF/DOCX parsing libraries).
 */

export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateResumeFile } from "@/lib/resumes/validation";
import { extractResumeText } from "@/lib/resumes/extractText";
import {
  saveResumeExtraction,
  failResumeExtraction,
} from "@/lib/api/resumes";

const STORAGE_BUCKET = "resumes";

function ok(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status });
}

function err(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/** Strips characters that are unsafe in a Storage object path. */
function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-150);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return err("Unauthorized.", 401);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return err("Request must be multipart/form-data.", 400);
  }

  const file = formData.get("file");
  const labelField = formData.get("label");

  if (!(file instanceof File)) {
    return err("A file is required.", 400);
  }

  const validation = validateResumeFile({
    name: file.name,
    size: file.size,
    type: file.type,
  });

  if (!validation.ok || !validation.extension) {
    return err(validation.error ?? "Invalid file.", 400);
  }

  const label =
    typeof labelField === "string" && labelField.trim() !== ""
      ? labelField.trim().slice(0, 200)
      : file.name;

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Path is scoped by user id as the first folder segment. This is both the
  // Storage RLS boundary (see supabase-schema-sprint6-resumes.sql) and how a
  // user's own files stay isolated from every other user's.
  const safeName = sanitizeFileName(file.name);
  const storagePath = `${user.id}/${crypto.randomUUID()}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, buffer, {
      contentType: file.type || undefined,
      upsert: false,
    });

  if (uploadError) {
    console.error("Resume upload failed:", uploadError);
    return err("Failed to store the uploaded file. Please try again.", 502);
  }

  // Create the resume row before extraction, so the file is tracked even if
  // extraction fails — the failure is then recorded on that row rather than
  // left as an orphaned Storage object with no database reference.
  const { data: resumeRow, error: insertError } = await supabase
    .from("resumes")
    .insert({
      user_id: user.id,
      label,
      source: "upload",
      file_name: file.name,
      file_path: storagePath,
      extraction_status: "pending",
      parse_status: "pending",
    })
    .select()
    .single();

  if (insertError || !resumeRow) {
    console.error("Error creating resume row:", insertError);
    // Best-effort cleanup: don't leave an unreferenced file in storage.
    await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);
    return err("Failed to save resume record. Please try again.", 500);
  }

  const extraction = await extractResumeText(buffer, validation.extension);

  if (!extraction.ok) {
    await failResumeExtraction(supabase, resumeRow.id, extraction.error);
    return err(extraction.error, 422);
  }

  await saveResumeExtraction(supabase, resumeRow.id, extraction.text);

  return ok({ id: resumeRow.id, label: resumeRow.label }, 201);
}

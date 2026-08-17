/**
 * POST /api/resumes/export
 *
 * Renders the user's EDITED tailored resume into a real DOCX or PDF document.
 *
 * WHAT THIS ROUTE IS, AND IS NOT
 *
 * It is a pure formatter. The content it renders is the text the user is looking
 * at in the Tailor Resume editor, posted back verbatim, so an export always
 * matches the preview and never resurrects the pre-edit AI response. It calls no
 * model, reads no resume text, and reads no job description — so there is no path
 * by which it could introduce a fact the user has not seen. It persists nothing:
 * no second copy of the tailored resume is stored, matching the existing
 * stateless tailoring architecture.
 *
 * AUTHORIZATION
 *
 * Two gates, in order:
 *   1. A session is required.
 *   2. The referenced application must belong to that session's user. That check
 *      is the existing `getApplicationIntelligenceInput` read, which filters on
 *      `user_id` in the statement (RLS backing it as a second layer). A request
 *      naming someone else's application id is refused before any document is
 *      produced, so one user can never export against another user's record.
 *
 * The posted content is the caller's own text, bounded before use.
 *
 * Runtime nodejs: both renderers need Node APIs (zip packing, PDF byte
 * assembly), and generating server-side keeps document code off the client.
 */

export const runtime = "nodejs";
export const maxDuration = 30;

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getApplicationIntelligenceInput } from "@/lib/api/intelligence";
import {
  isResumeDocumentEmpty,
  parseResumeDocument,
  resumeFileStem,
} from "@/lib/resume/documentModel";
import { renderResumeDocx } from "@/lib/resume/docx";
import { renderResumePdf } from "@/lib/resume/pdf";

/** Generous for a resume, small enough that a paste cannot exhaust memory. */
const MAX_CONTENT_LENGTH = 60_000;
const MAX_LABEL_LENGTH = 200;

export type ExportFormat = "docx" | "pdf";

const MEDIA_TYPES: Record<ExportFormat, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
};

function isExportFormat(value: unknown): value is ExportFormat {
  return value === "docx" || value === "pdf";
}

function err(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err("Request body must be valid JSON.", 400);
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return err("Request body must be a JSON object.", 400);
  }

  const { applicationId, content, format, label } = body as Record<string, unknown>;

  if (typeof applicationId !== "string" || applicationId.trim() === "") {
    return err("applicationId is required.", 400);
  }
  if (!isExportFormat(format)) {
    return err("format must be 'docx' or 'pdf'.", 400);
  }
  if (typeof content !== "string" || content.trim() === "") {
    return err("There is no tailored resume content to export.", 400);
  }
  if (content.length > MAX_CONTENT_LENGTH) {
    return err("That resume is too long to export.", 413);
  }

  // Gate 1: a session is required.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return err("Unauthorized.", 401);

  // Gate 2: the application must belong to THIS user. Enforced in the statement
  // by the existing user-scoped read, not merely by RLS.
  const owned = await getApplicationIntelligenceInput(supabase, applicationId.trim());
  if (owned === null) return err("Application not found.", 404);

  // Structure the user's edited text. Every string in the document is a
  // substring of `content`; this step cannot add one.
  const document = parseResumeDocument(content);
  if (isResumeDocumentEmpty(document)) {
    return err("There is no tailored resume content to export.", 400);
  }

  const stem = resumeFileStem(
    typeof label === "string" ? label.slice(0, MAX_LABEL_LENGTH) : ""
  );
  const filename = `${stem}.${format}`;

  try {
    const bytes =
      format === "docx"
        ? await renderResumeDocx(document)
        : await renderResumePdf(document);

    // A fresh ArrayBuffer slice, so the response body is exactly the rendered
    // bytes regardless of the underlying pool buffer.
    const output = bytes.slice();

    return new NextResponse(output as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": MEDIA_TYPES[format],
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(output.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (error: unknown) {
    console.error(`[resumes/export] ${format} render failed:`, error);
    return err(
      "That resume could not be exported. Please try again.",
      500
    );
  }
}

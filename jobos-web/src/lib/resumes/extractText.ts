/**
 * Server-side resume text extraction for uploaded files.
 *
 * Supported formats: PDF (via `unpdf`, a serverless-friendly PDF.js build)
 * and DOCX (via `mammoth`). Both run entirely server-side — the extracted
 * text is what feeds the existing AI Intelligence pipeline (resume parsing +
 * scoring), so this module only produces plain text and never talks to the
 * Anthropic provider itself.
 */

import mammoth from "mammoth";
import { LIMITS } from "@/lib/ai/schemas";

export type SupportedResumeExtension = "pdf" | "docx";

export const SUPPORTED_RESUME_EXTENSIONS: readonly SupportedResumeExtension[] = [
  "pdf",
  "docx",
];

export interface ExtractionSuccess {
  ok: true;
  text: string;
}

export interface ExtractionFailure {
  ok: false;
  error: string;
}

export type ExtractionResult = ExtractionSuccess | ExtractionFailure;

/**
 * Extract plain text from a resume file buffer.
 *
 * Fails closed: any parse error, password-protected file, or scanned/
 * image-only document (which has no extractable text) produces a clear
 * failure message rather than a partial or misleading result. Callers
 * persist this outcome via `saveResumeExtraction` / `failResumeExtraction`.
 */
export async function extractResumeText(
  buffer: Buffer,
  extension: string
): Promise<ExtractionResult> {
  const normalizedExtension = extension.toLowerCase();

  if (!SUPPORTED_RESUME_EXTENSIONS.includes(normalizedExtension as SupportedResumeExtension)) {
    return {
      ok: false,
      error: `Unsupported file type: .${extension}. Only PDF and DOCX are supported.`,
    };
  }

  try {
    let rawText: string;

    if (normalizedExtension === "pdf") {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const result = await extractText(pdf, { mergePages: true });
      rawText = Array.isArray(result.text) ? result.text.join("\n") : result.text;
    } else {
      const { value } = await mammoth.extractRawText({ buffer });
      rawText = value;
    }

    const normalized = rawText.replace(/\r\n/g, "\n").trim();

    if (normalized.length < LIMITS.inputTextMin) {
      return {
        ok: false,
        error:
          "Could not extract readable text from this file. It may be scanned/image-only, empty, or password-protected.",
      };
    }

    // Guard against pathological files that would blow past the AI pipeline's
    // input bounds; truncate rather than reject, since a long resume is still
    // usable for matching.
    const bounded =
      normalized.length > LIMITS.inputTextMax
        ? normalized.slice(0, LIMITS.inputTextMax)
        : normalized;

    return { ok: true, text: bounded };
  } catch (error) {
    console.error("Resume text extraction failed:", error);
    return {
      ok: false,
      error:
        "Failed to extract text from the uploaded file. The file may be corrupted or password-protected.",
    };
  }
}

/**
 * Client- and server-shared validation for uploaded resume files.
 *
 * Kept separate from `extractText.ts` (which does the actual parsing) so the
 * upload UI can validate a file the instant it's selected, before any network
 * request, and the server route can re-validate the same rules — never trust
 * client-side checks alone.
 */

import { SUPPORTED_RESUME_EXTENSIONS } from "./extractText";

/** 10 MB. Generous for a resume; guards against pathological uploads. */
export const MAX_RESUME_FILE_SIZE_BYTES = 10 * 1024 * 1024;

const MIME_TYPES_BY_EXTENSION: Record<string, string[]> = {
  pdf: ["application/pdf"],
  docx: [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
};

export interface FileLike {
  name: string;
  size: number;
  type?: string;
}

export interface FileValidationResult {
  ok: boolean;
  error?: string;
  extension?: string;
}

function getExtension(fileName: string): string {
  const match = /\.([a-zA-Z0-9]+)$/.exec(fileName);
  return match ? match[1].toLowerCase() : "";
}

/**
 * Validates extension, declared MIME type (when the browser/client supplies
 * one — some upload paths omit it), and file size. Does not open the file;
 * that happens during extraction, which independently fails closed on
 * unreadable content.
 */
export function validateResumeFile(file: FileLike): FileValidationResult {
  const extension = getExtension(file.name);

  if (!extension) {
    return { ok: false, error: "File is missing an extension." };
  }

  if (
    !SUPPORTED_RESUME_EXTENSIONS.includes(
      extension as (typeof SUPPORTED_RESUME_EXTENSIONS)[number]
    )
  ) {
    return {
      ok: false,
      error: `Unsupported file type ".${extension}". Only PDF and DOCX files are supported.`,
    };
  }

  const expectedMimeTypes = MIME_TYPES_BY_EXTENSION[extension] ?? [];
  if (file.type && expectedMimeTypes.length > 0 && !expectedMimeTypes.includes(file.type)) {
    return {
      ok: false,
      error: `File content type "${file.type}" does not match a .${extension} file.`,
    };
  }

  if (file.size <= 0) {
    return { ok: false, error: "File is empty." };
  }

  if (file.size > MAX_RESUME_FILE_SIZE_BYTES) {
    const maxMb = MAX_RESUME_FILE_SIZE_BYTES / (1024 * 1024);
    return {
      ok: false,
      error: `File is too large. Maximum size is ${maxMb}MB.`,
    };
  }

  return { ok: true, extension };
}

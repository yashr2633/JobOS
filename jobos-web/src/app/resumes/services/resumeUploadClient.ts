/**
 * Client-side wrapper for POST /api/resumes/upload.
 *
 * Mirrors the pattern in `applications/services/aiClient.ts`: the route does
 * all the real work (Storage upload, text extraction, DB row creation)
 * server-side; this just posts the file and translates HTTP status codes
 * into user-friendly messages.
 */

export interface UploadedResume {
  id: string;
  label: string;
}

export async function uploadResumeFile(
  file: File,
  label?: string
): Promise<UploadedResume> {
  const formData = new FormData();
  formData.append("file", file);
  if (label && label.trim() !== "") {
    formData.append("label", label.trim());
  }

  const response = await fetch("/api/resumes/upload", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = (body as { error?: string })?.error ?? `HTTP ${response.status}`;

    switch (response.status) {
      case 401:
        throw new Error("You must be logged in to upload a resume.");
      case 400:
        throw new Error(message);
      case 422:
        throw new Error(message);
      case 502:
        throw new Error("Failed to store the uploaded file. Please try again.");
      default:
        throw new Error(message);
    }
  }

  return (await response.json()) as UploadedResume;
}

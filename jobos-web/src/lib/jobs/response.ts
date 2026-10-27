/** Never render hosting error pages, parser diagnostics or response bodies as UI. */
export async function readJobJson<T extends object>(response: Response, fallback: string): Promise<T> {
  const message = response.status === 401 ? "Your session has expired. Please sign in again." : response.status === 429 ? "Please wait a moment before trying again." : fallback;
  let body: unknown;
  try {
    const text = await response.text();
    if (!text.trim() || text.length > 2_500_000) throw new Error();
    body = JSON.parse(text);
  } catch { throw new Error(message); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error(message);
  const value = body as Record<string, unknown>;
  if ("error" in value) {
    const error = value.error;
    value.error = typeof error === "string" && error.trim().length > 0 && error.length <= 320 && !/Unexpected token|not valid JSON|JSON\.parse|<!doctype|<html|stack trace/i.test(error) ? error : message;
  }
  return value as T;
}

export class JobRequestTimeout extends Error {}
export async function withinJobDeadline<T>(task: () => Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve().then(task), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new JobRequestTimeout("Job request timed out")), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

/** Read only the provider's bounded retry interval, never expose its error body. */
export function searchRetrySeconds(value: unknown): number {
  const body = value as { error?: { details?: unknown[] } } | null;
  const details = Array.isArray(body?.error?.details) ? body.error.details : [];
  const retries = details.flatMap(detail => {
    if (!detail || typeof detail !== "object") return [];
    const delay = (detail as { retryDelay?: unknown }).retryDelay;
    if (typeof delay !== "string" || !/^\d{1,8}(?:\.\d{1,6})?s$/.test(delay)) return [];
    const seconds = Math.ceil(parseFloat(delay));
    return seconds > 0 ? [Math.min(seconds, 86400)] : [];
  });
  return retries.length ? Math.max(...retries) : 60;
}
export function searchQuotaMessage(seconds: number): string {
  const wait = seconds >= 3600 ? "about " + Math.ceil(seconds / 3600) + " hours" : "about " + Math.max(1, Math.ceil(seconds / 60)) + " minutes";
  return "Public-source search has reached its provider quota. Try again in " + wait + ". Connected employer listings still work.";
}

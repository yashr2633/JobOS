/** Deliberately small, content-free analytics payloads. Never accept arbitrary metadata. */
export const CLIENT_EVENTS = ["page_view", "job_search", "job_view", "apply_click", "employer_open", "template_selected", "pro_view", "checkout_open", "recruiter_view", "outreach_draft_created", "mail_composer_open", "letter_tailored"] as const;
export type ClientEvent = typeof CLIENT_EVENTS[number];
export type ProductEvent = ClientEvent | "document_saved" | "document_exported" | "resume_tailored" | "letter_tailored" | "recruiter_unlocked" | "generation_failed";
export const EVENT_NAMES: readonly string[] = [...CLIENT_EVENTS, "document_saved", "document_exported", "resume_tailored", "letter_tailored", "recruiter_unlocked", "generation_failed"];
export const UUID = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const safeLabel = (value: unknown, max = 80) => typeof value === "string" && value.length <= max && /^[\p{L}\p{N} _.,&/()+-]*$/u.test(value) && !/\d{10,}|https?:/i.test(value) ? value.trim() : undefined;
export function analyticsPath(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.length > 500) return;
  const path = value.split(/[?#]/)[0];
  if (/^\/(admin|auth|api)(\/|$)/.test(path)) return;
  // Never retain user IDs, contact IDs, tracking tokens or job IDs in page paths.
  return path.split("/").map(part => /%|:|@|[\da-f]{8}-|\d{6,}/i.test(part) ? ":id" : part).join("/").slice(0, 160);
}
export function eventProperties(input: unknown): Record<string, string | number> {
  const row = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const out: Record<string, string | number> = {};
  const path = analyticsPath(row.path); if (path) out.path = path;
  for (const key of ["source", "medium", "campaign", "content", "location", "category", "company", "kind", "format", "template", "plan", "reason", "workflow"] as const) {
    const value = safeLabel(row[key]); if (value) out[key] = value;
  }
  if (typeof row.jobId === "string" && /^(greenhouse|lever|ashby|smartrecruiters|himalayas):[\w:-]{1,160}$/.test(row.jobId)) out.jobId = row.jobId;
  if (typeof row.durationMs === "number" && Number.isFinite(row.durationMs)) out.durationMs = Math.max(0, Math.min(180000, Math.round(row.durationMs)));
  return out;
}
export function parseProductEvent(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!CLIENT_EVENTS.includes(row.event as ClientEvent) || typeof row.id !== "string" || !UUID.test(row.id)) return null;
  if (row.session !== undefined && (typeof row.session !== "string" || !UUID.test(row.session))) return null;
  return { id: row.id, event: row.event as ClientEvent, session: typeof row.session === "string" ? row.session : null, properties: eventProperties(row.properties) };
}
export function analyticsPeriod(value: string | null): 7 | 28 | 90 | null { return value === null || value === "28" ? 28 : value === "7" ? 7 : value === "90" ? 90 : null; }
export function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  // Neutralise spreadsheet formulas, including leading whitespace/control characters.
  return '"' + (/^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? "'" + text : text).replaceAll('"', '""') + '"';
}

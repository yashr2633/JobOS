export const JOB_STATUSES = ["Draft", "Published", "Paused", "Closed"] as const;
export const STAGES = ["New", "Review", "Shortlisted", "Interview", "Offer", "Rejected"] as const;
export const WORK_MODES = ["On-site", "Hybrid", "Remote"] as const;
export const EMPLOYMENT_TYPES = ["Full-time", "Part-time", "Contract", "Internship"] as const;
export function isUuid(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value); }
export function field(data: FormData, key: string, min: number, max: number): string {
  const value = data.get(key);
  if (typeof value !== "string" || value.trim().length < min || value.trim().length > max) throw new Error(`Check ${key.replaceAll("_", " ")} (${min}–${max} characters).`);
  return value.trim();
}
export function allowed<T extends string>(value: string, options: readonly T[]): T {
  if (!options.includes(value as T)) throw new Error("Choose a valid option.");
  return value as T;
}
export function deadlineValue(value: string): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error("Choose a valid application deadline.");
  return value;
}
export function websiteValue(value: string): string {
  if (!value) return "";
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".")) throw new Error("Use an HTTPS company website.");
  return url.href;
}

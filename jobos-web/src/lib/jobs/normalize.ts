import { extractSkills } from "./matching.ts";
import { normalizeText } from "../ai/normalize.ts";
import type { Job, WorkMode } from "./types.ts";

export function plainText(value: string): string {
  // Feeds may HTML-encode their HTML. Decode before stripping; render as text only.
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  let text = value.slice(0, 250_000);
  for (let i = 0; i < 2; i++) text = text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (all, entity: string) => {
    if (!entity.startsWith("#")) return entities[entity.toLowerCase()] ?? all;
    const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });
  return text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/?(?:p|div|li|h[1-6]|br)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, " ").replace(/[ \t]+/g, " ").replace(/\n\s*\n/g, "\n\n").trim().slice(0, 45_000);
}

export function safeJobUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    if (!url.hostname.includes(".") || /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[)/i.test(url.hostname)) return null;
    return url.toString();
  } catch { return null; }
}

export function dateValue(value: unknown): string | null {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

export function detectWorkMode(location: string): WorkMode | null {
  if (/\bhybrid\b/i.test(location)) return "Hybrid";
  if (/\b(remote|home[- ]based)\b/i.test(location)) return "Remote";
  if (/\bon[- ]site\b/i.test(location)) return "On-site";
  return null;
}

export function enrichJob(job: Job): Job {
  const experience = job.description.match(/\b(\d{1,2})(?:\s*[-–]\s*\d{1,2})?\+?\s+years?\s+(?:of\s+)?(?:relevant\s+|professional\s+|industry\s+)?experience\b/i);
  return {
    ...job,
    location: job.location.replace(/\bBangalore\b/gi, "Bengaluru").replace(/\bBombay\b/gi, "Mumbai").replace(/\bGurgaon\b/gi, "Gurugram").replace(/\bpan[- ]india\b/gi, "Pan India"),
    workMode: job.workMode ?? detectWorkMode(job.location),
    minYearsExperience: job.minYearsExperience ?? (experience ? Number(experience[1]) : null),
    skills: extractSkills(job.description),
    requirements: job.description.split(/\n+/).filter((line) => /\b(required|must have|experience|proficien|knowledge of|ability to)\b/i.test(line)).filter((line) => line.length < 500).slice(0, 12),
  };
}

export function deduplicateJobs(jobs: Job[], now = Date.now()): Job[] {
  const ids = new Set<string>(), urls = new Set<string>(), identities = new Set<string>();
  return [...jobs].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")).filter((job) => {
    if (job.expiresAt && Date.parse(job.expiresAt) <= now) return false;
    const identity = [job.company, job.title, job.location].map(normalizeText).join("|") + "|" + (job.postedAt?.slice(0, 10) ?? job.externalId);
    const canonical = new URL(job.applicationUrl);
    canonical.hash = "";
    for (const key of [...canonical.searchParams.keys()]) if (/^(utm_|gh_src$|source$)/i.test(key)) canonical.searchParams.delete(key);
    if (/^(jobs\.lever\.co|jobs\.ashbyhq\.com)$/.test(canonical.hostname)) canonical.pathname = canonical.pathname.replace(/\/(apply|application)\/?$/, "");
    const url = canonical.toString();
    if (ids.has(job.id) || urls.has(url) || identities.has(identity)) return false;
    ids.add(job.id); urls.add(url); identities.add(identity); return true;
  });
}

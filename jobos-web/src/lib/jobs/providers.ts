import { dateValue, deduplicateJobs, enrichJob, plainText, safeJobUrl } from "./normalize.ts";
import type { Job } from "./types.ts";
import { additionalSources, lever, ashby } from "./ats.ts";
import { INDIA_SOURCES } from "./sources-india.ts";

export interface JobProvider {
  source: string;
  list(board: string): Promise<Job[]>;
  get(board: string, externalId: string): Promise<Job | null>;
}

type Row = Record<string, unknown>;
function object(value: unknown): Row { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }
const text = (value: unknown) => typeof value === "string" ? value : "";

// India-first source registry with environment override capability
export function configuredBoards(): string[] {
  // If env explicitly sets boards, use those (for backward compatibility)
  const envBoards = process.env.JOB_DISCOVERY_GREENHOUSE_BOARDS;
  if (envBoards && envBoards !== "canonical") {
    return [...new Set(envBoards.split(",").map((s) => s.trim()).filter((s) => /^[a-z0-9_-]{1,80}$/.test(s)))].slice(0, 20);
  }
  
  // Otherwise use India source registry
  return INDIA_SOURCES
    .filter(s => s.enabled && s.provider === "greenhouse")
    .map(s => s.board)
    .filter((s) => /^[a-z0-9_-]{1,80}$/.test(s))
    .slice(0, 20);
}

async function request(board: string, path = ""): Promise<unknown | null> {
  if (!configuredBoards().includes(board)) throw new Error("Unknown job source");
  const response = await fetch(`https://boards-api.greenhouse.io/v1/boards/${board}${path}`, {
    // Public catalog only; no resume/profile/session data goes to the provider.
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Job source unavailable (${response.status})`);
  const body = await response.text();
  if (body.length > 15_000_000) throw new Error("Job source response too large");
  return JSON.parse(body);
}

export function normalizeGreenhouse(raw: unknown, board: string, company: string, fetchedAt: string): Job | null {
  const r = object(raw), id = String(r.id ?? ""), url = safeJobUrl(r.absolute_url);
  if (!/^\d+$/.test(id) || !company || !text(r.title) || !url || r.internal_job_id === null) return null;
  const ranges = Array.isArray(r.pay_input_ranges) ? r.pay_input_ranges : [];
  const range = object(ranges[0]);
  const salary = text(range.currency_type) && (typeof range.min_cents === "number" || typeof range.max_cents === "number") ? {
    min: typeof range.min_cents === "number" ? range.min_cents / 100 : null,
    max: typeof range.max_cents === "number" ? range.max_cents / 100 : null,
    currency: text(range.currency_type), period: null,
  } : null;
  const metadata = Array.isArray(r.metadata) ? r.metadata.map(object) : [];
  const employment = metadata.find((m) => /^(employment type|employment_type)$/i.test(text(m.name)));
  return enrichJob({
    id: `greenhouse:${board}:${id}`, source: "Greenhouse", board, externalId: id, company,
    title: text(r.title).slice(0, 250), description: plainText(text(r.content)),
    location: text(object(r.location).name).slice(0, 500), workMode: null,
    minYearsExperience: null, skills: [], requirements: [], salary,
    employmentType: text(employment?.value) || null,
    postedAt: dateValue(r.first_published), updatedAt: dateValue(r.updated_at),
    expiresAt: dateValue(r.application_deadline), fetchedAt,
    applicationUrl: url, sourceUrl: `https://job-boards.greenhouse.io/${board}`, availability: "listed",
  });
}

export const greenhouse: JobProvider = {
  source: "Greenhouse",
  async list(board) {
    const [info, listing] = await Promise.all([request(board), request(board, "/jobs?content=true")]);
    if (!info || !listing || !Array.isArray(object(listing).jobs)) throw new Error("Job board is unavailable");
    const name = text(object(info).name), now = new Date().toISOString();
    return (object(listing).jobs as unknown[]).map((row) => normalizeGreenhouse(row, board, name, now)).filter((job): job is Job => job !== null);
  },
  async get(board, externalId) {
    if (!/^\d+$/.test(externalId)) return null;
    const raw = await request(board, `/jobs/${externalId}?pay_transparency=true`);
    if (!raw) return null;
    const company = text(object(raw).company_name) || text(object(await request(board)).name);
    return normalizeGreenhouse(raw, board, company, new Date().toISOString());
  },
};

export const JOB_PROVIDERS: Record<string, JobProvider> = { greenhouse, lever, ashby };
export interface Catalog { jobs: Job[]; warnings: string[]; checkedAt: string }
// Bounded per-process cache + shared pending promise prevents burst refetches.
// Failures never masquerade as a refreshed catalog. No indefinite stale fallback.
let cache: { key: string; until: number; value: Catalog } | null = null;
let pending: { key: string; promise: Promise<Catalog> } | null = null;
const unavailable = new Map<string, number>();
function visibleCatalog(value: Catalog): Catalog {
  const now = Date.now();
  for (const [id, until] of unavailable) if (until <= now) unavailable.delete(id);
  return { ...value, jobs: value.jobs.filter((j) => !unavailable.has(j.id) && (!j.expiresAt || Date.parse(j.expiresAt) > now)) };
}
export async function getCatalog(): Promise<Catalog> {
  // Combine Greenhouse boards from India registry with Lever/Ashby from env
  const greenhouseBoards = configuredBoards().map((board) => ({provider: "greenhouse" as const, board}));
  const leverAshbyBoards = additionalSources().filter((s) => s.enabled);
  
  // Add additional India sources from registry for Lever/Ashby
  const indiaLever = INDIA_SOURCES.filter(s => s.enabled && s.provider === "lever").map(s => ({
    provider: s.provider,
    board: s.board,
  }));
  const indiaAshby = INDIA_SOURCES.filter(s => s.enabled && s.provider === "ashby").map(s => ({
    provider: s.provider,
    board: s.board,
  }));
  
  const sources = [...greenhouseBoards, ...leverAshbyBoards, ...indiaLever, ...indiaAshby]
    .filter((s, i, arr) => arr.findIndex(x => x.provider === s.provider && x.board === s.board) === i); // deduplicate
  
  const key = sources.map((s) => `${s.provider}:${s.board}`).join(",");
  if (cache?.key === key && cache.until > Date.now()) return visibleCatalog(cache.value);
  if (pending?.key === key) return visibleCatalog(await pending.promise);
  const promise = (async () => {
    const settled = await Promise.allSettled(sources.map((s) => JOB_PROVIDERS[s.provider].list(s.board)));
    const value: Catalog = { jobs: [], warnings: [], checkedAt: new Date().toISOString() };
    let failedCount = 0;
    settled.forEach((r, index) => {
      if (r.status === "fulfilled") value.jobs.push(...r.value);
      else {
        failedCount++;
        // Silent fail - log but don't show per-source warnings to users
        console.warn(`Job source ${sources[index].provider}/${sources[index].board} unavailable:`, r.reason);
      }
    });
    if (!sources.length) value.warnings.push("No job boards are configured.");
    else if (failedCount > 0 && value.jobs.length === 0) {
      // Only show generic message if ALL sources failed
      value.warnings.push("Job sources are temporarily unavailable. Please try again later.");
    } else if (failedCount > sources.length / 2) {
      // Show gentle notice if majority failed but some succeeded
      value.warnings.push("Some job sources are unavailable. Results may be incomplete.");
    }
    // Otherwise silent success - don't mention individual failures
    value.jobs = deduplicateJobs(value.jobs);
    cache = { key, until: Date.now() + (value.warnings.length ? 60_000 : 15 * 60_000), value };
    return value;
  })();
  pending = { key, promise };
  try { return visibleCatalog(await promise); } finally { if (pending?.promise === promise) pending = null; }
}

export async function getLiveJob(id: string): Promise<Job | null> {
  const parts = id.match(/^([a-z]+):([a-zA-Z0-9_-]{1,80}):([a-zA-Z0-9_-]{1,64})$/);
  if (!parts || !(parts[1] === "greenhouse" ? configuredBoards().includes(parts[2]) : additionalSources().some((s) => s.enabled && s.provider === parts[1] && s.board === parts[2]))) return null;
  const provider = JOB_PROVIDERS[parts[1]];
  if (!provider) return null;
  try {
    const job = await provider.get(parts[2], parts[3]);
    if (job && (!job.expiresAt || Date.parse(job.expiresAt) > Date.now())) {
      unavailable.delete(id); return job;
    }
    if (unavailable.size >= 1000) unavailable.delete(unavailable.keys().next().value!);
    unavailable.set(id, Date.now() + 15 * 60_000);
    return null;
  } catch (error) {
    if (unavailable.size >= 1000) unavailable.delete(unavailable.keys().next().value!);
    unavailable.set(id, Date.now() + 60_000);
    throw error;
  }
}

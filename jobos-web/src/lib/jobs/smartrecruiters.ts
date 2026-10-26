import type { JobProvider } from "./providers.ts";
import type { Job } from "./types.ts";
import { dateValue, enrichJob, plainText, safeJobUrl } from "./normalize.ts";
import { INDIA_SOURCES } from "./sources-india.ts";

type Row = Record<string, unknown>;
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const str = (value: unknown) => typeof value === "string" ? value : "";
export function smartRecruitersSources() {
  // Explicit empty override disables this provider, including isolated adapter tests.
  const configured = process.env.JOB_DISCOVERY_SMARTRECRUITERS_BOARDS;
  return INDIA_SOURCES.filter(s => s.enabled && s.provider === "smartrecruiters"
    && (configured === undefined || configured.split(",").map(v => v.trim()).includes(s.board)));
}
function sourceFor(board: string) {
  const source = smartRecruitersSources().find(s => s.board === board);
  if (!source) throw new Error("Unknown public employer source");
  return source;
}
function officialUrl(value: unknown, board: string, id: string) {
  const url = safeJobUrl(value);
  if (!url) return null;
  const parsed = new URL(url);
  return parsed.hostname === "jobs.smartrecruiters.com"
    && new RegExp(`^/${board}/${id}(?:-|$|/)`, "i").test(parsed.pathname) ? url : null;
}
export function normalizeSmartRecruiters(raw: unknown, board: string, company: string, fetchedAt: string, detail = false): Job | null {
  const r = row(raw), location = row(r.location), id = str(r.id);
  if (!/^\d{1,64}$/.test(id) || !str(r.name) || str(location.country).toLowerCase() !== "in" || r.visibility !== "PUBLIC") return null;
  const sections = row(row(r.jobAd).sections);
  const description = ["jobDescription", "qualifications", "additionalInformation"]
    .map(key => { const section = row(sections[key]); return str(section.text) ? `${str(section.title)}\n${plainText(str(section.text))}` : ""; }).filter(Boolean).join("\n\n");
  const sourceUrl = officialUrl(r.postingUrl, board, id) ?? `https://jobs.smartrecruiters.com/${board}/${id}`;
  const apply = detail ? officialUrl(r.applyUrl, board, id) : sourceUrl;
  if (!apply) return null;
  return enrichJob({
    id: `smartrecruiters:${board}:${id}`, source: "SmartRecruiters", board, externalId: id,
    company, title: str(r.name).slice(0, 250), description: description.slice(0, 45_000),
    descriptionPending: !detail, location: [str(location.city), str(location.region), "India"].filter(Boolean).join(", "),
    workMode: location.remote === true ? "Remote" : location.hybrid === true ? "Hybrid" : null,
    skills: [], requirements: [], minYearsExperience: null, salary: null,
    employmentType: str(row(r.typeOfEmployment).label) || null, category: str(row(r.function).label) || null,
    // releasedDate can change when an old vacancy is republished. Preserve it separately.
    postedAt: null, releasedAt: dateValue(r.releasedDate), updatedAt: null, expiresAt: null,
    fetchedAt, applicationUrl: apply, sourceUrl, availability: "listed",
  });
}
async function request(board: string, path: string, signal: AbortSignal): Promise<unknown | null> {
  sourceFor(board);
  await acquire();
  try {
  // Shared launch pacing also covers parallel boards/detail requests in this
  // process, staying below the documented ten requests/second customer limit.
  const slot = Math.max(Date.now(), nextRequestAt);
  nextRequestAt = slot + 150;
  await new Promise(resolve => setTimeout(resolve, Math.max(0, slot - Date.now())));
  signal.throwIfAborted();
  const response = await fetch(`https://api.smartrecruiters.com/v1/companies/${board}/postings${path}`, {
    cache: "no-store", redirect: "error", signal,
  });
  if (response.status === 404 || response.status === 410) return null;
  if (!response.ok) throw new Error(`Public employer source unavailable (${response.status})`);
  const body = await response.text();
  if (body.length > 15_000_000) throw new Error("Public employer response too large");
  return JSON.parse(body);
  } finally { release(); }
}
let nextRequestAt = 0;
let active = 0;
const waiting: (() => void)[] = [];
async function acquire() {
  if (active < 6) { active++; return; }
  await new Promise<void>(resolve => waiting.push(resolve));
}
function release() {
  const next = waiting.shift();
  if (next) next(); else active--;
}
export const smartrecruiters: JobProvider = {
  source: "SmartRecruiters",
  async list(board) {
    const source = sourceFor(board), signal = AbortSignal.timeout(25_000);
    const path = (offset: number) => `?country=in&destination=PUBLIC&limit=100&offset=${offset}`;
    const first = row(await request(board, path(0), signal));
    const total = first.totalFound;
    if (!Array.isArray(first.content) || typeof total !== "number" || !Number.isInteger(total) || total < 0 || total > 3000) throw new Error("Employer feed exceeds verified pagination bounds");
    const entries: unknown[] = [...first.content];
    // Page batches plus the shared request limiter keep concurrency bounded.
    // No per-card detail requests are issued while loading the feed.
    for (let offset = 100; offset < total; offset += 300) {
      const offsets = [offset, offset + 100, offset + 200].filter(n => n < total);
      const pages = await Promise.all(offsets.map(n => request(board, path(n), signal)));
      for (const page of pages) {
        if (!Array.isArray(row(page).content)) throw new Error("Incomplete public employer feed");
        entries.push(...row(page).content as unknown[]);
      }
    }
    // Do not pass off a truncated page as a complete synchronization.
    if (entries.length < total) throw new Error("Incomplete public employer pagination");
    const now = new Date().toISOString();
    return entries.map(item => normalizeSmartRecruiters(item, board, source.company, now)).filter((job): job is Job => !!job);
  },
  async get(board, id) {
    const source = sourceFor(board);
    if (!/^\d{1,64}$/.test(id)) return null;
    const data = await request(board, `/${id}`, AbortSignal.timeout(15_000));
    return data ? normalizeSmartRecruiters(data, board, source.company, new Date().toISOString(), true) : null;
  },
};

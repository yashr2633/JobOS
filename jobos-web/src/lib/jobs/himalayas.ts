import { dateValue, enrichJob, plainText, safeJobUrl } from "./normalize.ts";
import type { Job } from "./types.ts";
import { publicJobQuery } from "./searchSuggestions.ts";
import { createHash } from "node:crypto";
import { resolveLocation } from "./locations.ts";

type Row = Record<string, unknown>;
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const text = (value: unknown) => typeof value === "string" ? value : "";
const seconds = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  const date = new Date(value * 1000);
  return Number.isFinite(date.getTime()) ? dateValue(date.toISOString()) : null;
};
const pathPattern = /^\/companies\/[a-z0-9-]{1,100}\/jobs\/[a-z0-9-]{1,300}$/;
export const HIMALAYAS_PAGE_LIMIT = 5;
export const HIMALAYAS_CACHE_SECONDS = 24 * 60 * 60;
function jobId(path: string) { return `himalayas:india:${createHash("sha256").update(path).digest("hex")}`; }
export function himalayasPath(id: string, sourceUrl?: string): string | null {
  const safe = safeJobUrl(sourceUrl);
  if (!safe || safe.length > 800) return null;
  const url = new URL(safe);
  return url.hostname === "himalayas.app" && !url.search && !url.hash && pathPattern.test(url.pathname) && jobId(url.pathname) === id ? url.pathname : null;
}
export function normalizeHimalayas(value: unknown, fetchedAt: string): Job | null {
  const raw = row(value), guid = safeJobUrl(raw.guid), apply = safeJobUrl(raw.applicationLink);
  if (!guid || !apply || !text(raw.title) || !text(raw.companyName)) return null;
  const source = new URL(guid);
  if (source.hostname !== "himalayas.app" || !pathPattern.test(source.pathname) || source.search || source.hash) return null;
  // Explicit India restriction only. Worldwide/US-only/unknown eligibility must
  // not be relabelled as an India vacancy. IST must also be permitted.
  if (!Array.isArray(raw.locationRestrictions) || !raw.locationRestrictions.some(value => /^(india|in)$/i.test(String(value)))) return null;
  if (!Array.isArray(raw.timezoneRestrictions) || (raw.timezoneRestrictions.length && !raw.timezoneRestrictions.includes(5.5))) return null;
  const expiresAt = seconds(raw.expiryDate);
  if (!expiresAt || Date.parse(expiresAt) <= Date.parse(fetchedAt)) return null;
  const updatedAt = seconds(raw.pubDate);
  if (updatedAt && Date.parse(updatedAt) > Date.parse(fetchedAt)) return null;
  const id = jobId(source.pathname), externalId = id.split(":")[2];
  // Country-level eligibility does not override a city explicitly stated in
  // the title (e.g. an account role assigned to Hyderabad).
  const titleCities = [...new Set(text(raw.title).split(/[,|/()–—-]+/).flatMap(part => {
    const city = resolveLocation(part.trim()); return city ? [city.label] : [];
  }))];
  const employment = text(raw.employmentType), period = text(raw.salaryPeriod);
  const amount = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  return enrichJob({
    id, source: "Himalayas", board: "india", externalId,
    company: text(raw.companyName).slice(0, 200), title: text(raw.title).slice(0, 250),
    description: plainText(text(raw.description)), location: titleCities.length ? `${titleCities.join(" · ")} · India` : "India", workMode: "Remote", remoteIndiaEligible: !titleCities.length,
    requirements: [], skills: [], minYearsExperience: null, employmentType: employment || null,
    category: Array.isArray(raw.parentCategories) ? text(raw.parentCategories[0]) || null : null,
    salary: text(raw.currency) && (amount(raw.minSalary) !== null || amount(raw.maxSalary) !== null) ? { min: amount(raw.minSalary), max: amount(raw.maxSalary), currency: text(raw.currency), period: (({yearly:"year",monthly:"month",hourly:"hour"} as Record<string,string>)[period] ?? period) || null } : null,
    // The provider explicitly defines pubDate as last UPDATED, not first posted.
    postedAt: null, releasedAt: null, updatedAt, expiresAt, fetchedAt,
    applicationUrl: text(raw.applicationLink), sourceUrl: guid, availability: "listed",
  });
}
async function request(path: string, deadline?: AbortSignal): Promise<unknown | null> {
  const timeout = AbortSignal.timeout(12_000);
  const response = await fetch(`https://himalayas.app${path}`, { cache: "no-store", redirect: "error", signal: deadline ? AbortSignal.any([deadline, timeout]) : timeout });
  if (response.status === 404 || response.status === 410) { await response.body?.cancel(); return null; }
  if (!response.ok) { await response.body?.cancel(); throw new Error("Himalayas public source unavailable"); }
  const body = await response.text();
  if (body.length > 3_000_000) throw new Error("Himalayas source response too large");
  return JSON.parse(body);
}
export interface RemoteFeed { jobs: Job[]; checkedAt: string; limited: boolean }
export async function readHimalayasFeed(query = ""): Promise<RemoteFeed> {
  const q = publicJobQuery(query), jobs = new Map<string, Job>(), checkedAt = new Date().toISOString();
  const deadline = AbortSignal.timeout(25_000);
  let limited = false, bytes = 0;
  // This is deliberately a recent/search slice, never advertised as every job
  // at this source. Ignore the provider's estimated totalCount entirely.
  for (let page = 1; page <= HIMALAYAS_PAGE_LIMIT; page++) {
    const params = new URLSearchParams({ country: "IN", exclude_worldwide: "true", sort: "recent", page: String(page) });
    if (q) params.set("q", q);
    const body = row(await request(`/jobs/api/search?${params}`, deadline));
    if (!Array.isArray(body.jobs) || body.jobs.length > 20) throw new Error("Himalayas source returned an incomplete response");
    if (!body.jobs.length) return { jobs: [...jobs.values()], checkedAt, limited: false };
    for (const value of body.jobs) {
      const job = normalizeHimalayas(value, checkedAt);
      if (!job || jobs.has(job.id)) continue;
      bytes += Buffer.byteLength(JSON.stringify(job), "utf8");
      if (bytes > 1_500_000) return { jobs: [...jobs.values()], checkedAt, limited: true };
      jobs.set(job.id, job);
    }
    limited = page === HIMALAYAS_PAGE_LIMIT;
  }
  return { jobs: [...jobs.values()], checkedAt, limited };
}
export async function getHimalayasJob(id: string, sourceUrl?: string): Promise<Job | null> {
  const path = himalayasPath(id, sourceUrl);
  if (!path) throw new Error("Invalid public job source identity");
  const body = await request(`/jobs/api${path}`);
  if (!body) return null;
  if (!row(row(body).job).guid) throw new Error("Himalayas listing could not be verified");
  const job = normalizeHimalayas(row(body).job, new Date().toISOString());
  if (job && job.id !== id) throw new Error("Himalayas listing identity mismatch");
  return job;
}

import type { JobProvider } from "./providers.ts";
import type { Job } from "./types.ts";
import { dateValue, enrichJob, plainText, safeJobUrl } from "./normalize.ts";

export interface JobSource { provider: "lever" | "ashby"; board: string; company: string; boardUrl: string; enabled: boolean }
// Real board identifiers, never job fixtures. Empty environment values disable a provider.
export function additionalSources(): JobSource[] {
  return (["lever", "ashby"] as const).flatMap((provider) => {
    const defaults = provider === "lever" ? "palantir" : "ashby";
    return [...new Set((process.env[`JOB_DISCOVERY_${provider.toUpperCase()}_BOARDS`] ?? defaults).split(",").map((s) => s.trim()).filter((s) => /^[a-zA-Z0-9_-]{1,80}$/.test(s)))].slice(0, 5)
      .map((board) => ({ provider, board, company: board === "palantir" ? "Palantir" : board === "ashby" ? "Ashby" : board, boardUrl: `https://${provider === "lever" ? "jobs.lever.co" : "jobs.ashbyhq.com"}/${board}`, enabled: true }));
  });
}
type Row = Record<string, unknown>;
const row = (v: unknown): Row => v && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
const str = (v: unknown) => typeof v === "string" ? v : "";
const strings = (v: unknown) => Array.isArray(v) ? v.map(str).filter(Boolean) : [];
function sourceFor(provider: JobSource["provider"], board: string): JobSource {
  const source = additionalSources().find((s) => s.enabled && s.provider === provider && s.board === board);
  if (!source) throw new Error("Unknown job source");
  return source;
}
async function request(url: string): Promise<unknown | null> {
  const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (response.status === 404 || response.status === 410) return null;
  if (!response.ok) throw new Error("Public job source unavailable");
  const body = await response.text();
  if (body.length > 15_000_000) throw new Error("Public job source response too large");
  return JSON.parse(body);
}
export function normalizeAts(raw: unknown, source: JobSource, fetchedAt: string): Job | null {
  const r = row(raw), lever = source.provider === "lever", categories = row(r.categories);
  if (!lever && r.isListed !== true) return null;
  const apply = safeJobUrl(r.applyUrl), jobUrl = safeJobUrl(lever ? r.hostedUrl : r.jobUrl);
  const id = str(r.id) || (jobUrl ? new URL(jobUrl).pathname.split("/").filter(Boolean).at(-1) ?? "" : "");
  const title = str(lever ? r.text : r.title);
  if (!apply || !jobUrl || !/^[a-zA-Z0-9_-]{1,64}$/.test(id) || !title) return null;
  // Source-returned official ATS links only; never fetch a URL supplied in a listing.
  const host = lever ? "jobs.lever.co" : "jobs.ashbyhq.com";
  if ([apply, jobUrl].some((url) => new URL(url).hostname !== host || !new URL(url).pathname.startsWith(`/${source.board}/`))) return null;
  const secondary = Array.isArray(r.secondaryLocations) ? r.secondaryLocations.map(row) : [];
  const address = row(row(r.address).postalAddress);
  const locations = lever ? [str(categories.location), ...strings(categories.allLocations), str(r.country).toUpperCase() === "IN" ? "India" : str(r.country)]
    : [str(r.location), str(address.addressCountry), ...secondary.flatMap((s) => [str(s.location), str(row(s.address).addressCountry)])];
  const lists = Array.isArray(r.lists) ? r.lists.map((v) => { const l = row(v); return `${str(l.text)}\n${plainText(str(l.content))}`; }) : [];
  const description = lever ? [str(r.descriptionPlain) || plainText(str(r.description)), ...lists, str(r.additionalPlain) || plainText(str(r.additional))].filter(Boolean).join("\n\n") : str(r.descriptionPlain) || plainText(str(r.descriptionHtml));
  const mode = str(r.workplaceType).toLowerCase();
  const created = typeof r.createdAt === "number" && Number.isFinite(new Date(r.createdAt).getTime()) ? new Date(r.createdAt).toISOString() : null;
  return enrichJob({ id: `${source.provider}:${source.board}:${id}`, source: lever ? "Lever" : "Ashby", board: source.board, externalId: id, company: source.company, title: title.slice(0, 250), description: description.slice(0, 45_000), requirements: [], skills: [], location: [...new Set(locations.filter(Boolean))].join(" · ").slice(0, 500), workMode: mode === "remote" || r.isRemote === true ? "Remote" : mode === "hybrid" ? "Hybrid" : ["onsite", "on-site"].includes(mode) ? "On-site" : null, minYearsExperience: null, salary: null, employmentType: str(lever ? categories.commitment : r.employmentType) || null, postedAt: lever ? created : dateValue(r.publishedAt), updatedAt: null, expiresAt: dateValue(r.validThrough), fetchedAt, applicationUrl: apply, sourceUrl: jobUrl, availability: "listed" });
}
export const lever: JobProvider = {
  source: "Lever",
  async list(board) {
    const source = sourceFor("lever", board), jobs: Job[] = [], seen = new Set<string>();
    for (let page = 0; page < 10; page++) {
      const data = await request(`https://api.lever.co/v0/postings/${board}?mode=json&skip=${page * 100}&limit=100`);
      if (!Array.isArray(data)) throw new Error("Lever board unavailable");
      const normalized = data.map((r) => normalizeAts(r, source, new Date().toISOString())).filter((j): j is Job => !!j);
      for (const job of normalized) { if (!seen.has(job.id)) jobs.push(job); seen.add(job.id); }
      if (data.length < 100) return jobs;
    }
    throw new Error("Lever board exceeds bounded pagination limit");
  },
  async get(board, id) {
    const source = sourceFor("lever", board);
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) return null;
    const data = await request(`https://api.lever.co/v0/postings/${board}/${id}?mode=json`);
    return data ? normalizeAts(data, source, new Date().toISOString()) : null;
  },
};
export const ashby: JobProvider = {
  source: "Ashby",
  async list(board) {
    const source = sourceFor("ashby", board);
    const data = row(await request(`https://api.ashbyhq.com/posting-api/job-board/${board}`));
    if (!Array.isArray(data.jobs)) throw new Error("Ashby board unavailable");
    return data.jobs.map((r) => normalizeAts(r, source, new Date().toISOString())).filter((j): j is Job => !!j);
  },
  // Public Ashby exposes a board feed, not an authenticated individual-job API.
  // Explicit apply/resume actions re-read it to confirm membership before use.
  async get(board, id) { return (await ashby.list(board)).find((j) => j.externalId === id) ?? null; },
};

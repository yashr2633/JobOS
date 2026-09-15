import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EMPTY_PROFILE, type Job } from "./types.ts";
import { extractSkills, scoreJob } from "./matching.ts";
import { deduplicateJobs, plainText, safeJobUrl } from "./normalize.ts";
import { parseProfile, prefillProfile, resumeEvidence, selectedResume, suggestRoles } from "./profile.ts";
import { discoveryResumes } from "./resumeLibrary.ts";
import { DEFAULT_RANKING, compareRanked, isActiveRecommendation, rankJob, rankingConfig } from "./ranking.ts";
import type { Resume } from "../ai/types.ts";
import { getCatalog, getLiveJob, greenhouse, normalizeGreenhouse } from "./providers.ts";

const job: Job = normalizeGreenhouse({
  id: 123, title: "Data Analyst", internal_job_id: 456,
  content: "<p>Required: SQL and Python. 3 years of experience.</p>",
  location: { name: "Remote - India" },
  absolute_url: "https://job-boards.greenhouse.io/example/jobs/123?utm_source=test",
  first_published: "2026-09-01T00:00:00Z",
}, "example", "Example employer", "2026-09-15T00:00:00Z")!;

test("normalizes real provider fields without inventing salary, deadline or employment", () => {
  assert.equal(job.workMode, "Remote");
  assert.equal(job.minYearsExperience, 3);
  assert.equal(job.salary, null);
  assert.equal(job.expiresAt, null);
  assert.equal(job.employmentType, null);
  assert.deepEqual(job.skills, ["Python", "SQL"]);
  assert.equal(job.applicationUrl, "https://job-boards.greenhouse.io/example/jobs/123");
  assert.equal(normalizeGreenhouse({ id: 4, title: "Talent pool", internal_job_id: null, absolute_url: job.applicationUrl }, "example", "Example", job.fetchedAt), null);
});

test("encoded HTML becomes text and unsafe application links are rejected", () => {
  assert.equal(plainText("&lt;p&gt;SQL &amp;amp; Python&lt;/p&gt;&lt;script&gt;bad()&lt;/script&gt;"), "SQL & Python");
  for (const url of ["javascript:alert(1)", "http://employer.example/job", "https://user:pass@employer.example/job", "https://127.0.0.1/job"]) assert.equal(safeJobUrl(url), null);
});

test("deduplication removes expired jobs and equivalent URLs while preserving distinct openings", () => {
  const newer = { ...job, updatedAt: "2026-09-10T00:00:00Z" };
  const duplicate = { ...job, id: "greenhouse:example:124", externalId: "124" };
  const separate = { ...job, id: "greenhouse:example:125", externalId: "125", applicationUrl: job.applicationUrl + "5", postedAt: "2026-09-02T00:00:00Z" };
  const expired = { ...separate, id: "expired", expiresAt: "2026-09-14T00:00:00Z" };
  assert.deepEqual(deduplicateJobs([job, duplicate, newer, separate, expired], Date.parse(job.fetchedAt)).map((j) => j.id), [job.id, separate.id]);
});

test("fit is deterministic, improves with evidence, and flags remote location restrictions", () => {
  const profile = { ...EMPTY_PROFILE, roles: ["Data Analyst"], skills: ["SQL"], yearsExperience: 1, locations: ["France"], workModes: ["Remote" as const] };
  const weak = scoreJob(job, profile);
  const strong = scoreJob(job, { ...profile, skills: ["SQL", "Python"], yearsExperience: 4, locations: ["India"] });
  assert.deepEqual(weak, scoreJob(job, profile));
  assert.ok(strong.score > weak.score);
  assert.ok(weak.gaps.some((g) => g.includes("location eligibility")));
  assert.deepEqual(weak.missingSkills, ["Python"]);
  assert.equal(strong.score, 100);
});

test("language names remain distinct and ordinary prose is not a Go/R skill", () => {
  assert.deepEqual(extractSkills("C++ and C#; go further in R&D."), ["C++", "C#"]);
  const fit = scoreJob({ ...job, description: "C++ and C#", skills: ["C++", "C#"] }, { ...EMPTY_PROFILE, skills: ["C#"] });
  assert.deepEqual(fit.matchedSkills, ["C#"]);
  assert.deepEqual(fit.missingSkills, ["C++"]);
});

test("missing data stays unknown and selected resume evidence affects fit", () => {
  const sparse = { ...job, skills: [], description: "A new opening", minYearsExperience: null, location: "", workMode: null };
  assert.equal(scoreJob(sparse, EMPTY_PROFILE).score, 0);
  assert.equal(scoreJob(sparse, EMPTY_PROFILE).evidence, "Limited");
  assert.ok(scoreJob(job, EMPTY_PROFILE, { id: "resume", label: "Resume", roles: ["Data Analyst"], skills: ["SQL", "Python"], yearsExperience: 4 }).score > scoreJob(job, EMPTY_PROFILE).score);
});

test("profile validation rejects unbounded, invalid and forged values", () => {
  assert.equal(parseProfile({ ...EMPTY_PROFILE, salaryCurrency: " inr " }).salaryCurrency, "INR");
  for (const patch of [{ roles: Array(11).fill("role") }, { yearsExperience: -1 }, { salaryMin: NaN }, { workModes: ["Anywhere"] }, { resumeId: "not-an-id" }, { salaryMin: 100, salaryCurrency: "" }]) {
    assert.throws(() => parseProfile({ ...EMPTY_PROFILE, ...patch }));
  }
});

test("live-job requests cannot choose arbitrary servers or unconfigured boards", async () => {
  assert.equal(await getLiveJob("https://attacker.example/jobs"), null);
  assert.equal(await getLiveJob("greenhouse:not-configured:123"), null);
  assert.equal(await getLiveJob("unknown:canonical:123"), null);
});

test("provider uses public fixed-host GETs, maps detail data, and treats closure as missing", async () => {
  const originalFetch = globalThis.fetch;
  const oldBoards = process.env.JOB_DISCOVERY_GREENHOUSE_BOARDS;
  process.env.JOB_DISCOVERY_GREENHOUSE_BOARDS = "example";
  const urls: string[] = [];
  globalThis.fetch = async (input, options) => {
    const url = String(input); urls.push(url);
    assert.equal(new URL(url).host, "boards-api.greenhouse.io");
    assert.equal(options?.redirect, "error");
    assert.equal(options?.headers, undefined);
    if (url.includes("/jobs/404")) return new Response(null, { status: 404 });
    if (url.includes("/jobs/123")) return Response.json({ id: 123, title: "Data Analyst", internal_job_id: 456, company_name: "Example", absolute_url: job.applicationUrl, content: "SQL", pay_input_ranges: [{ min_cents: 100000, max_cents: 200000, currency_type: "USD" }] });
    throw new Error("Unexpected URL");
  };
  try {
    const live = await greenhouse.get("example", "123");
    assert.equal(live?.salary?.min, 1000);
    assert.equal(live?.salary?.period, null);
    assert.equal(await greenhouse.get("example", "404"), null);
    assert.equal(urls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (oldBoards === undefined) delete process.env.JOB_DISCOVERY_GREENHOUSE_BOARDS;
    else process.env.JOB_DISCOVERY_GREENHOUSE_BOARDS = oldBoards;
  }
});

test("pre-apply flow shares analysis; confirmation alone inserts into the existing tracker", () => {
  const read = (path: string) => readFileSync(path, "utf8");
  const action = read("src/app/api/jobs/action/route.ts");
  assert.match(action, /action === "confirm"[\s\S]*rpc\("confirm_discovery_application"/);
  assert.doesNotMatch(action, /from\("applications"\).*insert/);
  const migration = read("supabase-schema-job-discovery.sql");
  assert.match(migration, /SECURITY INVOKER/);
  assert.match(migration, /WHERE user_id = v_user AND job_id = p_job_id FOR UPDATE/);
  assert.match(migration, /ON CONFLICT \(user_id, discovery_job_id\)/);
  assert.match(migration, /career_profiles ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /discovery_job_states ENABLE ROW LEVEL SECURITY/);
  assert.match(read("src/app/jobs/DiscoveryResumeMatch.tsx"), /<IntelligencePanel/);
  assert.match(read("src/app/api/intelligence/analyze/route.ts"), /createAnalysisRun\(supabase, applicationId, resumeId.trim\(\), discoveryJobId\)/);
});

test("optional live Greenhouse integration", { skip: process.env.JOB_DISCOVERY_LIVE_TEST !== "1" }, async () => {
  const jobs = await greenhouse.list("canonical");
  assert.ok(jobs.length > 0);
  assert.ok(jobs.every((j) => j.company && j.title && j.description && j.applicationUrl.startsWith("https://")));
  const detail = await getLiveJob(jobs[0].id);
  assert.equal(detail?.id, jobs[0].id);
  assert.ok(detail?.description);
});

const now = Date.parse("2026-09-15T00:00:00Z");
const fresh = (days: number): Job => ({ ...job, id: `age-${days}`, postedAt: new Date(now - days * 86_400_000).toISOString() });
const relevant = { ...EMPTY_PROFILE, roles: ["Data Analyst"], skills: ["SQL", "Python"], yearsExperience: 4 };

test("recommendations exclude stale, undated, future, expired and unconfirmed jobs", () => {
  assert.ok(isActiveRecommendation(fresh(30), now));
  for (const listing of [fresh(30.01), fresh(600), fresh(-1), { ...job, postedAt: null }, { ...job, postedAt: "invalid" }, { ...job, availability: "closed" as const }, { ...job, availability: "unavailable" as const }, { ...job, availability: undefined }, { ...job, expiresAt: new Date(now).toISOString() }, { ...job, fetchedAt: new Date(now - 21 * 60_000).toISOString() }]) assert.equal(isActiveRecommendation(listing, now), false);
  assert.equal(isActiveRecommendation({ ...fresh(600), updatedAt: new Date(now).toISOString() }, now), false, "an update never becomes a new posted date");
});

test("fresh qualifying jobs outrank higher-fit older jobs; very low relevance is excluded", () => {
  const partial = { ...fresh(3), skills: ["SQL", "Python", "Tableau"] };
  const bestOld = fresh(20);
  const ranked = [rankJob(bestOld, relevant, undefined, now), rankJob(partial, relevant, undefined, now)];
  assert.ok(ranked[0].fit.score > ranked[1].fit.score);
  assert.ok(ranked.every((r) => r.eligible));
  assert.equal(ranked.sort(compareRanked)[0].job.id, partial.id);
  const low = rankJob({ ...fresh(1), title: "Account Executive", description: "Sales and marketing", skills: ["Sales", "Marketing"] }, relevant, undefined, now);
  assert.equal(low.eligible, false);
  const seven = rankJob(fresh(7), relevant, undefined, now), eight = rankJob(fresh(8), relevant, undefined, now), fifteen = rankJob(fresh(15), relevant, undefined, now);
  assert.deepEqual([seven.freshnessBand, eight.freshnessBand, fifteen.freshnessBand], [0, 1, 2]);
  assert.equal([fifteen, eight, seven].sort((a, b) => compareRanked(a, b, true))[0].job.id, seven.job.id);
});

test("quality thresholds are configurable and invalid settings use safe defaults", () => {
  assert.equal(rankingConfig({ JOB_DISCOVERY_MAX_AGE_DAYS: "7", JOB_DISCOVERY_MIN_FIT: "60" }).maxAgeDays, 7);
  assert.equal(isActiveRecommendation(fresh(8), now, rankingConfig({ JOB_DISCOVERY_MAX_AGE_DAYS: "7" })), false);
  assert.equal(rankingConfig({ JOB_DISCOVERY_MAX_AGE_DAYS: "1000", JOB_DISCOVERY_MIN_FIT: "NaN" }).minFit, DEFAULT_RANKING.minFit);
  assert.equal(rankingConfig({ JOB_DISCOVERY_MAX_AGE_DAYS: "" }).maxAgeDays, 30);
});

test("a zero-experience profile meets an explicitly zero-experience opening", () => {
  const result = rankJob({ ...fresh(2), minYearsExperience: 0 }, { ...relevant, yearsExperience: 0 }, undefined, now);
  assert.equal(result.rankScore, 100, "zero required years must not reduce experience alignment");
  assert.equal(result.eligible, true);
});

test("role ideas combine skills/context and never copy titles or invent seniority", () => {
  assert.deepEqual(suggestRoles(["Excel", "SQL", "Power BI"], "Operations coordinator with reporting and a business degree"), ["Operations Analyst", "MIS Analyst", "Data Analyst", "Business Analyst"]);
  assert.deepEqual(suggestRoles([], "Senior Director"), []);
  assert.deepEqual(suggestRoles(["React", "TypeScript"], "Computer science degree"), ["Frontend Developer"]);
});

const resumeFixture = (patch: Partial<Resume> = {}): Resume => ({
  id: "resume-a", label: "Resume", source: "upload", fileName: "resume.pdf", filePath: "user/a.pdf", extractedText: "Location: Bengaluru, India\nOperations specialist with 3 years of experience using Excel and SQL for reporting.", extractionStatus: "complete", extractionError: null, parsed: null, parsedAt: null, parseStatus: "pending", parseError: null, isDefault: false, createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z", ...patch,
});

test("prefill is conservative and never replaces manual or intentionally cleared choices", () => {
  const evidence = resumeEvidence(resumeFixture());
  assert.deepEqual(evidence.locations, ["Bengaluru, India"]);
  assert.equal(evidence.yearsExperience, 3);
  assert.ok(evidence.suggestedRoles?.includes("Operations Analyst"));
  const built = prefillProfile(EMPTY_PROFILE, evidence);
  assert.deepEqual(built.skills, evidence.skills);
  assert.equal(built.yearsExperience, 3);
  const manual = { ...EMPTY_PROFILE, roles: ["Product Analyst"], skills: ["Custom skill"], yearsExperience: 1, locations: ["Pune"], keywords: ["Healthcare"] };
  assert.deepEqual(prefillProfile(manual, evidence), manual);
  assert.deepEqual(prefillProfile(EMPTY_PROFILE, evidence, ["roles", "yearsExperience"]).roles, []);
  assert.equal(prefillProfile(EMPTY_PROFILE, evidence, ["yearsExperience"]).yearsExperience, null);
  const unknown = resumeEvidence(resumeFixture({ extractedText: "Worked in operations. Employer office: London. Education: graduated 2018." }));
  assert.equal(unknown.yearsExperience, null);
  assert.deepEqual(unknown.locations, []);
});

test("duplicate display uses content, keeps distinct same-name files and resolves old selections", () => {
  const original = resumeFixture({ parsed: { skills: ["SQL", "Excel"], roles: [{ title: "Operations coordinator", years: 3 }], education: [], totalYearsExperience: 3 } });
  const newer = resumeFixture({ id: "newer", createdAt: "2026-09-10T00:00:00Z" });
  const different = resumeFixture({ id: "different", extractedText: "A completely different resume containing JavaScript, React, TypeScript and frontend project experience.", createdAt: "2026-09-05T00:00:00Z" });
  const unreadable = resumeFixture({ id: "empty", extractedText: null, createdAt: "2026-09-14T00:00:00Z", filePath: "user/empty.pdf" });
  const input = [original, newer, different, unreadable];
  const before = JSON.stringify(input), result = discoveryResumes(input);
  assert.deepEqual(result.map((r) => r.id), ["newer", "different", "empty"]);
  assert.equal(selectedResume(result, original.id)?.id, "newer");
  assert.equal(result[0].yearsExperience, 3);
  assert.deepEqual(result[0].roles, ["Operations coordinator"]);
  assert.equal(JSON.stringify(input), before, "never alters or deletes stored files");
});

test("known 404 removes a listing from cached recommendations without per-card validation", async () => {
  const originalFetch = globalThis.fetch, oldBoards = process.env.JOB_DISCOVERY_GREENHOUSE_BOARDS;
  process.env.JOB_DISCOVERY_GREENHOUSE_BOARDS = "qualitytest";
  let requests = 0;
  globalThis.fetch = async (input) => {
    requests++;
    const url = String(input);
    if (url.includes("/jobs/")) return new Response(null, { status: 404 });
    if (url.includes("/jobs?")) return Response.json({ jobs: [{ id: 333, title: "Data Analyst", internal_job_id: 1, content: "SQL and Python", location: { name: "Remote" }, absolute_url: "https://job-boards.greenhouse.io/qualitytest/jobs/333", first_published: new Date().toISOString() }] });
    return Response.json({ name: "Quality test" });
  };
  try {
    assert.equal((await getCatalog()).jobs.length, 1);
    assert.equal((await getCatalog()).jobs.length, 1);
    assert.equal(requests, 2);
    assert.equal(await getLiveJob("greenhouse:qualitytest:333"), null);
    assert.equal((await getCatalog()).jobs.length, 0);
    assert.equal(requests, 3);
  } finally {
    globalThis.fetch = originalFetch;
    if (oldBoards === undefined) delete process.env.JOB_DISCOVERY_GREENHOUSE_BOARDS; else process.env.JOB_DISCOVERY_GREENHOUSE_BOARDS = oldBoards;
  }
});

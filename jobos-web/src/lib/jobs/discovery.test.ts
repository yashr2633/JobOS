import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EMPTY_PROFILE, type Job } from "./types.ts";
import { extractSkills, scoreJob } from "./matching.ts";
import { deduplicateJobs, plainText, safeJobUrl } from "./normalize.ts";
import { parseProfile } from "./profile.ts";
import { getLiveJob, greenhouse, normalizeGreenhouse } from "./providers.ts";

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

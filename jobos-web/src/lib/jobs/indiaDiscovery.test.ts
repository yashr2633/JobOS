import test from "node:test";
import assert from "node:assert/strict";
import { includeProfileMatch, matchesDateWindow, matchesIndiaLocation, matchesJobQuery, verificationTime } from "./browsing.ts";
import { normalizeSmartRecruiters, smartrecruiters } from "./smartrecruiters.ts";
import { fetchResumeOptions } from "../resumes/options.ts";
import { getCatalog, JOB_PROVIDERS } from "./providers.ts";
import { completeSnapshot, needsSourceRefresh, publicCatalogForDisplay } from "./catalogPolicy.ts";

const now = "2026-10-26T12:00:00Z";
const raw = (id = "123") => ({ id, name: "Quality Engineer", visibility: "PUBLIC", location: { city: "Tiruppur", country: "in" },
  releasedDate: "2026-10-26T08:00:00Z", typeOfEmployment: { label: "Full-time" }, function: { label: "Quality Assurance" } });

test("verification timestamps have identical text across server/device timezones and day boundaries", () => {
  const before = process.env.TZ;
  try {
    for (const timezone of ["UTC", "Asia/Kolkata", "America/New_York"]) {
      process.env.TZ = timezone;
      assert.equal(verificationTime("2026-10-26T16:10:37Z"), "2026-10-26 21:40 IST");
      assert.equal(verificationTime("2026-10-26T22:30:00Z"), "2026-10-27 04:00 IST");
    }
  } finally { if (before === undefined) delete process.env.TZ; else process.env.TZ = before; }
});

test("general browsing and manual searches are independent of profile match cutoffs", () => {
  const poorMatch = { eligible: false };
  assert.equal(includeProfileMatch(poorMatch, "latest", "", true), true);
  assert.equal(includeProfileMatch(poorMatch, "for-you", "quality", true), true);
  assert.equal(includeProfileMatch(poorMatch, "for-you", "", true), false);
  assert.equal(includeProfileMatch(poorMatch, "saved", "", true), true);
  assert.equal(includeProfileMatch(poorMatch, "for-you", "", false), true);
});

test("role searches do not match substrings such as IT inside security or unrelated boilerplate", () => {
  const job = normalizeSmartRecruiters(raw(), "BoschGroup", "Bosch", now)!;
  assert.equal(matchesJobQuery({ ...job, title: "Technical Architect - IT Service Management", description: "Security guard recruitment" }, "Security Guard"), false);
  assert.equal(matchesJobQuery({ ...job, title: "Life Guard" }, "Security Guard"), false);
  assert.equal(matchesJobQuery({ ...job, title: "Security Guard" }, "Security Guard jobs in India"), true);
  assert.equal(matchesJobQuery({ ...job, title: "Commis I - Tandoor" }, "Security Guard"), false);
  assert.equal(matchesJobQuery({ ...job, title: "Data Analyst", description: "Job Description\nRequired: SQL and Power BI." }, "SQL Power BI"), true);
  assert.equal(matchesJobQuery({ ...job, title: "Customer Success" }, "Data Analyst"), false);
  assert.equal(matchesJobQuery(job, "Eurofins"), false);
  assert.equal(matchesJobQuery(job, "[[]]"), false);
});

test("public India metadata never invents original dates or full resume fit evidence", () => {
  const job = normalizeSmartRecruiters(raw(), "BoschGroup", "Bosch", now)!;
  assert.equal(job.postedAt, null);
  assert.equal(job.releasedAt, "2026-10-26T08:00:00.000Z");
  assert.equal(job.descriptionPending, true);
  assert.equal(job.description, "");
  assert.equal(job.salary, null);
  assert.equal(job.minYearsExperience, null);
  assert.equal(job.expiresAt, null);
  assert.equal(job.category, "Quality Assurance");
  assert.equal(job.applicationUrl, "https://jobs.smartrecruiters.com/BoschGroup/123");
  assert.equal(normalizeSmartRecruiters({ ...raw(), visibility: "INTERNAL" }, "BoschGroup", "Bosch", now), null);
  assert.equal(normalizeSmartRecruiters({ ...raw(), location: { country: "us" } }, "BoschGroup", "Bosch", now), null);
});

test("individual details use official apply URLs and role evidence, excluding company boilerplate", () => {
  const detail = { ...raw(), applyUrl: "https://jobs.smartrecruiters.com/BoschGroup/123-quality?oga=true", jobAd: { sections: {
    companyDescription: { text: "We use Python and SQL" }, jobDescription: { title: "Job Description", text: "<p>Required: laboratory testing. 2 years of experience.</p>" },
  } } };
  const job = normalizeSmartRecruiters(detail, "BoschGroup", "Bosch", now, true)!;
  assert.equal(job.descriptionPending, false);
  assert.equal(job.minYearsExperience, 2);
  assert.ok(!job.description.includes("Python"));
  assert.ok(!job.skills.includes("SQL"));
  for (const applyUrl of ["https://evil.example/123", "https://jobs.smartrecruiters.com/Other/123", "javascript:alert(1)"])
    assert.equal(normalizeSmartRecruiters({ ...detail, applyUrl }, "BoschGroup", "Bosch", now, true), null);
});

test("India browsing includes small cities and excludes foreign or unproven remote locations", () => {
  const job = normalizeSmartRecruiters(raw(), "BoschGroup", "Bosch", now)!;
  assert.equal(matchesIndiaLocation(job, "India"), true);
  assert.equal(matchesIndiaLocation(job, "Tiruppur"), true);
  assert.equal(matchesIndiaLocation(job, "Pan India"), true);
  assert.equal(matchesIndiaLocation(job, "Delhi NCR"), false);
  assert.equal(matchesIndiaLocation({ location: "Gurgaon, India", workMode: null }, "Delhi NCR"), true);
  assert.equal(matchesIndiaLocation({ location: "Remote", workMode: "Remote" }, "India"), false);
  assert.equal(matchesIndiaLocation({ location: "Remote, USA", workMode: "Remote" }, "India"), false);
});

test("date windows retain release provenance, exclude undated/future evidence and allow older active jobs", () => {
  const at = Date.parse(now);
  assert.equal(matchesDateWindow({ postedAt: null, releasedAt: "2026-10-26T08:00:00Z" }, "1", at), true);
  assert.equal(matchesDateWindow({ postedAt: "2026-07-01", releasedAt: "2026-10-26" }, "1", at), false);
  assert.equal(matchesDateWindow({ postedAt: "2026-07-01" }, "180", at), true);
  assert.equal(matchesDateWindow({ postedAt: null }, "1", at), false);
  assert.equal(matchesDateWindow({ postedAt: "2026-10-27" }, "1", at), false);
  assert.equal(matchesDateWindow({ postedAt: "2024-01-01" }, "", at), true);
});

test("public employer feed follows all pages without fetching a detail for every card", async () => {
  const original = globalThis.fetch;
  const urls: URL[] = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input)); urls.push(url);
    const offset = Number(url.searchParams.get("offset"));
    return Response.json({ totalFound: 205, content: Array.from({ length: Math.min(100, 205 - offset) }, (_, i) => raw(String(offset + i + 1))) });
  };
  try {
    const jobs = await smartrecruiters.list("BoschGroup");
    assert.equal(jobs.length, 205);
    assert.equal(new Set(jobs.map(job => job.id)).size, 205);
    assert.deepEqual(urls.map(url => url.searchParams.get("offset")).sort(), ["0", "100", "200"]);
    assert.ok(urls.every(url => url.hostname === "api.smartrecruiters.com" && url.searchParams.get("destination") === "PUBLIC" && url.searchParams.get("country") === "in"));
  } finally { globalThis.fetch = original; }
});

test("truncated or unbounded employer pages fail explicitly instead of looking complete", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ totalFound: 3001, content: [] });
    await assert.rejects(smartrecruiters.list("BoschGroup"), /pagination bounds/);
    globalThis.fetch = async () => Response.json({ totalFound: 2, content: [raw()] });
    await assert.rejects(smartrecruiters.list("BoschGroup"), /Incomplete/);
    globalThis.fetch = async () => new Response(null, { status: 410 });
    assert.equal(await smartrecruiters.get("BoschGroup", "123"), null);
    await assert.rejects(smartrecruiters.get("UnconfiguredCompany", "123"), /Unknown/);
  } finally { globalThis.fetch = original; }
});

test("normal closures and new postings during pagination do not discard a whole employer feed", async () => {
  const original = globalThis.fetch;
  try {
    for (const laterTotal of [204, 305]) {
      const offsets: number[] = [];
      globalThis.fetch = async input => {
        const offset = Number(new URL(String(input)).searchParams.get("offset")); offsets.push(offset);
        const total = offset === 0 ? 205 : laterTotal;
        return Response.json({ totalFound: total, content: Array.from({ length: Math.max(0, Math.min(100, total - offset)) }, (_, i) => raw(String(offset + i + 1))) });
      };
      const jobs = await smartrecruiters.list("BoschGroup");
      assert.equal(jobs.length, laterTotal);
      assert.equal(new Set(jobs.map(job => job.id)).size, laterTotal);
      if (laterTotal === 305) assert.ok(offsets.includes(300), "follow a newly observed last page");
    }
  } finally { globalThis.fetch = original; }
});

test("transient rate limits get one bounded retry and long Retry-After is respected", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => ++calls === 1 ? new Response(null, { status: 429, headers: { "Retry-After": "0" } })
      : Response.json({ totalFound: 1, content: [raw()] });
    assert.equal((await smartrecruiters.list("BoschGroup")).length, 1);
    assert.equal(calls, 2);
    calls = 0;
    globalThis.fetch = async () => { calls++; return new Response(null, { status: 429, headers: { "Retry-After": "60" } }); };
    await assert.rejects(smartrecruiters.list("BoschGroup"), /429/);
    assert.equal(calls, 1);
    calls = 0;
    globalThis.fetch = async () => { calls++; return new Response(null, { status: 429, headers: { "Retry-After": new Date(Date.now() + 60_000).toUTCString() } }); };
    await assert.rejects(smartrecruiters.list("BoschGroup"), /429/);
    assert.equal(calls, 1, "an HTTP-date Retry-After must not be retried early either");
  } finally { globalThis.fetch = original; }
});

test("partial outages cannot replace a healthy snapshot or reset verification/publication dates", () => {
  const snapshot = { jobs: [normalizeSmartRecruiters(raw(), "BoschGroup", "Bosch", now)!], warnings: [] as string[], checkedAt: now,
    sources: [{ provider: "smartrecruiters", board: "BoschGroup", status: "ok" as const, checkedAt: now, jobs: 1 }] };
  const before = JSON.stringify(snapshot), at = Date.parse(now);
  assert.equal(completeSnapshot(snapshot), true);
  assert.equal(completeSnapshot({ ...snapshot, warnings: ["Some sources unavailable"] }), false);
  assert.equal(completeSnapshot({ ...snapshot, sources: [{ ...snapshot.sources[0], status: "failed" }] }), false);
  const older = publicCatalogForDisplay(snapshot, at + 7 * 60_000);
  assert.equal(older.jobs.length, 1);
  assert.equal(older.jobs[0].fetchedAt, now);
  assert.equal(older.jobs[0].postedAt, null);
  assert.equal(older.jobs[0].releasedAt, snapshot.jobs[0].releasedAt);
  assert.ok(older.warnings.some(message => /previously checked/i.test(message)));
  assert.equal(needsSourceRefresh(snapshot, at + 7 * 60_000), false);
  assert.equal(needsSourceRefresh(snapshot, at + 21 * 60_000), true);
  assert.equal(publicCatalogForDisplay(snapshot, at + 21 * 60_000).jobs.length, 0);
  assert.equal(JSON.stringify(snapshot), before);
});

test("Resume Match dropdown reads only IDs and labels, retaining default-first order", async () => {
  const calls: unknown[] = [];
  const query = { select: (fields: string) => { calls.push(fields); return query; },
    order: (field: string, options: unknown) => { calls.push([field, options]); return query; },
    then: (resolve: (data: unknown) => unknown) => resolve({ data: [{ id: "resume1", label: "My resume" }], error: null }) };
  const client = { from: (table: string) => { assert.equal(table, "resumes"); return query; } } as unknown as Parameters<typeof fetchResumeOptions>[0];
  assert.deepEqual(await fetchResumeOptions(client), [{ id: "resume1", label: "My resume" }]);
  assert.deepEqual(calls, ["id,label", ["is_default", { ascending: false }], ["created_at", { ascending: false }]]);
});

test("a failed employer is reported even when other sources succeed; total failure stays explicit", async () => {
  const keys = ["JOB_DISCOVERY_GREENHOUSE_BOARDS", "JOB_DISCOVERY_LEVER_BOARDS", "JOB_DISCOVERY_ASHBY_BOARDS", "JOB_DISCOVERY_SMARTRECRUITERS_BOARDS"];
  const before = keys.map(key => process.env[key]);
  const originalList = JOB_PROVIDERS.smartrecruiters.list;
  try {
    for (const key of keys) process.env[key] = "";
    process.env.JOB_DISCOVERY_SMARTRECRUITERS_BOARDS = "SGS,BoschGroup";
    JOB_PROVIDERS.smartrecruiters.list = async board => {
      if (board === "SGS") throw new Error("Fixture provider outage");
      return [normalizeSmartRecruiters(raw(), board, "Bosch", new Date().toISOString())!];
    };
    const partial = await getCatalog();
    assert.equal(partial.jobs.length, 1);
    assert.ok(partial.warnings.some(message => /incomplete/i.test(message)));
    assert.deepEqual(partial.sources?.map(source => [source.board, source.status]), [["SGS", "failed"], ["BoschGroup", "ok"]]);
    process.env.JOB_DISCOVERY_SMARTRECRUITERS_BOARDS = "SGS";
    const failed = await getCatalog();
    assert.equal(failed.jobs.length, 0);
    assert.ok(failed.warnings.some(message => /temporarily unavailable/i.test(message)));
  } finally {
    JOB_PROVIDERS.smartrecruiters.list = originalList;
    keys.forEach((key, index) => { if (before[index] === undefined) delete process.env[key]; else process.env[key] = before[index]; });
  }
});

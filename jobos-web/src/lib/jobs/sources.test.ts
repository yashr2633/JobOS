import test from "node:test";
import assert from "node:assert/strict";
import { additionalSources, normalizeAts, lever, ashby } from "./ats.ts";
import { deduplicateJobs } from "./normalize.ts";
import { getLiveJob } from "./providers.ts";
const checked = new Date().toISOString();
const leverSource = additionalSources().find((s) => s.provider === "lever")!;
const ashbySource = additionalSources().find((s) => s.provider === "ashby")!;
test("Lever preserves original apply URL, full descriptions and explicit locations", () => {
  const apply = `https://jobs.lever.co/${leverSource.board}/test-id/apply?source=original#form`;
  const job = normalizeAts({ id: "test-id", text: "Analyst", applyUrl: apply, hostedUrl: `https://jobs.lever.co/${leverSource.board}/test-id`, categories: { location: "Bangalore", allLocations: ["Bangalore", "Pan India"], commitment: "Full-time" }, country: "IN", workplaceType: "hybrid", descriptionPlain: "SQL and Excel", lists: [{ text: "Requirements", content: "<p>3 years experience</p>" }], createdAt: 1700000000000 }, leverSource, checked)!;
  assert.equal(job.applicationUrl, apply);
  assert.match(job.location, /Bengaluru.*Pan India.*India/);
  assert.equal(job.workMode, "Hybrid");
  assert.match(job.description, /Requirements/);
  assert.equal(job.availability, "listed");
  assert.equal(deduplicateJobs([job, { ...job, id: "copy", applicationUrl: apply.replace("original", "duplicate") }]).length, 1);
});
test("Ashby excludes unlisted entries and keeps unknown dates/locations unknown", () => {
  const raw = { id: "test-id", title: "Engineer", isListed: true, applyUrl: `https://jobs.ashbyhq.com/${ashbySource.board}/test-id/application`, jobUrl: `https://jobs.ashbyhq.com/${ashbySource.board}/test-id`, descriptionPlain: "Python", workplaceType: "Remote" };
  const job = normalizeAts(raw, ashbySource, checked)!;
  assert.equal(job.applicationUrl, raw.applyUrl);
  assert.equal(job.location, ""); assert.equal(job.postedAt, null);
  assert.equal(normalizeAts({ ...raw, isListed: false }, ashbySource, checked), null);
  assert.equal(normalizeAts({ ...raw, applyUrl: "https://attacker.example/application" }, ashbySource, checked), null);
});
test("unconfigured boards and traversal IDs cannot make requests", async () => {
  assert.equal(await getLiveJob("lever:unconfigured:123"), null);
  assert.equal(await getLiveJob("ashby:ashby:../other"), null);
});
test("real Lever and Ashby list/detail retrieval", { skip: process.env.JOB_DISCOVERY_LIVE_TEST !== "1" }, async () => {
  for (const provider of [lever, ashby]) {
    const source = provider === lever ? leverSource : ashbySource;
    const jobs = await provider.list(source.board);
    assert.ok(jobs.length > 0);
    assert.ok(jobs.every((j) => j.title && j.description && j.applicationUrl.startsWith(source.boardUrl + "/")));
    const live = await getLiveJob(jobs[0].id);
    assert.equal(live?.applicationUrl, jobs[0].applicationUrl);
    console.log(`${provider.source}: ${jobs.length} real jobs; original apply URL verified`);
  }
});

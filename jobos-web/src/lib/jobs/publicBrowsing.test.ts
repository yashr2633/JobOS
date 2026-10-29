import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PUBLIC_FILTERS, publicJobFilters, publicJobPage } from "./publicBrowsing.ts";
import type { Job } from "./types.ts";
const now = Date.parse("2026-10-30T08:00:00Z");
function job(overrides: Partial<Job> = {}): Job { return { id: "one", source: "Greenhouse", board: "example", externalId: "1", company: "Example Co", title: "Sales Executive", description: "Business sales role.", requirements: [], location: "Bangalore, Karnataka, India", workMode: "On-site", minYearsExperience: 0, skills: ["Sales"], salary: null, employmentType: "Full Time", postedAt: "2026-10-29T08:00:00Z", expiresAt: null, updatedAt: null, fetchedAt: new Date(now).toISOString(), applicationUrl: "https://example.com/jobs/one", sourceUrl: "https://example.com/jobs/one", availability: "listed", ...overrides }; }
test("public search validates short preferences and rejects private-data-like query values", () => {
  for (const text of ["q=person%40example.com", "q=%3Cscript%3E", "location=https://example.com", "days=forever", "salary=-1", "experience=999"]) assert.equal(publicJobFilters(new URLSearchParams(text)), null);
  assert.equal(publicJobFilters(new URLSearchParams("q=Sales&location=Dhanbad"))?.location, "Dhanbad");
});
test("original-posting filters never relabel an old or unknown posting as new", () => {
  const filters = { ...DEFAULT_PUBLIC_FILTERS, days: "7" };
  assert.equal(publicJobPage([job({ postedAt: null, updatedAt: new Date(now).toISOString() })], filters, 0, now).total, 0);
  assert.equal(publicJobPage([job({ postedAt: "2024-01-01", updatedAt: new Date(now).toISOString() })], filters, 0, now).total, 0);
  assert.equal(publicJobPage([job()], filters, 0, now).total, 1);
});
test("public cards exclude closed, expired, foreign and unsafe application destinations", () => {
  for (const override of [{ availability: "closed" as const }, { expiresAt: "2026-10-01" }, { location: "New York, United States", workMode: "Remote" as const }, { applicationUrl: "javascript:alert(1)" }]) assert.equal(publicJobPage([job(override)], DEFAULT_PUBLIC_FILTERS, 0, now).total, 0);
});
test("fresher and salary filters require source evidence instead of inventing eligibility", () => {
  assert.equal(publicJobPage([job({ minYearsExperience: null })], { ...DEFAULT_PUBLIC_FILTERS, experience: "entry" }, 0, now).total, 0);
  assert.equal(publicJobPage([job({ salary: { min: 30000, max: 40000, currency: "INR", period: "month" } })], { ...DEFAULT_PUBLIC_FILTERS, salary: "300000" }, 0, now).total, 1);
  assert.equal(publicJobPage([job()], { ...DEFAULT_PUBLIC_FILTERS, salary: "300000" }, 0, now).total, 0);
});
test("pagination has no duplicates, and the public projection strips accidental private fields", () => {
  const source = Array.from({ length: 42 }, (_, index) => job({ id: `job-${index}`, title: `Sales Executive ${index}`, externalId: String(index), applicationUrl: `https://example.com/jobs/${index}`, sourceUrl: `https://example.com/jobs/${index}` }));
  Object.assign(source[0], { resumeText: "PRIVATE", user_id: "PRIVATE", token: "PRIVATE" });
  const a = publicJobPage(source, DEFAULT_PUBLIC_FILTERS, 0, now), b = publicJobPage(source, DEFAULT_PUBLIC_FILTERS, 20, now), c = publicJobPage(source, DEFAULT_PUBLIC_FILTERS, 40, now);
  assert.equal(a.total, 42); assert.equal(a.jobs.length, 20); assert.equal(c.jobs.length, 2); assert.equal(c.nextOffset, null);
  assert.equal(new Set([...a.jobs, ...b.jobs, ...c.jobs].map(job => job.id)).size, 42);
  assert.doesNotMatch(JSON.stringify(a), /PRIVATE|resumeText|user_id|token/);
});

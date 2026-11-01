import test from "node:test";
import assert from "node:assert/strict";
import type { Job } from "../jobs/types.ts";
import { isPublicOpportunity, jobPosting, opportunityPath, opportunityId, opportunitySitemap, safeJsonLd } from "./jobs.ts";
import { homepageMetadata } from "./metadata.ts";
import nextConfig from "../../../next.config.ts";

const now = Date.parse("2026-11-01T08:00:00Z");
test("encoded page and decoded metadata params resolve the same safe source ID", () => {
  const id = "greenhouse:example:123";
  assert.equal(opportunityId(id), id);
  assert.equal(opportunityId(encodeURIComponent(id)), id);
  for (const invalid of [encodeURIComponent(encodeURIComponent(id)), "%ZZ", "https://example.com", "../private", "greenhouse:example:123/secret", "himalayas:india:123"]) assert.equal(opportunityId(invalid), null);
});
test("ATS description stubs remain discoverable while incomplete rich data and URL-dependent remote IDs are excluded", () => {
  const stub = job({ id: "smartrecruiters:ServiceNow:123", source: "SmartRecruiters", board: "ServiceNow", description: "", descriptionPending: true, postedAt: null });
  assert.equal(opportunitySitemap([stub], now).length, 1);
  assert.equal(jobPosting(stub, now), null);
  assert.equal(opportunitySitemap([job({ id: "himalayas:india:123", source: "Himalayas" })], now).length, 0);
});
function job(overrides: Partial<Job> = {}): Job {
  return { id: "greenhouse:example:123", source: "Greenhouse", board: "example", externalId: "123", company: "Example", title: "Analyst", description: "Responsibilities include analysing sales data and preparing accurate reports. Requirements include SQL, spreadsheet analysis and clear communication with stakeholders. Please review the full employer requirements before applying.", requirements: [], location: "Bengaluru, India", workMode: "On-site", minYearsExperience: 0, skills: [], salary: null, employmentType: "Full Time", postedAt: "2026-10-30T10:00:00Z", expiresAt: null, updatedAt: null, fetchedAt: new Date(now).toISOString(), applicationUrl: "https://example.com/jobs/123", sourceUrl: "https://example.com/jobs", availability: "listed", ...overrides };
}
test("sitemap and detail eligibility reject closed, expired, stale, foreign and incomplete jobs", () => {
  assert.ok(isPublicOpportunity(job(), now));
  for (const value of [{ availability: "closed" as const }, { expiresAt: "2026-10-31" }, { fetchedAt: "2026-10-30" }, { location: "New York, USA" }, { descriptionPending: true }, { description: "Short stub" }, { applicationUrl: "javascript:alert(1)" }, { id: "https://private.example" }]) {
    assert.equal(isPublicOpportunity(job(value), now), false, JSON.stringify(value));
    assert.equal(jobPosting(job(value), now), null);
  }
  assert.equal(opportunitySitemap([job(), job(), job({ availability: "closed" })], now).length, 1);
});
test("unknown posting dates remain unknown and never turn source checks into publication dates", () => {
  const unknown = job({ postedAt: null, releasedAt: new Date(now).toISOString() });
  assert.ok(isPublicOpportunity(unknown, now));
  assert.equal(jobPosting(unknown, now), null);
  assert.equal(jobPosting(job({ postedAt: "2026-11-02" }), now), null);
  const schema = jobPosting(job(), now)!;
  assert.equal(schema.datePosted, "2026-10-30T10:00:00.000Z");
  assert.equal(schema.hiringOrganization.name, "Example");
  assert.equal(schema.directApply, false);
  assert.ok(!("baseSalary" in schema));
  assert.ok(!("validThrough" in schema));
  assert.equal(schema.url, `https://www.jobtrackos.online${opportunityPath(job().id)}`);
});
test("structured descriptions preserve visible source facts and prevent script termination", () => {
  const schema = jobPosting(job({ description: job().description + '<script>alert(1)</script><p>Research &amp; reporting</p>' }), now)!;
  assert.ok(schema.description.includes("Research &amp; reporting"));
  assert.ok(!schema.description.includes("alert(1)"));
  assert.ok(!safeJsonLd({ text: "</script><script>alert(1)</script>" }).includes("<"));
  const remote = jobPosting(job({ workMode: "Remote", location: "Remote, India" }), now)!;
  assert.ok("jobLocationType" in remote);
  assert.equal(remote.jobLocationType, "TELECOMMUTE");
});
test("personal homepage searches are excluded while ordinary campaign attribution remains canonical", () => {
  assert.deepEqual(homepageMetadata([], { q: "Analyst" }).robots, { index: false, follow: true });
  assert.deepEqual(homepageMetadata([], { utm_source: "linkedin" }).robots, { index: true, follow: true });
});
test("SEO routing leaves OAuth/APIs/private workspaces protected and consolidates only public old-host URLs", async () => {
  const headers = await nextConfig.headers!();
  assert.ok(!headers.some(rule => rule.source === "/jobs/:path*"));
  for (const path of ["api", "auth", "applications", "jobs/internal", "jobs/applied", "resume-builder", "cover-letter"]) {
    assert.ok(headers.some(rule => rule.source === `/${path}/:path*` && rule.headers.some(header => header.key === "X-Robots-Tag" && header.value.includes("noindex"))));
  }
  const redirects = await nextConfig.redirects!();
  assert.ok(redirects.length);
  for (const rule of redirects) {
    assert.ok(!/^\/(api|auth|resumes|applications|employer)/.test(rule.source));
    assert.ok(rule.has?.some(item => item.type === "host" && item.value === "jobtrackos.vercel.app"));
    assert.ok(rule.missing?.some(item => item.type === "query" && item.key === "code"));
    assert.ok(rule.missing?.some(item => item.type === "header" && item.key === "cookie"));
  }
});

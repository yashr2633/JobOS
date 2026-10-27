import test from "node:test";
import assert from "node:assert/strict";
import { graduateSearch, quickCareerReply, validateCareerReply } from "./careerReply.ts";
import { EMPTY_INTENT } from "./careerIntent.ts";
import { assistantContext, assistantJobs, assistantPage, careerPublicKeywords, careerRoleSuggestions } from "./assistantSearch.ts";
import type { Job } from "./types.ts";
import { searchRetrySeconds, searchQuotaMessage } from "./searchQuota.ts";
const now = Date.parse("2026-10-27T10:00:00Z");
const job = (id: string, patch: Partial<Job> = {}): Job => ({ id, source: "Greenhouse", board: "example", externalId: id, company: "Example " + id, title: "Sales Executive", description: "Customer communication and Excel required.", requirements: [], location: "Kolkata, West Bengal, India", workMode: null, minYearsExperience: 0, skills: ["Excel"], salary: null, employmentType: "Full time", postedAt: "2026-10-26T00:00:00Z", expiresAt: null, updatedAt: null, fetchedAt: "2026-10-27T09:59:00Z", applicationUrl: "https://example.com/jobs/" + id, sourceUrl: "https://example.com/careers", availability: "listed", ...patch });
test("approved BBA Kolkata requests start searching without a mandatory role question", () => {
  for (const text of ["BBA fresher in Kolkata", "I'm a BBA fresher. Find jobs in Kolkata.", "BBA fresher Kolkata"]) {
    const reply = quickCareerReply(text);
    assert.equal(reply?.kind, "search", text);
    if (reply?.kind !== "search") throw new Error("Expected search");
    assert.equal(reply.intent.role, ""); assert.equal(reply.intent.experience, "entry"); assert.equal(reply.intent.location, "Kolkata, West Bengal"); assert.equal(reply.intent.qualification, "BBA");
    assert.equal(validateCareerReply(reply)?.kind, "search");
  }
  assert.equal(graduateSearch("BBF Racer"), null);
  assert.equal(graduateSearch("BBA fresher in London"), null);
  assert.equal(graduateSearch("BBA fresher in NotARealCity"), null);
});
test("broad fresher results retain real filters and do not treat unknown senior experience as entry level", () => {
  const intent = graduateSearch("BBA fresher Kolkata")!;
  const examples = [job("entry"), job("senior", { title: "Senior Sales Executive", minYearsExperience: null }), job("foreign", { location: "London, United Kingdom" }), job("othercity", { location: "Bengaluru, Karnataka, India" }), job("engineering", { title: "Software Engineer" }), job("old", { postedAt: "2024-01-01T00:00:00Z" }), job("closed", { availability: "closed" }), job("expired", { expiresAt: "2026-10-26T00:00:00Z" }), job("unknown", { minYearsExperience: null })];
  assert.deepEqual(assistantJobs(examples, intent, now).map(item => item.id), ["entry", "unknown"]);
  assert.equal(assistantJobs([job("old", { postedAt: "2024-01-01T00:00:00Z" })], { ...intent, days: "" }, now).length, 1, "old does not automatically mean closed when the source still lists it");
});
test("show more advances through actual unique results and ends without invented counts", () => {
  const input = Array.from({ length: 23 }, (_, index) => job(String(index)));
  const results = assistantJobs([...input, input[0]], { ...EMPTY_INTENT }, now);
  assert.equal(results.length, 23);
  const first = assistantPage(results, 0), second = assistantPage(results, first.nextOffset!), last = assistantPage(results, second.nextOffset!);
  assert.equal(first.total, 23); assert.equal(first.jobs.length, 9); assert.equal(second.jobs.length, 9); assert.equal(last.jobs.length, 5); assert.equal(last.nextOffset, null);
  assert.equal(new Set([...first.jobs, ...second.jobs, ...last.jobs].map(item => item.id)).size, 23);
});
test("city-specific results precede India-eligible remote results and a technical-support title is not a business graduate recommendation", () => {
  const intent = graduateSearch("BBA fresher Kolkata")!;
  const local = job("local"), remote = job("remote", { location: "India", remoteIndiaEligible: true, workMode: "Remote", postedAt: "2026-10-27T09:00:00Z" });
  assert.deepEqual(assistantJobs([remote, local, job("technical", { title: "Automation Engineer - Technical Support" })], intent, now).map(item => item.id), ["local", "remote"]);
});
test("external search gets public intent and context, never a resume or hiring probability", () => {
  const intent = { ...EMPTY_INTENT, company: "Deloitte", role: "Analyst", location: "Hyderabad, Telangana", experience: "entry", qualification: "BBA" };
  const query = careerPublicKeywords(intent);
  assert.match(query, /jobs at employer Deloitte/); assert.match(query, /Analyst/); assert.match(query, /entry level/);
  assert.ok(query.length <= 120); assert.match(assistantContext(intent), /Hyderabad/); assert.match(assistantContext(intent), /BBA/);
  assert.deepEqual(careerRoleSuggestions(intent), ["Sales Executive", "Operations Associate", "Customer Support", "HR Executive"]);
  assert.equal(validateCareerReply({ kind: "search", intent: { ...intent, qualification: "InventedPhD" } }), null);
});
test("provider daily-quota delays are bounded and reported without exposing provider identifiers", () => {
  const value = { error: { details: [{ retryDelay: "56614s", project: "private-project-id" }] } };
  assert.equal(searchRetrySeconds(value), 56614);
  assert.match(searchQuotaMessage(searchRetrySeconds(value)), /16 hours/);
  assert.ok(!searchQuotaMessage(searchRetrySeconds(value)).includes("private-project-id"));
  for (const delay of ["-1s", "NaNs", "<script>", "0s"]) assert.equal(searchRetrySeconds({ error: { details: [{ retryDelay: delay }] } }), 60);
  assert.equal(searchRetrySeconds({ error: { details: [{ retryDelay: "99999999s" }] } }), 86400);
  assert.equal(searchRetrySeconds(null), 60);
});

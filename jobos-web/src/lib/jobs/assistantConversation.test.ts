import test from "node:test";
import assert from "node:assert/strict";
import { graduateSearch, quickCareerReply, validateCareerReply } from "./careerReply.ts";
import { EMPTY_INTENT } from "./careerIntent.ts";
import { assistantContext, assistantJobs, assistantPage, assistantRegionalJobs, careerPublicKeywords, careerRoleSuggestions } from "./assistantSearch.ts";
import { resolveLocation } from "./locations.ts";
import type { Job } from "./types.ts";
import { searchRetrySeconds, searchQuotaMessage } from "./searchQuota.ts";
import { enrichJob } from "./normalize.ts";
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

test("same-city spelling variants resolve once, and normal role/city searches never require a model", () => {
  for (const text of ["Bokaro", "Bokāro", "Bokaro Steel City", "बोकारो"]) assert.equal(resolveLocation(text)?.label, "Bokaro, Jharkhand");
  for (const text of ["BBA fresher jobs in Bokaro", "BBA fresher jobs in Bokaro in India", "BBA fresher in बोकारो", "BBA fresher Bokaro Steel City"]) {
    const reply = quickCareerReply(text);
    assert.equal(reply?.kind, "search", text);
    if (reply?.kind !== "search") throw new Error("Expected local interpretation");
    assert.equal(reply.intent.location, "Bokaro, Jharkhand"); assert.equal(reply.intent.qualification, "BBA"); assert.equal(reply.intent.experience, "entry"); assert.equal(reply.intent.role, "");
    assert.equal(validateCareerReply(reply)?.kind, "search");
  }
  for (const [request, role, city, employer] of [
    ["Sales Executive jobs in Kolkata", "Sales Executive", "Kolkata, West Bengal", ""],
    ["Data Analyst in Bengaluru", "Data Analyst", "Bengaluru, Karnataka", ""],
    ["Find Deloitte analyst jobs in Hyderabad", "analyst", "Hyderabad, Telangana", "Deloitte"],
    ["electrician jobs in Dhanbad", "Electrician", "Dhanbad, Jharkhand", ""],
    ["customer support jobs remote in India", "customer support", "India", ""],
    ["Give me 10 jobs in Bokaro", "jobs", "Bokaro, Jharkhand", ""],
    ["Find jobs across India", "jobs", "India", ""],
  ]) {
    const reply = quickCareerReply(request);
    assert.equal(reply?.kind, "search", request);
    if (reply?.kind !== "search") throw new Error("Expected search");
    assert.equal(reply.intent.role, role); assert.equal(reply.intent.location, city); assert.equal(reply.intent.company, employer);
  }
});

test("offline follow-ups preserve the actual earlier filters and explicitly broaden only on request", () => {
  const base = { ...EMPTY_INTENT, location: "Bokaro, Jharkhand", experience: "entry", qualification: "BBA", days: "7" };
  const follow = quickCareerReply("Only sales roles", assistantContext(base));
  assert.equal(follow?.kind, "search");
  if (follow?.kind !== "search") throw new Error("Expected contextual search");
  assert.equal(follow.intent.location, base.location); assert.equal(follow.intent.experience, "entry"); assert.equal(follow.intent.qualification, "BBA"); assert.equal(follow.intent.days, "7"); assert.equal(follow.intent.role, "sales");
  const nationwide = quickCareerReply("Show sales jobs across India", assistantContext(base));
  assert.equal(nationwide?.kind === "search" && nationwide.intent.location, "India");
  for (const request of ["BBA fresher in London", "BBA fresher in NotARealCity", "sales jobs in Kolkata or Mumbai", "why is my match score low", "contact me at test@example.com"]) assert.equal(quickCareerReply(request), null, request);
  assert.equal(quickCareerReply("BBF Racer")?.kind, "clarify");
  const clarified = quickCareerReply("Fresher jobs", "BBF Racer");
  assert.equal(clarified?.kind === "search" && clarified.intent.experience, "entry");
  const clarifiedRole = quickCareerReply("Sales Executive", "BBF Racer");
  assert.equal(clarifiedRole?.kind === "search" && clarifiedRole.intent.role, "Sales Executive");
});

test("regional alternatives retain relevance and never pretend to be exact-city or remote jobs", () => {
  const intent = { ...EMPTY_INTENT, location: "Bokaro, Jharkhand", experience: "entry", qualification: "BBA" };
  const inventory = [job("local", { location: "Bokaro, Jharkhand, India" }), job("regional", { location: "Dhanbad, Jharkhand, India" }), job("remote", { location: "India", remoteIndiaEligible: true, workMode: "Remote" }), job("otherstate"), job("senior", { location: "Ranchi, Jharkhand, India", minYearsExperience: 5 }), job("closed", { location: "Dhanbad, Jharkhand, India", availability: "closed" })];
  assert.deepEqual(assistantJobs(inventory, intent, now).map(value => value.id), ["local", "remote"]);
  const region = assistantRegionalJobs(inventory, intent, now)!;
  assert.equal(region.location, "Jharkhand"); assert.deepEqual(region.jobs.map(value => value.id), ["regional"]);
  assert.equal(assistantRegionalJobs(inventory, { ...intent, location: "India" }, now), null);
});

test("customer-support role requests do not return unrelated engineering roles from incidental description text", () => {
  const intent = { ...EMPTY_INTENT, role: "customer support", location: "India", experience: "entry", qualification: "BBA" };
  const input = [job("support", { title: "Customer Support Agent" }), job("engineer", { title: "Automation Engineer 1 - Technical Support", description: "Works with customer support teams." }), job("consultant", { title: "Executive VIP Consultant", description: "Customer support and client services." })];
  assert.deepEqual(assistantJobs(input, intent, now).map(value => value.id), ["support"]);
});

test("explicit discipline-specific experience is not labelled unknown or recommended as fresher", () => {
  const intent = { ...EMPTY_INTENT, role: "customer support", location: "India", experience: "entry" };
  for (const requirement of ["2+ years of customer support experience", "3 years of relevant sales experience", "5 - 7 years of software development experience", "2 + years of professional industry experience"]) {
    const normalized = enrichJob(job("experienced", { title: "Customer Support Agent", minYearsExperience: null, description: "Requirements\n" + requirement }));
    assert.ok(normalized.minYearsExperience! >= 2, requirement);
    assert.equal(assistantJobs([normalized], intent, now).length, 0);
  }
  assert.equal(enrichJob(job("unstated", { minYearsExperience: null, description: "Requirements\nCustomer support and Excel skills." })).minYearsExperience, null);
  assert.equal(enrichJob(job("company", { minYearsExperience: null, description: "Our company has 20 years of combined experience." })).minYearsExperience, null);
  const graduate = enrichJob(job("entry", { minYearsExperience: null, description: "Requirements\n0-1 years of customer support experience" }));
  assert.equal(graduate.minYearsExperience, 0);
});

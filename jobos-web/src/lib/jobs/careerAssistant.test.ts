import test from "node:test";
import assert from "node:assert/strict";
import { companySuggestions, matchesCompany, findCompany } from "./companies.ts";
import { careerSearchUrl, EMPTY_INTENT, experienceMatches, publicCareerMessage, validateCareerIntent } from "./careerIntent.ts";
import { readJobFilters } from "./searchFilters.ts";
import { mergeEmployerSnapshots } from "./employerCatalog.ts";
import { normalizeSmartRecruiters } from "./smartrecruiters.ts";
test("company vocabulary survives empty feeds, supports aliases, and does not pretend import coverage", () => {
  assert.ok(companySuggestions("Info").some(company => company.name === "Infosys"));
  assert.equal(companySuggestions("AWS")[0].name, "Amazon");
  assert.equal(companySuggestions("Tata Consultancy")[0].name, "TCS");
  assert.equal(findCompany("Google")?.connected, false);
  assert.equal(findCompany("ServiceNow")?.connected, true);
  assert.equal(companySuggestions("New local employer", ["New local employer"])[0].name, "New local employer");
  assert.equal(matchesCompany("Infosys Limited", "Infosys"), true);
  assert.equal(matchesCompany("Amazon Development Centre India", "AWS"), true);
  assert.equal(matchesCompany("Other Company", "Infosys"), false);
});
test("public intent accepts Hindi search preferences but blocks contact details and unbounded input", () => {
  assert.equal(publicCareerMessage("मुझे कोलकाता में analyst jobs चाहिए"), true);
  for (const value of ["me@example.com analyst", "call 9999999999", "https://internal/jobs", "x".repeat(401), { role: "analyst" }]) assert.equal(publicCareerMessage(value), false);
});
test("AI intent is schema checked and cannot introduce links, foreign locations or invented filter enums", () => {
  const good = { ...EMPTY_INTENT, role: "Data Analyst", location: "Kolkata", experience: "entry" };
  assert.match(validateCareerIntent(good)!.location, /Kolkata/);
  for (const patch of [{ role: "https://internal" }, { location: "London" }, { experience: "expert" }, { days: "forever" }, { company: "a@b.com" }]) assert.equal(validateCareerIntent({ ...good, ...patch }), null);
});
test("guided choices survive the real search URL, including all-date and owner-checked resume identifiers", () => {
  const intent = { ...EMPTY_INTENT, role: "Data Analyst", company: "Infosys", location: "Dhanbad, Jharkhand", experience: "entry", mode: "Remote", days: "" };
  const url = new URL(careerSearchUrl(intent, "a7bbc03b-1111-2222-3333-123456789abc"), "https://example.com");
  const result = readJobFilters(Object.fromEntries(url.searchParams));
  assert.equal(result.company, "Infosys"); assert.equal(result.days, ""); assert.equal(result.experience, "entry"); assert.equal(result.mode, "Remote"); assert.equal(result.assistant, true);
  assert.equal(new URL(careerSearchUrl(intent, "../../not-a-resume"), "https://example.com").searchParams.has("resume"), false);
  assert.equal(readJobFilters({ q: ["analyst"], company: "x@y.com", assistant: "1", days: "-5" }).assistant, false);
});
test("unknown experience stays unknown rather than silently deleting all metadata-only employer jobs", () => {
  assert.equal(experienceMatches(null, "entry"), true); assert.equal(experienceMatches(3, "entry"), false);
  assert.equal(experienceMatches(1, "3"), true); assert.equal(experienceMatches(5, "3"), false);
  assert.equal(experienceMatches(null, "unknown"), true); assert.equal(experienceMatches(0, "unknown"), false);
});
test("a failed or expired employer cannot blank the other live source snapshots or freshen old timestamps", () => {
  const now = Date.parse("2026-10-27T03:00:00Z"), checkedAt = "2026-10-27T02:58:00Z";
  const job = normalizeSmartRecruiters({ id: "123", name: "Analyst", visibility: "PUBLIC", location: { city: "Dhanbad", country: "in" } }, "SGS", "SGS", checkedAt)!;
  const sources = [{ provider: "smartrecruiters", board: "SGS" }, { provider: "smartrecruiters", board: "BoschGroup" }];
  const good = { status: "fulfilled" as const, value: { jobs: [job], checkedAt } };
  const catalog = mergeEmployerSnapshots(sources, [good, { status: "rejected", reason: new Error("429") }], now);
  assert.equal(catalog.jobs.length, 1); assert.equal(catalog.jobs[0].fetchedAt, checkedAt); assert.equal(catalog.sources?.[1].reason, "rate-limited");
  const expired = mergeEmployerSnapshots(sources, [good, { status: "fulfilled", value: { jobs: [{ ...job, id: "old" }], checkedAt: "2026-10-26T03:00:00Z" } }], now);
  assert.deepEqual(expired.jobs.map(value => value.id), [job.id]); assert.equal(expired.sources?.[1].status, "failed");
});

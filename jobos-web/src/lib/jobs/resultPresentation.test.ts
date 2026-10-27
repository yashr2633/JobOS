import test from "node:test";
import assert from "node:assert/strict";
import { postingLabel, educationCheck } from "./resultPresentation.ts";
import { recoverCareerReply, quickCareerReply, resumeCareerReply } from "./careerReply.ts";
import { assistantContext } from "./assistantSearch.ts";
import { EMPTY_INTENT } from "./careerIntent.ts";
import type { Job } from "./types.ts";
import type { ResumeEvidence } from "./types.ts";
import { availableAssistantCatalogs } from "./assistantCatalog.ts";
import type { Catalog } from "./providers.ts";
import { validWebSearchNotice } from "./webSearchContract.ts";

test("an unsupported grounded answer has a distinct safe outcome rather than a hosting/parser error", () => {
  const notice = { outcome: "no_supported_leads", message: "Additional leads could not be supported. Connected listings remain available.", searchedAt: "2026-10-28T00:00:00Z" };
  assert.equal(validWebSearchNotice(notice), true);
  assert.equal(validWebSearchNotice({ ...notice, message: "<script>error</script>" }), false);
  assert.equal(validWebSearchNotice({ ...notice, searchedAt: "not-a-date" }), false);
  assert.equal(validWebSearchNotice({ error: "An error occurred" }), false);
});

test("all-source outages are not successful empty searches; one healthy source survives a partial failure", () => {
  const failed: Catalog = { jobs: [], warnings: ["Source unavailable"], checkedAt: "2026-10-28T00:00:00Z", sources: [{ provider: "Lever", board: "example", status: "failed", checkedAt: "2026-10-28T00:00:00Z", jobs: 0 }] };
  const healthy = { ...failed, warnings: [], sources: [{ ...failed.sources![0], status: "ok" as const }] };
  assert.equal(availableAssistantCatalogs([{ status: "fulfilled", value: failed }, { status: "rejected", reason: new Error("timeout") }]), null);
  const partial = availableAssistantCatalogs([{ status: "fulfilled", value: healthy }, { status: "fulfilled", value: failed }]);
  assert.deepEqual(partial?.jobs, []);
  assert.match(partial!.warnings[0], /incomplete/);
  assert.deepEqual(availableAssistantCatalogs([{ status: "fulfilled", value: healthy }])?.warnings, []);
});

test("resume requests use actual extracted role evidence locally rather than searching the words my resume", () => {
  const resume: ResumeEvidence = { id: "test", label: "Private resume.pdf", skills: ["SQL", "Excel"], roles: [], suggestedRoles: ["MIS Analyst", "Data Analyst"], yearsExperience: 0.5, education: ["BBA"] };
  const result = resumeCareerReply("Find the best jobs for my resume in Kolkata", resume);
  assert.equal(result?.kind, "search");
  if (result?.kind !== "search") throw new Error("Expected search");
  assert.equal(result.intent.role, "Data Analyst");
  assert.equal(result.intent.location, "Kolkata, West Bengal");
  assert.equal(result.intent.experience, "entry");
  assert.ok(!JSON.stringify(result).includes("Private resume"));
  assert.equal(resumeCareerReply("Find jobs for my resume", undefined)?.kind, "clarify");
  assert.equal(resumeCareerReply("Find jobs for my resume in London", resume), null);
  assert.equal(resumeCareerReply("Deloitte jobs in India", resume), null);
  const manual = resumeCareerReply("Find Sales Executive jobs for my resume in Kolkata", resume);
  assert.equal(manual?.kind === "search" && manual.intent.role, "Sales Executive");
  const unknown = resumeCareerReply("Find the best jobs for my resume in Kolkata", { ...resume, yearsExperience: null });
  assert.equal(unknown?.kind, "clarify");
  if (unknown?.kind !== "clarify" || !unknown.context) throw new Error("Expected contextual experience question");
  const answer = quickCareerReply("Fresher jobs", assistantContext(unknown.context));
  assert.equal(answer?.kind === "search" && answer.intent.role, "Data Analyst");
  assert.equal(answer?.kind === "search" && answer.intent.location, "Kolkata, West Bengal");
  assert.equal(answer?.kind === "search" && answer.intent.experience, "entry");
  const experienced = resumeCareerReply("Find jobs for my resume in India", { ...resume, yearsExperience: 2 });
  assert.equal(experienced?.kind === "search" && experienced.intent.experience, "3");
});

test("source release/update never becomes an original posting date", () => {
  assert.deepEqual(postingLabel({ postedAt: null, releasedAt: null, updatedAt: null }), { date: "Not supplied", label: "Original posting date unknown" });
  assert.match(postingLabel({ postedAt: null, releasedAt: "2026-10-27T00:00:00Z", updatedAt: null }).label, /not original/);
  assert.match(postingLabel({ postedAt: null, updatedAt: "2026-10-27T00:00:00Z" }).label, /not original/);
  assert.equal(postingLabel({ postedAt: "2025-01-01T00:00:00Z", updatedAt: "2026-10-27T00:00:00Z" }).date, "2025-01-01");
});
test("education hints do not assert acceptance or infer a candidate degree", () => {
  const base = { description: "Requirements\nBachelor's degree in Computer Science required.", requirements: [] } as unknown as Job;
  const result = educationCheck(base);
  assert.equal(result.label, "Check degree requirement");
  assert.match(result.note, /Computer Science/);
  assert.equal(result.resume, undefined);
  assert.equal(educationCheck({ ...base, descriptionPending: true }).label, "Open full requirements");
  assert.equal(educationCheck({ ...base, description: "SQL and Excel." }).label, "Not stated clearly");
  assert.equal(educationCheck({ ...base, description: "Strong analytical skills and a high degree of accuracy required." }).label, "Not stated clearly");
  assert.equal(educationCheck({ ...base, description: "Maintain entity master and reference datasets." }).label, "Not stated clearly");
});
test("model outage offers safe clarification and chosen follow-up retains confirmed city and experience", () => {
  const prior = assistantContext({ ...EMPTY_INTENT, location: "Bokaro, Jharkhand", experience: "entry", qualification: "BBA" });
  const reply = recoverCareerReply("which role would fit me best", prior);
  assert.equal(reply?.kind, "clarify");
  if (reply?.kind !== "clarify") throw new Error("Expected a clarification");
  const chosen = quickCareerReply(reply.suggestions[0], prior);
  assert.equal(chosen?.kind, "search");
  if (chosen?.kind !== "search") throw new Error("Expected search");
  assert.equal(chosen.intent.location, "Bokaro, Jharkhand");
  assert.equal(chosen.intent.experience, "entry");
  assert.equal(recoverCareerReply("private@example.com"), null);
  assert.equal(recoverCareerReply("BBF Racer")?.kind, "clarify");
});

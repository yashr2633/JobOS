import test from "node:test";
import assert from "node:assert/strict";
import { orderLoadedAssistantJobs } from "./assistantOrdering.ts";
import { graduateDirectionMatches } from "./assistantSearch.ts";
import { EMPTY_PROFILE, type Job, type ResumeEvidence } from "./types.ts";

const profile = { ...EMPTY_PROFILE, roles: ["Data Analyst"], skills: ["SQL", "Excel"], yearsExperience: 0 };
const resume: ResumeEvidence = { id: "example", label: "Synthetic resume", roles: ["Data Analyst"], skills: ["SQL", "Excel"], yearsExperience: 0, usable: true };
const job = (id: string, patch: Partial<Job> = {}): Job => ({ id, source: "Example", board: "example", externalId: id, company: "Example", title: "Data Analyst", description: "SQL and Excel reporting", requirements: [], location: "India", workMode: "Remote", minYearsExperience: 0, skills: ["SQL", "Excel"], salary: null, employmentType: "Full Time", postedAt: null, expiresAt: null, updatedAt: null, fetchedAt: "2026-10-30T00:00:00Z", applicationUrl: "https://example.com/job", sourceUrl: "https://example.com", ...patch });

test("broad business-graduate searches exclude unrelated technical and design internships", () => {
  for (const title of ["Tomcat Administrator I - IN", "Graphic Design Intern", "Cloud Operations Intern", "Network Administration Trainee", "Software Engineer Intern"]) assert.equal(graduateDirectionMatches({ title }, "BBA"), false, title);
  for (const title of ["Talent Acquisition Intern", "Customer Operations Specialist", "Inside Sales Representative", "Executive Assistant - AI & Business Operations", "Data Analyst Intern", "Office Administrator"]) assert.equal(graduateDirectionMatches({ title }, "BBA"), true, title);
  assert.equal(graduateDirectionMatches({ title: "Software Engineer Intern" }, "BTech"), true, "business direction filtering must not remove technical graduate jobs");
});
test("loaded results put complete, stronger resume matches first without modifying the records", () => {
  const poor = job("poor", { title: "Graphic Designer", skills: ["Photoshop"], description: "Graphic design and Photoshop" });
  const pending = job("pending", { descriptionPending: true });
  const strong = job("strong");
  const input = [poor, pending, strong];
  assert.deepEqual(orderLoadedAssistantJobs(input, profile, resume, "India").map(item => item.id), ["strong", "poor", "pending"]);
  assert.deepEqual(input.map(item => item.id), ["poor", "pending", "strong"]);
});
test("requested city takes precedence over higher-scoring remote alternatives; no-resume order is retained", () => {
  const local = job("local", { location: "Kolkata, West Bengal, India", skills: [], description: "Review requirements at source" });
  const remote = job("remote");
  assert.equal(orderLoadedAssistantJobs([remote, local], profile, resume, "Kolkata, West Bengal")[0].id, "local");
  const input = [remote, local];
  assert.equal(orderLoadedAssistantJobs(input, profile, undefined, "India"), input);
});

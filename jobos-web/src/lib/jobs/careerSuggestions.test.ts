import test from "node:test";
import assert from "node:assert/strict";
import { careerSuggestions } from "./careerSuggestions.ts";
import { quickCareerReply } from "./careerReply.ts";

test("degree prefixes include jobs, fresher and graduate searches with punctuation aliases", () => {
  for (const [query, degree] of [["bba", "BBA"], ["B.Com", "B.Com"], ["bcom", "B.Com"], ["btech", "B.Tech"], ["mba", "MBA"]]) {
    const values = careerSuggestions(query).map(item => item.value);
    for (const suffix of ["jobs", "fresher jobs", "graduate jobs"]) assert.ok(values.includes(`${degree} ${suffix}`), `${query}: ${suffix}`);
  }
  assert.ok(careerSuggestions("b").some(item => item.value === "BBA jobs"));
  assert.ok(careerSuggestions("bba fr").some(item => item.value === "BBA fresher jobs"));
  assert.ok(careerSuggestions("BP").some(item => item.value === "B.Pharm jobs"));
});

test("roles, fields, skills, companies and Indian cities use the existing directories", () => {
  for (const [query, expected] of [["data", "Data Analyst jobs"], ["sales", "Sales Executive jobs"], ["finance", "Finance jobs"], ["sql", "SQL jobs"], ["deloitte", "Deloitte jobs"]]) {
    assert.ok(careerSuggestions(query).some(item => item.value === expected), query);
  }
  for (const query of ["Dhanbad", "धनबाद", "Kolkata", "Bokaro", "jobs in Dhanbad"]) {
    assert.ok(careerSuggestions(query).some(item => item.kind === "City" && item.value.startsWith("Jobs in ")), query);
  }
  assert.ok(careerSuggestions("India").some(item => item.value === "Jobs in India"));
});

test("suggestions remain bounded, distinct and private with no fabricated vacancies", () => {
  for (const query of ["", "person@example.com", "https://example.com", "9431390439", "unknown invented keyword", "x".repeat(121)]) assert.deepEqual(careerSuggestions(query), []);
  for (const query of ["b", "data", "D", "jobs"]) {
    const options = careerSuggestions(query);
    assert.ok(options.length <= 12);
    assert.equal(new Set(options.map(item => item.value.toLowerCase())).size, options.length);
    assert.ok(options.every(item => !/\d+ (?:open|live|available)|verified vacancy/i.test(item.value)));
  }
  assert.equal(careerSuggestions("b", 2).length, 2);
});

test("requested degree, role and city choices reach the existing local interpreter", () => {
  for (const query of ["BBA jobs", "BBA fresher jobs", "B.Com graduate jobs", "Sales Executive jobs", "Jobs in Dhanbad, Jharkhand", "Deloitte jobs"]) {
    const reply = quickCareerReply(query);
    assert.equal(reply?.kind, "search", query);
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { roleEvidenceText } from "./jobEvidence.ts";
import { extractSkills } from "./matching.ts";

test("company investors do not become skill gaps when explicit role sections exist", () => {
  const description = "Our investors include Salesforce Ventures. Our company has 20 years of industry experience.\n\nKey Responsibilities\nPrepare reports using SQL.\nRequired Qualifications\nKnowledge of Tableau and data analysis.";
  const evidence = roleEvidenceText(description);
  assert.ok(!evidence.includes("Salesforce"));
  assert.ok(!evidence.includes("20 years"));
  assert.ok(extractSkills(evidence).includes("SQL"));
  assert.ok(extractSkills(evidence).includes("Tableau"));
  assert.ok(description.includes("Salesforce"), "the displayed original description is unchanged");
});

test("unsectioned postings retain their complete evidence", () => {
  const description = "Seeking an analyst with SQL, Excel and two years of relevant experience.";
  assert.equal(roleEvidenceText(description), description);
});

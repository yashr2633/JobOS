/**
 * Correctness properties for the deterministic scorer.
 *
 * Run with:  npm run test:ai
 * Uses the Node built-in test runner and native type stripping, so no test
 * framework is added to the project.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

// Explicit ".ts" specifiers: required by the Node runner, permitted by
// allowImportingTsExtensions in tsconfig.json.
import { scoreMatch } from "./scoring.ts";
import {
  canonicalSkill,
  detectDegreeLevel,
  findSatisfyingSkill,
} from "./normalize.ts";
import {
  validateInputText,
  validateMatchInterpretation,
  validateParsedJD,
  validateParsedResume,
  LIMITS,
} from "./schemas.ts";
import { SCORING_VERSION, type ParsedJD, type ParsedResume } from "./types.ts";

function jd(overrides: Partial<ParsedJD> = {}): ParsedJD {
  return {
    title: "Backend Engineer",
    company: "Acme",
    requiredSkills: ["TypeScript", "PostgreSQL"],
    preferredSkills: ["Docker"],
    minYearsExperience: 4,
    educationRequirements: ["Bachelor's degree in Computer Science"],
    responsibilities: [],
    ...overrides,
  };
}

function resume(overrides: Partial<ParsedResume> = {}): ParsedResume {
  return {
    skills: ["TypeScript", "PostgreSQL", "Docker"],
    totalYearsExperience: 5,
    roles: [{ title: "Backend Engineer", years: 5 }],
    education: [{ degree: "B.Tech", field: "Computer Science" }],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Score range and determinism
// ---------------------------------------------------------------------------

test("score is an integer within 0..100 across varied inputs", () => {
  const cases: Array<[ParsedJD, ParsedResume]> = [
    [jd(), resume()],
    [jd(), resume({ skills: ["Cobol"], totalYearsExperience: 0, education: [] })],
    [jd({ preferredSkills: [] }), resume()],
    [jd({ minYearsExperience: null }), resume({ totalYearsExperience: null })],
    [jd({ educationRequirements: [] }), resume({ education: [] })],
    [jd({ requiredSkills: ["Go"] }), resume({ skills: ["Go"] })],
    [jd({ minYearsExperience: 10 }), resume({ totalYearsExperience: 1 })],
  ];

  for (const [jobDescription, candidate] of cases) {
    const result = scoreMatch(jobDescription, candidate);
    assert.ok(Number.isInteger(result.score), "score must be an integer");
    assert.ok(result.score >= 0 && result.score <= 100, "score must be 0..100");
    assert.equal(result.scoringVersion, SCORING_VERSION);
  }
});

test("identical inputs produce identical results", () => {
  const first = scoreMatch(jd(), resume());
  const second = scoreMatch(jd(), resume());
  assert.deepEqual(first, second);
});

test("repeated evaluation is stable over many iterations", () => {
  const baseline = scoreMatch(jd(), resume()).score;
  for (let i = 0; i < 200; i += 1) {
    assert.equal(scoreMatch(jd(), resume()).score, baseline);
  }
});

// ---------------------------------------------------------------------------
// Boundary behaviour
// ---------------------------------------------------------------------------

test("satisfying every stated dimension scores exactly 100", () => {
  const result = scoreMatch(jd(), resume());
  assert.equal(result.score, 100);
  assert.deepEqual(result.missingRequiredSkills, []);
  assert.deepEqual(result.missingPreferredSkills, []);
});

test("satisfying nothing scores exactly 0", () => {
  const result = scoreMatch(
    jd(),
    resume({
      skills: ["Fortran"],
      totalYearsExperience: 0,
      education: [],
    })
  );
  assert.equal(result.score, 0);
});

test("effective weights across present dimensions sum to 1", () => {
  for (const jobDescription of [
    jd(),
    jd({ preferredSkills: [] }),
    jd({ minYearsExperience: null }),
    jd({ educationRequirements: [] }),
    jd({ preferredSkills: [], minYearsExperience: null, educationRequirements: [] }),
  ]) {
    const result = scoreMatch(jobDescription, resume());
    const total = result.components.reduce((sum, c) => sum + c.weight, 0);
    assert.ok(
      Math.abs(total - 1) < 1e-9,
      `weights summed to ${total} instead of 1`
    );
  }
});

test("absent dimensions are redistributed, not penalized", () => {
  // A JD with no education line must still allow a perfect score.
  const result = scoreMatch(
    jd({ educationRequirements: [] }),
    resume({ education: [] })
  );
  assert.equal(result.score, 100);
  assert.equal(result.educationGap, null);
  assert.ok(!result.components.some((c) => c.dimension === "education"));
});

test("required skills outweigh preferred skills", () => {
  const requiredOnly = scoreMatch(
    jd({ minYearsExperience: null, educationRequirements: [] }),
    resume({ skills: ["TypeScript", "PostgreSQL"] })
  );
  const preferredOnly = scoreMatch(
    jd({ minYearsExperience: null, educationRequirements: [] }),
    resume({ skills: ["Docker"] })
  );
  assert.ok(
    requiredOnly.score > preferredOnly.score,
    "matching required skills must score higher than matching preferred only"
  );
});

// ---------------------------------------------------------------------------
// Missing-skill invariants
// ---------------------------------------------------------------------------

test("missing skills are exactly the unmatched subset of the JD lists", () => {
  const result = scoreMatch(
    jd({
      requiredSkills: ["TypeScript", "Kubernetes"],
      preferredSkills: ["Docker", "Terraform"],
    }),
    resume({ skills: ["TypeScript", "Docker"] })
  );

  assert.deepEqual(result.missingRequiredSkills, ["Kubernetes"]);
  assert.deepEqual(result.missingPreferredSkills, ["Terraform"]);

  // No invented skills: every reported gap came from the JD.
  const stated = new Set([
    ...result.requiredSkills.map((s) => s.skill),
    ...result.preferredSkills.map((s) => s.skill),
  ]);
  for (const skill of [
    ...result.missingRequiredSkills,
    ...result.missingPreferredSkills,
  ]) {
    assert.ok(stated.has(skill), `${skill} was not stated in the JD`);
  }
});

test("matched skills record which resume skill satisfied them", () => {
  const result = scoreMatch(
    jd({ requiredSkills: ["AWS"], preferredSkills: [] }),
    resume({ skills: ["AWS Lambda"] })
  );
  assert.equal(result.requiredSkills[0].matched, true);
  assert.equal(result.requiredSkills[0].matchedBy, "AWS Lambda");
});

// ---------------------------------------------------------------------------
// Gap detection
// ---------------------------------------------------------------------------

test("experience gap reports the shortfall and clamps at zero", () => {
  const short = scoreMatch(jd({ minYearsExperience: 6 }), resume({ totalYearsExperience: 2 }));
  assert.deepEqual(short.experienceGap, {
    requiredYears: 6,
    candidateYears: 2,
    gapYears: 4,
  });

  const over = scoreMatch(jd({ minYearsExperience: 3 }), resume({ totalYearsExperience: 9 }));
  assert.equal(over.experienceGap?.gapYears, 0);
});

test("exceeding the experience requirement does not award bonus points", () => {
  const exact = scoreMatch(jd({ minYearsExperience: 4 }), resume({ totalYearsExperience: 4 }));
  const over = scoreMatch(jd({ minYearsExperience: 4 }), resume({ totalYearsExperience: 40 }));
  assert.equal(exact.score, over.score);
});

test("education gap compares degree levels", () => {
  const met = scoreMatch(jd(), resume({ education: [{ degree: "M.Tech", field: null }] }));
  assert.equal(met.educationGap?.met, true);

  const unmet = scoreMatch(
    jd({ educationRequirements: ["Master's degree required"] }),
    resume({ education: [{ degree: "B.Sc", field: null }] })
  );
  assert.equal(unmet.educationGap?.met, false);
  assert.equal(unmet.educationGap?.requiredLevel, "master");
  assert.equal(unmet.educationGap?.candidateLevel, "bachelor");
});

test("unrecognizable education requirement is left unscored", () => {
  const result = scoreMatch(
    jd({ educationRequirements: ["Relevant technical background"] }),
    resume({ education: [] })
  );
  assert.equal(result.educationGap, null);
});

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

test("confidence reflects available evidence, not candidate quality", () => {
  assert.equal(scoreMatch(jd(), resume()).confidence, "high");

  assert.equal(
    scoreMatch(
      jd({ preferredSkills: [], minYearsExperience: null, educationRequirements: [] }),
      resume()
    ).confidence,
    "low"
  );

  assert.equal(
    scoreMatch(jd(), resume({ skills: [] })).confidence,
    "low"
  );
});

// ---------------------------------------------------------------------------
// Skill normalization
// ---------------------------------------------------------------------------

test("skill matching is directional", () => {
  assert.equal(findSatisfyingSkill("AWS", ["AWS Lambda"]), "AWS Lambda");
  assert.equal(findSatisfyingSkill("AWS Lambda", ["AWS"]), null);
});

test("substring collisions do not produce false matches", () => {
  assert.equal(findSatisfyingSkill("Java", ["JavaScript"]), null);
  assert.equal(findSatisfyingSkill("Go", ["Google Cloud"]), null);
});

test("punctuation and casing variants normalize together", () => {
  assert.equal(canonicalSkill("React.js"), canonicalSkill("reactjs"));
  assert.equal(canonicalSkill("  NODE.JS "), canonicalSkill("Node"));
  assert.equal(canonicalSkill("CI/CD"), canonicalSkill("ci cd"));
  assert.ok(findSatisfyingSkill("TypeScript", ["typescript"]) !== null);
});

test("degree abbreviations resolve to levels", () => {
  assert.equal(detectDegreeLevel("Ph.D. in Physics"), "doctorate");
  assert.equal(detectDegreeLevel("M.Tech"), "master");
  assert.equal(detectDegreeLevel("B.Sc Computer Science"), "bachelor");
  assert.equal(detectDegreeLevel("Some coursework"), "none");
});

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

test("JD parse without required skills is rejected", () => {
  const result = validateParsedJD({ requiredSkills: [], preferredSkills: ["Docker"] });
  assert.equal(result.ok, false);
});

test("JD validator coerces junk fields without failing a usable parse", () => {
  const result = validateParsedJD({
    title: "Engineer",
    requiredSkills: ["Go", 42, "", "Go"],
    preferredSkills: null,
    minYearsExperience: "five",
    educationRequirements: ["Bachelor's degree"],
    responsibilities: undefined,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.requiredSkills, ["Go"]);
  assert.deepEqual(result.value.preferredSkills, []);
  assert.equal(result.value.minYearsExperience, null);
});

test("out-of-range experience values are discarded", () => {
  const result = validateParsedResume({ skills: ["Go"], totalYearsExperience: 2019 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.totalYearsExperience, null);
});

test("resume parse with no skills is rejected", () => {
  assert.equal(validateParsedResume({ skills: [] }).ok, false);
});

test("interpretation cannot smuggle in a score", () => {
  const result = validateMatchInterpretation({
    summary: "Strong overlap on backend skills.",
    recommendations: ["Add Kubernetes experience."],
    matchScore: 100,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(!("matchScore" in result.value));
});

test("input text bounds are enforced", () => {
  assert.equal(validateInputText("too short", "Job description").ok, false);
  assert.equal(
    validateInputText("x".repeat(LIMITS.inputTextMax + 1), "Job description").ok,
    false
  );
  assert.equal(
    validateInputText("y".repeat(LIMITS.inputTextMin + 1), "Job description").ok,
    true
  );
});

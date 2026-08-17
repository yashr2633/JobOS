/**
 * Resume Match flow-state tests.
 *
 * The load-bearing test here is the one asserting that analysis can never gate
 * tailoring. Everything else is presentation.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import {
  resumeMatchFlowState,
  TAILOR_BEFORE_ANALYZE_HINT,
  TAILOR_NEEDS_JD_HINT,
  TAILOR_NEEDS_RESUME_HINT,
} from "./flowState.ts";

// ---------------------------------------------------------------------------
// Tailor is never blocked behind Analyze
// ---------------------------------------------------------------------------

test("tailoring works with a resume and a JD but no analysis", () => {
  const state = resumeMatchFlowState({
    hasResume: true,
    hasJobDescription: true,
    hasAnalysis: false,
  });

  assert.equal(state.canTailor, true, "tailoring is available without analysis");
  assert.equal(state.analyzeRecommended, true, "analysis is still recommended");
  assert.equal(state.tailorIsNextStep, false);
  assert.equal(state.tailorHint, TAILOR_BEFORE_ANALYZE_HINT);
});

test("Property: analysis NEVER changes whether tailoring is possible", () => {
  fc.assert(
    fc.property(fc.boolean(), fc.boolean(), (hasResume, hasJobDescription) => {
      const withAnalysis = resumeMatchFlowState({
        hasResume,
        hasJobDescription,
        hasAnalysis: true,
      });
      const withoutAnalysis = resumeMatchFlowState({
        hasResume,
        hasJobDescription,
        hasAnalysis: false,
      });
      return withAnalysis.canTailor === withoutAnalysis.canTailor;
    }),
    { numRuns: 100 }
  );
});

test("Property: tailoring is possible exactly when a resume and a JD exist", () => {
  fc.assert(
    fc.property(
      fc.boolean(),
      fc.boolean(),
      fc.boolean(),
      (hasResume, hasJobDescription, hasAnalysis) => {
        const state = resumeMatchFlowState({
          hasResume,
          hasJobDescription,
          hasAnalysis,
        });
        return state.canTailor === (hasResume && hasJobDescription);
      }
    ),
    { numRuns: 200 }
  );
});

// ---------------------------------------------------------------------------
// Analyze -> Tailor emphasis
// ---------------------------------------------------------------------------

test("after analysis, tailoring becomes the next step and the hint clears", () => {
  const state = resumeMatchFlowState({
    hasResume: true,
    hasJobDescription: true,
    hasAnalysis: true,
  });

  assert.equal(state.tailorIsNextStep, true);
  assert.equal(state.analyzeRecommended, false, "no longer cued once done");
  assert.equal(state.tailorHint, null);
});

test("analysis is only recommended while it is actually actionable", () => {
  const noResume = resumeMatchFlowState({
    hasResume: false,
    hasJobDescription: true,
    hasAnalysis: false,
  });
  assert.equal(noResume.analyzeRecommended, false);
  assert.equal(noResume.canAnalyze, false);
});

// ---------------------------------------------------------------------------
// Missing prerequisites are named specifically
// ---------------------------------------------------------------------------

test("a missing resume is reported before a missing job description", () => {
  const state = resumeMatchFlowState({
    hasResume: false,
    hasJobDescription: false,
    hasAnalysis: false,
  });
  assert.equal(state.tailorHint, TAILOR_NEEDS_RESUME_HINT);
  assert.equal(state.canTailor, false);
});

test("a missing job description is named once a resume exists", () => {
  const state = resumeMatchFlowState({
    hasResume: true,
    hasJobDescription: false,
    hasAnalysis: false,
  });
  assert.equal(state.tailorHint, TAILOR_NEEDS_JD_HINT);
  assert.equal(state.canTailor, false);
});

test("Property: the state is total and internally consistent", () => {
  fc.assert(
    fc.property(
      fc.boolean(),
      fc.boolean(),
      fc.boolean(),
      (hasResume, hasJobDescription, hasAnalysis) => {
        const state = resumeMatchFlowState({
          hasResume,
          hasJobDescription,
          hasAnalysis,
        });
        // Analyze and Tailor share prerequisites.
        if (state.canAnalyze !== state.canTailor) return false;
        // "Next step" implies it is actionable.
        if (state.tailorIsNextStep && !state.canTailor) return false;
        // A blocked flow always explains itself.
        if (!state.canTailor && state.tailorHint === null) return false;
        // A complete flow shows no hint.
        if (state.canTailor && hasAnalysis && state.tailorHint !== null) return false;
        return true;
      }
    ),
    { numRuns: 200 }
  );
});

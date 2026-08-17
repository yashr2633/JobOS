/**
 * Resume Match step state — the recommendation rules, as a pure function.
 *
 * The workflow is Application -> Resume -> Job Description -> Analyze -> Tailor.
 * Analyze is RECOMMENDED before Tailor, and after an analysis exists Tailor
 * becomes the visually obvious next step.
 *
 * THE INVARIANT THIS MODULE EXISTS TO PROTECT
 *
 * Tailoring is never hard-blocked behind analysis. It needs a resume and a job
 * description; that is all. `canTailor` is therefore computed WITHOUT reading
 * `hasAnalysis`, and a property test asserts that flipping `hasAnalysis` can
 * never change it. Analysis only moves emphasis — which control looks primary,
 * and which hint is shown.
 *
 * Keeping this out of the JSX means the rule is stated once, is unit-testable
 * without a DOM, and cannot quietly drift into a gate during a later UI edit.
 */

export interface ResumeMatchFlowInput {
  /** A resume is selected or freshly uploaded. */
  hasResume: boolean;
  /** The application carries (or the user pasted) usable JD text. */
  hasJobDescription: boolean;
  /** An analysis result exists for the selected application. */
  hasAnalysis: boolean;
}

export interface ResumeMatchFlowState {
  canAnalyze: boolean;
  /** Independent of `hasAnalysis`, by construction. */
  canTailor: boolean;
  /** Show the "recommended first" cue on Analyze. */
  analyzeRecommended: boolean;
  /** Present Tailor as the primary next action. */
  tailorIsNextStep: boolean;
  /** A short cue, or null when no cue is warranted. */
  tailorHint: string | null;
}

/** Shown when tailoring is possible but analysis has not been run yet. */
export const TAILOR_BEFORE_ANALYZE_HINT =
  "Running Analyze first is recommended, but you can tailor now.";

/** Shown when a prerequisite is genuinely missing. */
export const TAILOR_NEEDS_RESUME_HINT =
  "Select or upload a resume above to tailor it.";

export const TAILOR_NEEDS_JD_HINT =
  "Add a job description above to tailor against it.";

/**
 * Derive the step state.
 *
 * Total: every combination of the three booleans yields a coherent state.
 */
export function resumeMatchFlowState(
  input: ResumeMatchFlowInput
): ResumeMatchFlowState {
  const { hasResume, hasJobDescription, hasAnalysis } = input;

  // Both actions share the same real prerequisites. Note the deliberate absence
  // of `hasAnalysis` from `canTailor`.
  const ready = hasResume && hasJobDescription;
  const canAnalyze = ready;
  const canTailor = ready;

  let tailorHint: string | null = null;
  if (!hasResume) {
    tailorHint = TAILOR_NEEDS_RESUME_HINT;
  } else if (!hasJobDescription) {
    tailorHint = TAILOR_NEEDS_JD_HINT;
  } else if (!hasAnalysis) {
    tailorHint = TAILOR_BEFORE_ANALYZE_HINT;
  }

  return {
    canAnalyze,
    canTailor,
    // Only worth cueing while it is actually actionable and not yet done.
    analyzeRecommended: canAnalyze && !hasAnalysis,
    tailorIsNextStep: canTailor && hasAnalysis,
    tailorHint,
  };
}

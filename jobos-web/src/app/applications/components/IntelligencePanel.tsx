"use client";

import { useEffect, useRef, useState } from "react";
import type { Application } from "../types";
import type { MatchResult } from "@/lib/ai/types";
import { analyzeApplication } from "../services/aiClient";
import MatchScoreRing from "./MatchScoreRing";
import SkillGapList from "./SkillGapList";
import StatusBadge from "./StatusBadge";
import { createClient } from "@/lib/supabase/client";
import { fetchResumes } from "@/lib/api/resumes";

interface IntelligencePanelProps {
  application: Application;
  /** If provided, override the stored job description with this text */
  jobDescription?: string;
  /**
   * Controlled resume mode. When this prop is passed (even as `null`), the
   * panel skips its own resume library dropdown/fetch and uses this value
   * directly — the caller (e.g. Resume Match's inline upload flow) owns
   * resume selection. `null` means "not ready yet" and disables Analyze.
   *
   * When this prop is omitted entirely, the panel falls back to its legacy
   * behavior: fetching the user's resume library and rendering a dropdown.
   * This keeps the Applications detail modal's AI Intelligence tab working
   * unchanged.
   */
  resumeId?: string | null;
  /**
   * Notified when an analysis result appears or is cleared.
   *
   * Purely presentational: Resume Match uses it to present tailoring as the
   * recommended NEXT step once a score exists. It never gates tailoring, and
   * omitting it leaves this panel's behavior identical — which is what keeps the
   * Applications detail modal untouched.
   */
  onResultChange?: (hasResult: boolean) => void;
}

export default function IntelligencePanel({
  application,
  jobDescription,
  resumeId: controlledResumeId,
  onResultChange,
}: IntelligencePanelProps) {
  const isControlledResumeMode = controlledResumeId !== undefined;

  // A caller-supplied jobDescription (e.g. the standalone Resume Match page,
  // where the user types/edits JD text inline) takes precedence over the
  // application's stored text. Falls back to the stored value for existing
  // call sites (e.g. the Applications detail modal) that don't pass this prop.
  const effectiveJobDescription =
    jobDescription && jobDescription.trim().length > 0
      ? jobDescription
      : application.jobDescription;

  const [result, setResult] = useState<MatchResult | null>(null);
  const [status, setStatus] = useState<"idle" | "analyzing" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isButtonDisabled, setIsButtonDisabled] = useState(false);

  // Tracks the in-flight analyze request so Cancel aborts the REAL request
  // (previously it created and aborted a throwaway controller, which did
  // nothing) and so an unmount doesn't try to setState on a dead component.
  const activeRequestRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      activeRequestRef.current?.abort();
    };
  }, []);

  const [resumes, setResumes] = useState<{ id: string; label: string }[]>([]);
  const [selectedResumeId, setSelectedResumeId] = useState<string | null>(null);
  const [loadingResumes, setLoadingResumes] = useState(!isControlledResumeMode);
  const [resumeFetchError, setResumeFetchError] = useState<string | null>(null);

  // The resume actually used for analysis: caller-controlled when provided,
  // otherwise whatever the legacy dropdown has selected.
  const effectiveResumeId = isControlledResumeMode
    ? controlledResumeId
    : selectedResumeId;

  // Load user's resumes when panel mounts — only in legacy dropdown mode.
  useEffect(() => {
    if (isControlledResumeMode) return;

    async function loadResumes() {
      setLoadingResumes(true);
      setResumeFetchError(null);

      try {
        // One resume data-access layer, shared with the Resume library —
        // no second inline query to drift from it.
        const library = await fetchResumes(createClient());
        const mapped = library.map((resume) => ({
          id: resume.id,
          label: resume.label,
        }));
        setResumes(mapped);
        if (mapped.length > 0) {
          setSelectedResumeId(mapped[0].id);
        }
      } catch (err: unknown) {
        console.error("Error fetching resumes:", err);
        setResumeFetchError("Failed to load resumes. Please try again.");
        setResumes([]);
      } finally {
        setLoadingResumes(false);
      }
    }

    loadResumes();
  }, [isControlledResumeMode]);

  async function handleAnalyze() {
    // Prevent duplicate requests
    if (status === "analyzing" || isButtonDisabled) return;
    if (!effectiveResumeId) {
      setErrorMsg(
        isControlledResumeMode
          ? "Upload a resume before analyzing."
          : "Please select a resume to analyze."
      );
      setStatus("error");
      return;
    }

    setIsButtonDisabled(true);

    setStatus("analyzing");
    setErrorMsg(null);

    // Store the controller that actually guards this request, so Cancel (and
    // unmount cleanup) can abort the real in-flight fetch.
    const controller = new AbortController();
    activeRequestRef.current = controller;

    try {
      const analysis = await analyzeApplication(
        {
          applicationId: application.id,
          resumeId: effectiveResumeId,
          jobDescription,
        },
        controller.signal
      );

      if (!isMountedRef.current) return;

      // BUG FIX: status must leave "analyzing" on success, or the render
      // branch for status === "analyzing" keeps matching forever and the
      // spinner never clears even though the request completed.
      setResult(analysis);
      setStatus("idle");
      onResultChange?.(true);
    } catch (err: unknown) {
      if (!isMountedRef.current) return;

      if (err instanceof Error && err.name === "AbortError") {
        setStatus("idle");
        return;
      }
      const message = err instanceof Error ? err.message : "Analysis failed";
      setErrorMsg(message);
      setStatus("error");
    } finally {
      activeRequestRef.current = null;
      if (isMountedRef.current) setIsButtonDisabled(false);
    }
  }

  function handleCancel() {
    activeRequestRef.current?.abort();
  }

  function handleReset() {
    setResult(null);
    setStatus("idle");
    setErrorMsg(null);
    onResultChange?.(false);
  }

  if (status === "idle" && !result) {
    // Controlled mode (Resume Match): the parent already handles resume
    // upload/status UI, so this panel only needs the Analyze action itself.
    if (isControlledResumeMode) {
      return (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleAnalyze}
            disabled={!effectiveJobDescription || !effectiveResumeId || isButtonDisabled}
            className="rounded-md bg-accent px-5 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isButtonDisabled ? "Analyzing..." : "Analyze Resume"}
          </button>
        </div>
      );
    }

    return (
      <div className="rounded-md border border-border bg-surface p-5">
        <h3 className="text-sm font-semibold text-text">AI Intelligence</h3>
        <p className="mt-1 text-sm text-text-secondary">
          Analyze your application against the job description to get a match
          score, missing skills, and recommendations.
        </p>

        {loadingResumes ? (
          <div className="mt-5 text-center">
            <div className="mx-auto inline-block h-5 w-5 animate-spin rounded-full border-2 border-border-strong border-t-accent" />
            <p className="mt-3 text-sm text-text-secondary">Loading resumes...</p>
          </div>
        ) : resumeFetchError ? (
          <div className="mt-4 rounded-md border border-danger/20 bg-danger-bg p-4">
            <p className="text-sm text-danger">{resumeFetchError}</p>
            <p className="mt-2 text-xs text-text-muted">
              Add a resume in{" "}
              <a href="/resumes" className="text-accent hover:underline">
                Resumes
              </a>{" "}
              to enable analysis.
            </p>
          </div>
        ) : resumes.length === 0 ? (
          <div className="mt-4 rounded-md border border-border bg-surface-2 p-4">
            <p className="text-sm text-text-secondary">
              No resumes found. Upload one in{" "}
              <a href="/resumes" className="text-accent hover:underline">
                Resumes
              </a>{" "}
              to enable analysis.
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div>
              <label
                htmlFor="resume-select"
                className="mb-1.5 block text-sm font-medium text-text-secondary"
              >
                Select resume to analyze
              </label>
              <select
                id="resume-select"
                value={selectedResumeId ?? ""}
                onChange={(e) => setSelectedResumeId(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
              >
                {resumes.map((resume) => (
                  <option key={resume.id} value={resume.id}>
                    {resume.label}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-xs text-text-muted">
              Job description is pulled from this application. The resume text is
              extracted and parsed by AI.
            </p>
          </div>
        )}

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={handleAnalyze}
            disabled={
              !effectiveJobDescription ||
              !selectedResumeId ||
              isButtonDisabled ||
              resumes.length === 0 ||
              resumeFetchError !== null
            }
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isButtonDisabled ? "Analyzing..." : "Analyze"}
          </button>
        </div>

        {!effectiveJobDescription && (
          <p className="mt-3 text-sm text-danger">
            No job description on this application. Paste the job description text
            in the application details to enable analysis.
          </p>
        )}
      </div>
    );
  }

  if (status === "analyzing") {
    return (
      <div className="rounded-md border border-border bg-surface p-6 text-center">
        <div className="mx-auto mb-3 inline-block h-8 w-8 animate-spin rounded-full border-2 border-border-strong border-t-accent" />
        <p className="text-sm text-text">Analyzing application...</p>
        <p className="mt-1 text-xs text-text-muted">
          This typically takes 10–30 seconds.
        </p>
        <button
          type="button"
          onClick={handleCancel}
          className="mt-5 text-sm text-text-muted hover:text-text"
        >
          Cancel
        </button>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="rounded-md border border-danger/20 bg-danger-bg p-5">
        <h3 className="text-sm font-semibold text-danger">Analysis failed</h3>
        <p className="mt-1 text-sm text-danger/90">{errorMsg}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={handleReset}
            className="rounded-md border border-border px-3.5 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-2"
          >
            Dismiss
          </button>
          <button
            type="button"
            onClick={handleAnalyze}
            className="rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (!result) {
    // Should not happen if status is not idle/error/analyzing, but TypeScript guard
    return null;
  }

  const score = result.score ?? 0;
  const confidence = result.confidence ?? "low";

  return (
    <div className="rounded-md border border-border bg-surface p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text">AI Intelligence</h3>
        {/* The application's real, current status — never a fixed value. */}
        <StatusBadge status={application.status} />
      </div>

      <div className="mt-4 flex items-center gap-5">
        <MatchScoreRing score={score} confidence={confidence} size="lg" />
        <div className="flex-1">
          <div>
            <span className="text-xl font-semibold text-text">{score}/100</span>
            <span className="ml-2 text-sm text-text-muted">
              {confidence === "high" ? "High confidence" : confidence === "medium" ? "Medium confidence" : "Low confidence"}
            </span>
          </div>
          <p className="mt-2 text-sm text-text-secondary">
            {result.summary || "Analysis completed. See recommendations below."}
          </p>
          {result.recommendations && result.recommendations.length > 0 && (
            <ul className="mt-3 space-y-2">
              {result.recommendations.slice(0, 3).map((rec, idx) => (
                <li key={idx} className="flex items-start gap-2 text-sm text-text-secondary">
                  <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                  <span>{rec}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">Missing required skills</h4>
          <div className="min-h-[4rem]">
            {/* One skill-gap renderer, shared instead of re-implemented here. */}
            <SkillGapList
              requiredSkills={result.requiredSkills?.map((s) => s.skill) ?? []}
              missingRequiredSkills={result.missingRequiredSkills ?? []}
              preferredSkills={result.preferredSkills?.map((s) => s.skill) ?? []}
              missingPreferredSkills={result.missingPreferredSkills ?? []}
              variant="missing-required"
            />
          </div>
        </div>

        <div>
          <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">Experience gap</h4>
          <div className="min-h-[4rem]">
            {result.experienceGap ? (
              <div className="text-sm text-text-secondary">
                {result.experienceGap.gapYears > 0 ? (
                  <p className="text-danger">
                    {result.experienceGap.gapYears} year(s) short of requirement
                  </p>
                ) : (
                  <p className="text-success">Requirement met</p>
                )}
              </div>
            ) : (
              <div className="text-sm text-text-muted">
                Not assessed (no experience requirement in JD)
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-5 flex justify-end">
        <button
          type="button"
          onClick={handleReset}
          className="rounded-md border border-border px-3.5 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-2"
        >
          Reset Analysis
        </button>
      </div>
    </div>
  );
}

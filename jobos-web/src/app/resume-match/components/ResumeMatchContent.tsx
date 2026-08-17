"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Application, ApplicationFormData } from "../../applications/types";
import { createApplication, fetchApplications } from "@/lib/api/applications";
import { fetchResumes } from "@/lib/api/resumes";
import { createClient } from "@/lib/supabase/client";
import IntelligencePanel from "../../applications/components/IntelligencePanel";
import ResumeUploadStep, { type UploadedResumeInfo } from "./ResumeUploadStep";
import TailorResumePanel from "./TailorResumePanel";
import { resumeMatchFlowState } from "../flowState";

/**
 * Resume Match — the Resumes experience, mounted directly at `/resumes`.
 *
 * There is no separate Library destination: saved resumes are selected and
 * uploaded here. The workflow is one line:
 *
 *   pick a resume -> pick the application / paste the JD -> Analyze
 *
 * WHAT CHANGED, AND WHY
 *
 * This page used to deliberately hide the resume library: every analysis
 * required a fresh upload, and the comment here said resume selection was "NOT
 * exposed as a library/dropdown". That is what made JobTrackOS feel like two
 * unrelated products — a Resume Library you upload into, and a Resume Match that
 * ignores it and makes you upload the same file again. Saved resumes are now
 * selectable here, so a resume is uploaded ONCE and reused for every analysis.
 *
 * Nothing was removed to achieve that. The upload path, `/api/resumes/upload`,
 * the `resumes` table, and the extraction pipeline are all untouched; uploading
 * still works and simply adds to the same library instead of bypassing it. A
 * freshly uploaded resume is selected immediately, so the fast path stays one
 * click.
 *
 * `fetchResumes` is the same data-access function the library page and the
 * Applications intelligence tab use, so there is no second resume query to drift
 * from it.
 */

/** A saved resume, reduced to what this picker renders. */
interface ResumeOption {
  id: string;
  label: string;
}

/**
 * A small numbered step marker, so the five-step workflow (Application, Resume,
 * Job Description, Analyze, Tailor Resume) reads as one guided sequence instead
 * of a stack of unrelated form fields.
 */
function StepLabel({
  step,
  label,
  as = "div",
  htmlFor,
  className = "",
}: {
  step: number;
  label: string;
  as?: "div" | "label";
  htmlFor?: string;
  className?: string;
}) {
  const content = (
    <span className="inline-flex items-center gap-2">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-accent-fg">
        {step}
      </span>
      <span className="text-sm font-medium text-text-secondary">{label}</span>
    </span>
  );

  return as === "label" ? (
    <label htmlFor={htmlFor} className={className}>
      {content}
    </label>
  ) : (
    <div className={className}>{content}</div>
  );
}

export default function ResumeMatchContent() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [resumes, setResumes] = useState<ResumeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedApplicationId, setSelectedApplicationId] = useState<
    string | null
  >(null);
  const [jobDescriptionDraft, setJobDescriptionDraft] = useState("");
  /**
   * The resume the analysis will use.
   *
   * Null means "none chosen yet", which `IntelligencePanel` reads as not-ready
   * and disables Analyze for — it is never a silent fallback to some other
   * resume.
   */
  const [selectedResumeId, setSelectedResumeId] = useState<string | null>(null);
  /** Most recent upload, so the step can confirm the file by name. */
  const [uploadedResume, setUploadedResume] =
    useState<UploadedResumeInfo | null>(null);
  /** True while the library reload after an upload is in flight. */
  const [refreshingResumes, setRefreshingResumes] = useState(false);
  /**
   * Whether the selected application currently has an analysis result.
   *
   * Presentation only. It promotes Tailor to the primary next step once a score
   * exists; it NEVER gates tailoring, which needs a resume and a JD and nothing
   * else. Reported by `IntelligencePanel` so there is no second scoring engine
   * and no duplicated analysis state.
   */
  const [analysisReady, setAnalysisReady] = useState(false);

  /**
   * Inline "New Application" flow, so a direct user never has to visit the
   * Applications page first. The fields are the minimum an analysis needs.
   */
  const [creatingApplication, setCreatingApplication] = useState(false);
  const [newRole, setNewRole] = useState("");
  const [newCompany, setNewCompany] = useState("");
  const [newJobDescription, setNewJobDescription] = useState("");
  const [savingApplication, setSavingApplication] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const supabase = useMemo(() => createClient(), []);

  /**
   * Load the saved resumes.
   *
   * `fetchResumes` already orders defaults first, so the head of the list is the
   * resume the user marked as their default — the right thing to preselect.
   */
  const loadResumes = useCallback(async (): Promise<ResumeOption[]> => {
    const library = await fetchResumes(supabase);
    const options = library.map((resume) => ({
      id: resume.id,
      label: resume.label,
    }));
    setResumes(options);
    return options;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    async function loadWorkspace() {
      try {
        setLoading(true);
        setError(null);

        // Independent reads, so one slow call does not serialize the other.
        const [apps, resumeOptions] = await Promise.all([
          fetchApplications(supabase),
          loadResumes(),
        ]);

        setApplications(apps);
        if (apps.length > 0) {
          setSelectedApplicationId(apps[0].id);
          setJobDescriptionDraft(apps[0].jobDescription ?? "");
        }

        // Preselect the default resume so the common case needs no resume step
        // at all. Nothing is invented when the library is empty: selection stays
        // null and the upload control is the only way forward.
        if (resumeOptions.length > 0) {
          setSelectedResumeId(resumeOptions[0].id);
        }
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Failed to load your resumes";
        setError(message);
      } finally {
        setLoading(false);
      }
    }

    loadWorkspace();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedApplication =
    applications.find((app) => app.id === selectedApplicationId) ?? null;

  /**
   * Which step to emphasize. The rules live in `resumeMatchFlowState`, which is
   * unit-tested to guarantee analysis can never gate tailoring — this component
   * only renders the result.
   */
  const flow = resumeMatchFlowState({
    hasResume: selectedResumeId !== null,
    hasJobDescription: jobDescriptionDraft.trim().length > 0,
    hasAnalysis: analysisReady,
  });

  function handleApplicationChange(id: string) {
    setSelectedApplicationId(id);
    const app = applications.find((a) => a.id === id);
    // The application's stored JD seeds the box; the user can still edit it, and
    // an empty stored value stays empty rather than carrying the previous
    // application's text over.
    setJobDescriptionDraft(app?.jobDescription ?? "");
    // A result belongs to the application it was computed for, so switching
    // applications clears the recommendation state rather than carrying a stale
    // "analysis done" signal across.
    setAnalysisReady(false);
  }

  /**
   * A new upload joins the library and becomes the selection immediately.
   *
   * Selecting it before the reload finishes means Analyze is usable at once; the
   * reload only refreshes the dropdown's contents. A failed reload therefore
   * costs the new entry in the list, not the ability to analyze.
   */
  async function handleUploaded(resume: UploadedResumeInfo) {
    setUploadedResume(resume);
    setSelectedResumeId(resume.id);

    setRefreshingResumes(true);
    try {
      await loadResumes();
    } catch {
      // Non-fatal: the uploaded resume is already selected and analyzable.
    } finally {
      setRefreshingResumes(false);
    }
  }

  function openCreateApplication() {
    setCreateError(null);
    setNewRole("");
    setNewCompany("");
    // Seed with whatever JD the user has already pasted, so switching to "new
    // application" mid-thought does not lose their text.
    setNewJobDescription(jobDescriptionDraft);
    setCreatingApplication(true);
  }

  /**
   * Create an application from inside Resume Match and continue here.
   *
   * Uses the SAME `createApplication` and the SAME `applications` model the
   * Applications page uses — no second table, no "resume-match application". The
   * new row therefore appears on Applications and in dashboard reporting exactly
   * like any manual application. `job_portal` is "Manual" so it is never mistaken
   * for a Gmail-imported row, and an unknown employer stores the existing
   * reconcilable "Unknown company" placeholder rather than a fabricated name.
   */
  async function handleCreateApplication(event: React.FormEvent) {
    event.preventDefault();

    const role = newRole.trim();
    const jd = newJobDescription.trim();
    if (role === "") {
      setCreateError("A role or job title is required.");
      return;
    }
    if (jd === "") {
      setCreateError("A job description is required to analyze a match.");
      return;
    }

    const data: ApplicationFormData = {
      company: newCompany.trim() === "" ? "Unknown company" : newCompany.trim(),
      role,
      location: "Not specified",
      // Distinguishes a Resume-Match-created application from a Gmail import,
      // whose portal is "Gmail".
      jobPortal: "Manual",
      appliedDate: new Date().toISOString().slice(0, 10),
      status: "Applied",
      salary: "",
      jobDescription: jd,
    };

    setSavingApplication(true);
    setCreateError(null);
    try {
      const created = await createApplication(supabase, data);
      // Prepend and select it, then continue on this page — no redirect.
      setApplications((prev) => [created, ...prev]);
      setSelectedApplicationId(created.id);
      setJobDescriptionDraft(created.jobDescription ?? jd);
      setCreatingApplication(false);
    } catch (err: unknown) {
      setCreateError(
        err instanceof Error ? err.message : "Failed to create the application."
      );
    } finally {
      setSavingApplication(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-center">
          <div
            className="mb-4 inline-block h-6 w-6 animate-spin rounded-full border-2 border-border-strong border-t-accent"
            aria-hidden="true"
          />
          <p className="text-sm text-text-secondary">Loading your resumes...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="rounded-md border border-danger/20 bg-danger-bg p-6 text-center">
          <p className="text-danger">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          Match your resume to a job
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          Choose a job, pick or upload your resume, and get a match score with the
          skills you are missing.
        </p>
      </div>

      {applications.length === 0 && !creatingApplication ? (
        <div className="rounded-md border border-border bg-surface px-6 py-12 text-center">
          <p className="text-base font-medium text-text">Start your first match</p>
          <p className="mt-1 text-sm text-text-secondary">
            Add the job you want to match against — just a role and its
            description. You can also sync Gmail from the dashboard to bring in
            jobs automatically.
          </p>
          <button
            type="button"
            onClick={openCreateApplication}
            className="mt-4 inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover"
          >
            + New Application
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="space-y-4">
            <div className="space-y-4 rounded-md border border-border bg-surface p-5">
              {creatingApplication ? (
                <form onSubmit={handleCreateApplication} className="space-y-4">
                  <div className="flex items-center justify-between">
                    <StepLabel step={1} label="New application" />
                    {applications.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setCreatingApplication(false)}
                        className="text-xs font-medium text-text-muted hover:text-text"
                      >
                        Cancel
                      </button>
                    )}
                  </div>

                  <div>
                    <label htmlFor="new-role" className="mb-1.5 block text-sm font-medium text-text-secondary">
                      Role / Job title
                    </label>
                    <input
                      id="new-role"
                      type="text"
                      value={newRole}
                      onChange={(e) => setNewRole(e.target.value)}
                      placeholder="e.g. Backend Engineer"
                      className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted focus:border-accent focus:outline-none"
                    />
                  </div>

                  <div>
                    <label htmlFor="new-company" className="mb-1.5 block text-sm font-medium text-text-secondary">
                      Company / Employer <span className="text-text-muted">(optional)</span>
                    </label>
                    <input
                      id="new-company"
                      type="text"
                      value={newCompany}
                      onChange={(e) => setNewCompany(e.target.value)}
                      placeholder="Leave blank if unknown"
                      className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted focus:border-accent focus:outline-none"
                    />
                  </div>

                  <div>
                    <label htmlFor="new-jd" className="mb-1.5 block text-sm font-medium text-text-secondary">
                      Job Description
                    </label>
                    <textarea
                      id="new-jd"
                      value={newJobDescription}
                      onChange={(e) => setNewJobDescription(e.target.value)}
                      rows={8}
                      placeholder="Paste the job description text here..."
                      className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted focus:border-accent focus:outline-none"
                    />
                  </div>

                  {createError && <p className="text-sm text-danger">{createError}</p>}

                  <button
                    type="submit"
                    disabled={savingApplication}
                    className="inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {savingApplication ? "Creating..." : "Create & use this job"}
                  </button>
                </form>
              ) : (
                <>
                  <div>
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <StepLabel step={1} label="Application" as="label" htmlFor="application-select" />
                      <button
                        type="button"
                        onClick={openCreateApplication}
                        className="text-xs font-medium text-accent hover:text-accent-hover"
                      >
                        + New Application
                      </button>
                    </div>
                    <select
                      id="application-select"
                      value={selectedApplicationId ?? ""}
                      onChange={(e) => handleApplicationChange(e.target.value)}
                      className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
                    >
                      {applications.map((app) => (
                        <option key={app.id} value={app.id}>
                          {app.company} — {app.role}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <StepLabel step={2} label="Resume" as="label" htmlFor="resume-select" className="mb-1.5" />
                    {/* Saved resumes first: the whole point is not re-uploading one
                        that is already stored. Rendered only when the library has
                        something in it, so a first-time user sees just the upload
                        control rather than an empty dropdown. */}
                    {resumes.length > 0 && (
                      <select
                        id="resume-select"
                        value={selectedResumeId ?? ""}
                        disabled={refreshingResumes}
                        onChange={(e) => setSelectedResumeId(e.target.value)}
                        className="mb-2 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {resumes.map((resume) => (
                          <option key={resume.id} value={resume.id}>
                            {resume.label}
                          </option>
                        ))}
                      </select>
                    )}
                    {/* Upload stays available and unchanged. It adds to the same
                        stored resumes rather than bypassing them. */}
                    <ResumeUploadStep uploadedResume={uploadedResume} onUploaded={handleUploaded} />
                  </div>

                  <div>
                    <StepLabel step={3} label="Job Description" as="label" htmlFor="job-description" className="mb-1.5" />
                    <textarea
                      id="job-description"
                      value={jobDescriptionDraft}
                      onChange={(e) => setJobDescriptionDraft(e.target.value)}
                      rows={10}
                      placeholder="Paste the job description text here..."
                      className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted focus:border-accent focus:outline-none"
                    />
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="space-y-4">
            {selectedApplication && (
              <div>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <StepLabel step={4} label="Analyze" />
                  {flow.analyzeRecommended && (
                    <span className="text-xs font-medium text-text-muted">
                      Recommended first
                    </span>
                  )}
                </div>
                <IntelligencePanel
                  key={selectedApplication.id}
                  application={selectedApplication}
                  jobDescription={jobDescriptionDraft}
                  // Controlled mode: this page owns resume selection, whether the
                  // resume came from a saved resume or a fresh upload.
                  resumeId={selectedResumeId}
                  // Presentation signal only — see `analysisReady`.
                  onResultChange={setAnalysisReady}
                />
              </div>
            )}

            {/* Tailoring is the RECOMMENDED next step after analysis, but is not
                hard-blocked by it — it needs only a resume and this application's
                JD, both already selected above. `analysisReady` changes only how
                prominent the action looks, never whether it works. */}
            {selectedApplication && (
              <div>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <StepLabel step={5} label="Tailor Resume" />
                  {flow.tailorIsNextStep && (
                    <span className="text-xs font-medium text-accent">
                      Next step
                    </span>
                  )}
                </div>
                <TailorResumePanel
                  applicationId={selectedApplication.id}
                  resumeId={selectedResumeId}
                  applicationLabel={`${selectedApplication.company}-${selectedApplication.role}`}
                  analysisReady={flow.tailorIsNextStep}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

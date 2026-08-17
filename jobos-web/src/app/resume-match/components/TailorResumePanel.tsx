"use client";

import { useCallback, useMemo, useState } from "react";
import {
  assembleTailoredText,
  TAILORING_NOTE,
  type TailoredResume,
} from "@/lib/ai/tailorResume";
import {
  parseResumeDocument,
  resumeFileStem,
} from "@/lib/resume/documentModel";
import {
  TAILOR_BEFORE_ANALYZE_HINT,
  TAILOR_NEEDS_RESUME_HINT,
} from "../flowState";

interface TailorResumePanelProps {
  /** The application whose JD the resume is tailored to. */
  applicationId: string;
  /** The resume being tailored. Null disables the action. */
  resumeId: string | null;
  /** A readable name for the downloaded file. */
  applicationLabel: string;
  /**
   * True once this application has an analysis result. Used ONLY to present
   * tailoring as the recommended next step — it never gates the action.
   */
  analysisReady?: boolean;
}

type TailorStatus = "idle" | "tailoring" | "ready" | "error";
type ExportFormat = "txt" | "docx" | "pdf";
type ViewMode = "preview" | "edit";

/**
 * Tailor Resume — the natural continuation of a Resume Match analysis.
 *
 * Calls `/api/intelligence/tailor`, which reorganizes and rewords only truthful
 * content already in the resume (see the server prompt), then lets the user
 * PREVIEW, EDIT, and export the result.
 *
 * WHAT THE EXPORTS ARE
 *
 *   TXT   assembled client-side from the edited draft, unchanged behavior.
 *   DOCX  a real OOXML document, rendered server-side.
 *   PDF   a real PDF, rendered server-side.
 *
 * All three render the SAME edited draft. The preview is built from the same
 * `parseResumeDocument` model the exporters consume, so what is on screen is
 * what lands in the file. Nothing here can add a fact: there is no control that
 * introduces a skill or achievement, and the export route holds no model access.
 */
export default function TailorResumePanel({
  applicationId,
  resumeId,
  applicationLabel,
  analysisReady = false,
}: TailorResumePanelProps) {
  const [status, setStatus] = useState<TailorStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  /** The editable assembled document. This is what every export renders. */
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState<string>(TAILORING_NOTE);
  /** What the tailoring emphasized/reordered — never new facts. */
  const [changes, setChanges] = useState<string[]>([]);
  const [view, setView] = useState<ViewMode>("preview");
  /** Which export is in flight, so only that button shows progress. */
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const canTailor = resumeId !== null && status !== "tailoring";

  const runTailor = useCallback(async () => {
    if (resumeId === null) return;

    setStatus("tailoring");
    setError(null);
    setExportError(null);

    try {
      const response = await fetch("/api/intelligence/tailor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId, resumeId }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        tailored?: TailoredResume;
        note?: string;
        error?: string;
      };

      if (!response.ok || !data.tailored) {
        throw new Error(data.error ?? "Resume tailoring could not be completed.");
      }

      setDraft(assembleTailoredText(data.tailored));
      setChanges(data.tailored.changes);
      setNote(data.note ?? TAILORING_NOTE);
      setView("preview");
      setStatus("ready");
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Resume tailoring could not be completed."
      );
      setStatus("error");
    }
  }, [applicationId, resumeId]);

  const fileStem = useMemo(
    () => resumeFileStem(applicationLabel),
    [applicationLabel]
  );

  /** The structured view of the CURRENT draft — drives the preview. */
  const preview = useMemo(() => parseResumeDocument(draft), [draft]);

  /** Push bytes to the user as a download. */
  const saveBlob = useCallback((blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, []);

  /**
   * Export the current draft.
   *
   * TXT stays entirely client-side, exactly as before. DOCX and PDF post the
   * SAME draft to the export route, which authorizes the request and renders a
   * genuine document.
   */
  const runExport = useCallback(
    async (format: ExportFormat) => {
      if (draft.trim() === "") return;
      setExportError(null);

      if (format === "txt") {
        saveBlob(
          new Blob([draft], { type: "text/plain;charset=utf-8" }),
          `${fileStem}.txt`
        );
        return;
      }

      setExporting(format);
      try {
        const response = await fetch("/api/resumes/export", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            applicationId,
            // The edited draft, never the original model response.
            content: draft,
            format,
            label: applicationLabel,
          }),
        });

        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(data.error ?? "That resume could not be exported.");
        }

        saveBlob(await response.blob(), `${fileStem}.${format}`);
      } catch (err: unknown) {
        setExportError(
          err instanceof Error ? err.message : "That resume could not be exported."
        );
      } finally {
        setExporting(null);
      }
    },
    [applicationId, applicationLabel, draft, fileStem, saveBlob]
  );

  return (
    <section className="rounded-md border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-text">Tailor resume</h3>
          <p className="mt-0.5 text-xs text-text-muted">
            Rewrite your resume for this job — using only what it already contains.
          </p>
        </div>
        {status !== "ready" && (
          <button
            type="button"
            onClick={() => void runTailor()}
            disabled={!canTailor}
            className={`rounded-md px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              analysisReady
                ? "bg-accent text-accent-fg hover:bg-accent-hover"
                : "border border-border-strong text-text-secondary hover:bg-surface-2"
            }`}
          >
            {status === "tailoring" ? "Tailoring..." : "Tailor Resume"}
          </button>
        )}
      </div>

      {resumeId === null && (
        <p className="mt-3 text-xs text-text-muted">{TAILOR_NEEDS_RESUME_HINT}</p>
      )}

      {/* Tailoring never requires an analysis. This only says which order we
          recommend, and disappears once a result exists. */}
      {resumeId !== null && status === "idle" && !analysisReady && (
        <p className="mt-3 text-xs text-text-muted">{TAILOR_BEFORE_ANALYZE_HINT}</p>
      )}

      {error && (
        <p className="mt-3 rounded-md border border-danger/20 bg-danger-bg px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {status === "ready" && (
        <div className="mt-4 space-y-4">
          <p className="rounded-md border border-success/20 bg-success-bg px-3 py-2 text-xs text-success">
            {note}
          </p>

          {changes.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
                What changed
              </p>
              <ul className="space-y-1">
                {changes.map((change, index) => (
                  <li key={index} className="text-sm text-text-secondary">
                    • {change}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Preview / Edit — the same content, two surfaces. */}
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                Tailored resume
              </span>
              <div
                role="tablist"
                aria-label="Tailored resume view"
                className="inline-flex rounded-md border border-border p-0.5"
              >
                {(["preview", "edit"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="tab"
                    aria-selected={view === mode}
                    onClick={() => setView(mode)}
                    className={`rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                      view === mode
                        ? "bg-surface-2 text-text"
                        : "text-text-muted hover:text-text-secondary"
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            {view === "edit" ? (
              <>
                <label htmlFor="tailored-draft" className="sr-only">
                  Tailored resume content
                </label>
                <textarea
                  id="tailored-draft"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={18}
                  className="w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-xs leading-relaxed text-text focus:border-accent focus:outline-none"
                />
              </>
            ) : (
              /* Rendered from the same model the exporters use, so this is a
                 faithful proof of what the DOCX/PDF will contain. */
              <div className="max-h-[28rem] overflow-y-auto rounded-md border border-border bg-bg px-5 py-4">
                {preview.headerLines.length > 0 && (
                  <div className="mb-3 text-center">
                    {preview.headerLines.map((line, index) => (
                      <p
                        key={index}
                        className={
                          index === 0
                            ? "text-base font-semibold text-text"
                            : "text-xs text-text-secondary"
                        }
                      >
                        {line}
                      </p>
                    ))}
                  </div>
                )}
                {preview.sections.map((section, sectionIndex) => (
                  <div key={sectionIndex} className="mb-3 last:mb-0">
                    <h4 className="border-b border-border pb-1 text-[11px] font-semibold uppercase tracking-wide text-text">
                      {section.heading}
                    </h4>
                    <div className="mt-1.5 space-y-1.5">
                      {section.blocks.map((block, blockIndex) =>
                        block.kind === "bullets" ? (
                          <ul key={blockIndex} className="space-y-1">
                            {block.items.map((item, itemIndex) => (
                              <li
                                key={itemIndex}
                                className="flex gap-2 text-xs leading-relaxed text-text-secondary"
                              >
                                <span aria-hidden="true">·</span>
                                <span>{item}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p
                            key={blockIndex}
                            className={
                              block.emphasized
                                ? "text-xs font-semibold text-text"
                                : "text-xs leading-relaxed text-text-secondary"
                            }
                          >
                            {block.text}
                          </p>
                        )
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {exportError && (
            <p className="rounded-md border border-danger/20 bg-danger-bg px-3 py-2 text-sm text-danger">
              {exportError}
            </p>
          )}

          {/* Export row. DOCX is the primary, recommended output; PDF sits
              beside it; TXT stays available as the plain fallback. */}
          <div className="border-t border-border pt-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                  Export
                </span>
                <button
                  type="button"
                  onClick={() => void runExport("docx")}
                  disabled={exporting !== null}
                  className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {exporting === "docx" ? "Preparing..." : "DOCX"}
                </button>
                <button
                  type="button"
                  onClick={() => void runExport("pdf")}
                  disabled={exporting !== null}
                  className="rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium text-text transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {exporting === "pdf" ? "Preparing..." : "PDF"}
                </button>
                <button
                  type="button"
                  onClick={() => void runExport("txt")}
                  disabled={exporting !== null}
                  className="rounded-md px-2.5 py-1.5 text-sm font-medium text-text-muted transition-colors hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
                >
                  TXT
                </button>
              </div>
              <button
                type="button"
                onClick={() => void runTailor()}
                className="text-xs font-medium text-text-muted transition-colors hover:text-text"
              >
                Re-tailor
              </button>
            </div>
            <p className="mt-2 text-xs text-text-muted">
              DOCX and PDF are formatted as single-column, ATS-friendly documents
              from the content shown above.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

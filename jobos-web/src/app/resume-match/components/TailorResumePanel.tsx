"use client";

import { useCallback, useMemo, useState } from "react";
import {
  assembleTailoredText,
  TAILORING_NOTE,
  validateTailoredResume,
} from "@/lib/ai/tailorResume";
import {
  parseResumeDocument,
  resumeFileStem,
} from "@/lib/resume/documentModel";
import { DEFAULT_RESUME_TEMPLATE, RESUME_PRIORITIES, RESUME_TEMPLATES, formatResumeDocument, resumeLayout, resumePlainText, type ResumeFormatInput } from "@/lib/resume/templates";
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
type ViewMode = "preview" | "edit" | "text";

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
  const [formatting, setFormatting] = useState<ResumeFormatInput>({ templateId: DEFAULT_RESUME_TEMPLATE });
  const layout = resumeLayout(formatting);

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
        signal: AbortSignal.timeout(65_000),
        body: JSON.stringify({ applicationId, resumeId }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        tailored?: unknown;
        note?: string;
        error?: string;
      };

      if (!response.ok || !data.tailored) {
        throw new Error(data.error ?? "Resume tailoring could not be completed.");
      }

      const validated = validateTailoredResume(data.tailored);
      if (!validated.ok) throw new Error("The tailored resume was incomplete. Please try again.");
      setDraft(assembleTailoredText(validated.value));
      setChanges(validated.value.changes);
      setNote(data.note ?? TAILORING_NOTE);
      setView("preview");
      setStatus("ready");
    } catch (err: unknown) {
      setError(
        err instanceof Error && err.name === "TimeoutError" ? "Resume tailoring timed out. Please try again."
          : err instanceof Error ? err.message : "Resume tailoring could not be completed."
      );
      setStatus("error");
    }
  }, [applicationId, resumeId]);

  const fileStem = useMemo(
    () => resumeFileStem(applicationLabel),
    [applicationLabel]
  );

  /** The structured view of the CURRENT draft — drives the preview. */
  const preview = useMemo(() => formatResumeDocument(parseResumeDocument(draft), formatting), [draft, formatting]);
  const exportedDraft = useMemo(() => resumePlainText(preview), [preview]);

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
          new Blob([exportedDraft], { type: "text/plain;charset=utf-8" }),
          `${fileStem}.txt`
        );
        return;
      }

      setExporting(format);
      try {
        const response = await fetch("/api/resumes/export", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(35_000),
          body: JSON.stringify({
            applicationId,
            // The edited draft, never the original model response.
            content: draft,
            format,
            label: applicationLabel,
            formatting,
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
    [applicationId, applicationLabel, draft, exportedDraft, fileStem, formatting, saveBlob]
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

          <details className="rounded-md border border-border p-4" open>
            <summary className="cursor-pointer text-sm font-semibold text-text">Template & formatting</summary>
            <p className="mt-2 text-xs leading-6 text-text-secondary">10 single-column layouts × 5 section priorities. Formatting changes presentation, never your qualifications.</p>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-medium text-text">Resume template
                <select value={formatting.templateId ?? DEFAULT_RESUME_TEMPLATE} disabled={exporting !== null} onChange={event => setFormatting({ templateId: event.target.value })} className="mt-1 block min-h-[44px] w-full px-3 text-sm">
                  {RESUME_PRIORITIES.map(priority => <optgroup key={priority.id} label={priority.name}>{RESUME_TEMPLATES.filter(template => template.priority === priority.id).map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</optgroup>)}
                </select>
              </label>
              <label className="text-xs font-medium text-text">Page size
                <select value={layout.pageSize} disabled={exporting !== null} onChange={event => setFormatting(value => ({ ...value, pageSize: event.target.value as "a4" | "letter" }))} className="mt-1 block min-h-[44px] w-full px-3 text-sm"><option value="a4">A4</option><option value="letter">US Letter</option></select>
              </label>
              <label className="text-xs font-medium text-text">Body text size · {layout.fontSize} pt
                <input aria-label="Resume body text size" type="range" min="10.5" max="12.5" step="0.5" value={layout.fontSize} disabled={exporting !== null} onChange={event => setFormatting(value => ({ ...value, fontSize: Number(event.target.value) }))} className="mt-3 block w-full" />
              </label>
              <label className="text-xs font-medium text-text">Margins · {layout.margin} pt
                <input aria-label="Resume page margins" type="range" min="40" max="72" step="1" value={layout.margin} disabled={exporting !== null} onChange={event => setFormatting(value => ({ ...value, margin: Number(event.target.value) }))} className="mt-3 block w-full" />
              </label>
              <label className="text-xs font-medium text-text">Line spacing · {layout.lineHeight.toFixed(2)}
                <input aria-label="Resume line spacing" type="range" min="1.15" max="1.5" step="0.05" value={layout.lineHeight} disabled={exporting !== null} onChange={event => setFormatting(value => ({ ...value, lineHeight: Number(event.target.value) }))} className="mt-3 block w-full" />
              </label>
            </div>
            <p className="mt-3 text-xs leading-6 text-text-secondary">Text view shows the content and order used for export, not an employer&apos;s ATS score. PDF uses Latin-script standard fonts; choose DOCX to preserve other scripts. Verify the downloaded file before applying.</p>
          </details>
          {/* All views and exports share the same ordered document. */}
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
                {(["preview", "edit", "text"] as const).map((mode) => (
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

            {view === "text" ? <pre className="max-h-[28rem] overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border bg-surface p-4 font-mono text-xs leading-relaxed text-text" aria-label="Resume text reading order">{exportedDraft}</pre> : view === "edit" ? (
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
              <div className="resume-document-preview max-h-[28rem] overflow-y-auto rounded-md border border-border bg-surface px-5 py-4" style={{ fontFamily: layout.font === "serif" ? "Times New Roman, serif" : "Arial, sans-serif", fontSize: `${layout.fontSize}pt`, lineHeight: layout.lineHeight, padding: `${layout.margin / 2}px` }}>
                {preview.headerLines.length > 0 && (
                  <div className="mb-3" style={{ textAlign: layout.centeredHeader ? "center" : "left" }}>
                    {preview.headerLines.map((line, index) => (
                      <p
                        key={index}
                        style={index === 0 ? { fontSize: `${layout.nameSize}pt` } : undefined}
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
                    <h4 className="border-border pb-1 text-[11px] font-semibold uppercase tracking-wide text-text" style={{ borderBottomWidth: layout.sectionRule ? 1 : 0, marginTop: layout.sectionGap }}>
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

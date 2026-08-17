"use client";

import { useEffect } from "react";

/**
 * Blocking confirmation for destructive actions, replacing `window.confirm`.
 *
 * Deliberately minimal: a title, a sentence, cancel and confirm. It follows the
 * modal conventions already used by `ApplicationFormModal` (Escape closes, body
 * scroll locked, `role="dialog"` with `aria-modal`) so it behaves like the rest
 * of the app rather than like a browser prompt.
 */
interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Disables both actions while the confirmed work is in flight. */
  busy?: boolean;
  /**
   * Extra detail below the message.
   *
   * Added for the Gmail reset, where a single sentence cannot honestly convey
   * what is deleted versus preserved — a destructive action needs the scope
   * spelled out, not summarised. Optional, so the existing delete call site is
   * unchanged.
   */
  children?: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  busy = false,
  children,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };

    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Cancel"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onCancel}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        className="relative z-10 w-full max-w-md rounded-lg border border-border bg-surface p-6 shadow-2xl"
      >
        <h2
          id="confirm-dialog-title"
          className="text-lg font-semibold text-text"
        >
          {title}
        </h2>
        <p id="confirm-dialog-message" className="mt-2 text-sm text-text-secondary">
          {message}
        </p>

        {children && <div className="mt-4">{children}</div>}

        {/* Column layout on a phone: two side-by-side buttons at 375px leave
            each one too narrow to read and too small to hit reliably. */}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="min-h-[44px] rounded-md border border-border-strong px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            autoFocus
            // text-accent-fg is #ffffff in BOTH themes, so it is the correct
            // foreground on a filled danger surface. `text-text` was near-black
            // in the light theme and failed contrast on red.
            className="min-h-[44px] rounded-md bg-danger px-4 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Working..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

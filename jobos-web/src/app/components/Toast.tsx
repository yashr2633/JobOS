"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Smallest non-blocking notice this app needs, replacing `window.alert`.
 *
 * One notice at a time: the flows using it (save, delete, duplicate) produce a
 * single outcome per action, so a queue would be machinery with no caller.
 * Success notices dismiss themselves; errors stay until dismissed, because an
 * error the user missed is an error they cannot act on.
 */

export type ToastTone = "success" | "error";

export interface ToastMessage {
  /** Changes on every show, so repeating the same text re-triggers the timer. */
  id: number;
  tone: ToastTone;
  text: string;
}

const AUTO_DISMISS_MS = 4000;

export function useToast() {
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const dismiss = useCallback(() => setToast(null), []);

  const showSuccess = useCallback((text: string) => {
    setToast({ id: Date.now(), tone: "success", text });
  }, []);

  const showError = useCallback((text: string) => {
    setToast({ id: Date.now(), tone: "error", text });
  }, []);

  return { toast, showSuccess, showError, dismiss };
}

interface ToastProps {
  toast: ToastMessage | null;
  onDismiss: () => void;
}

const toneStyles: Record<ToastTone, string> = {
  success: "border-success/30 bg-success-bg text-success",
  error: "border-danger/30 bg-danger-bg text-danger",
};

export default function Toast({ toast, onDismiss }: ToastProps) {
  useEffect(() => {
    if (toast === null || toast.tone !== "success") return;

    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

  if (toast === null) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-6 right-6 z-[60] max-w-sm"
    >
      <div
        className={`flex items-start gap-3 rounded-md border px-4 py-3 shadow-lg shadow-border-strong/50 backdrop-blur-sm ${toneStyles[toast.tone]}`}
      >
        <p className="flex-1 text-sm">{toast.text}</p>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss notification"
          className="rounded p-0.5 text-current opacity-70 transition-opacity hover:opacity-100"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18 18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

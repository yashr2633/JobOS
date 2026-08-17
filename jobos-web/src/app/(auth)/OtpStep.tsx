"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  OTP_LENGTH,
  maskEmail,
  normalizeOtp,
  resendCooldownRemaining,
  validateOtp,
} from "@/lib/account/otp";

interface OtpStepProps {
  /** Where the code was sent. Shown masked, so the user can spot a typo. */
  email: string;
  /** Verify the code. Resolves on success; rejects with a human message. */
  onVerify: (code: string) => Promise<void>;
  /** Request another code. Rejects with a human message. */
  onResend: () => Promise<void>;
  /** When the last code was sent, for the cooldown. */
  lastSentAt: number | null;
  /** Abandon the code flow and go back to the previous step. */
  onBack: () => void;
  /** Heading, so signup and sign-in can word it appropriately. */
  title?: string;
  description?: string;
}

/**
 * The shared "enter the code we emailed you" step.
 *
 * One component for both signup confirmation and code sign-in, so the two cannot
 * drift in validation, cooldown behaviour, or error wording. It holds no auth
 * logic of its own: verification and resending are injected, and both are
 * Supabase Auth calls in the parent.
 *
 * Details that matter:
 *  - `inputMode="numeric"` + `autoComplete="one-time-code"` so a phone shows a
 *    number pad and iOS/Android offer the code from the notification.
 *  - Input is normalized on every keystroke, so a pasted "123 456" is accepted.
 *  - The cooldown ticks down visibly rather than leaving a dead button.
 *  - Submitting is blocked until the code is the full length, so an incomplete
 *    code never spends an attempt against the provider's rate limit.
 */
export default function OtpStep({
  email,
  onVerify,
  onResend,
  lastSentAt,
  onBack,
  title = "Enter your code",
  description,
}: OtpStepProps) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"verify" | "resend" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(() =>
    resendCooldownRemaining(lastSentAt)
  );
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the field on arrival: the user is here to type one thing.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Tick the cooldown so the button explains the wait instead of just being
  // disabled. Cleared as soon as it reaches zero, so there is no idle interval.
  useEffect(() => {
    setRemaining(resendCooldownRemaining(lastSentAt));
    if (lastSentAt === null) return;

    const timer = setInterval(() => {
      const next = resendCooldownRemaining(lastSentAt);
      setRemaining(next);
      if (next === 0) clearInterval(timer);
    }, 1000);

    return () => clearInterval(timer);
  }, [lastSentAt]);

  const handleVerify = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setNotice(null);

      const validation = validateOtp(code);
      if (!validation.ok) {
        setError(validation.error);
        return;
      }

      setBusy("verify");
      setError(null);
      try {
        await onVerify(validation.code);
        // On success the parent navigates; no state reset needed here.
      } catch (err: unknown) {
        setError(
          err instanceof Error ? err.message : "We could not verify that code."
        );
        setBusy(null);
      }
    },
    [code, onVerify]
  );

  const handleResend = useCallback(async () => {
    setBusy("resend");
    setError(null);
    setNotice(null);
    try {
      await onResend();
      setCode("");
      setNotice("A new code is on its way.");
      inputRef.current?.focus();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "We could not send another code."
      );
    } finally {
      setBusy(null);
    }
  }, [onResend]);

  const complete = code.length === OTP_LENGTH;

  return (
    <form onSubmit={handleVerify} className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text">{title}</h1>
        <p className="mt-1 text-sm text-text-secondary">
          {description ?? (
            <>
              We sent a {OTP_LENGTH}-digit code to{" "}
              <span className="font-medium text-text">{maskEmail(email)}</span>.
            </>
          )}
        </p>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-danger/20 bg-danger-bg px-3 py-2.5 text-sm text-danger"
        >
          {error}
        </p>
      )}

      {notice && !error && (
        <p
          role="status"
          className="rounded-md border border-success/20 bg-success-bg px-3 py-2.5 text-sm text-success"
        >
          {notice}
        </p>
      )}

      <div>
        <label
          htmlFor="otp-code"
          className="block text-sm font-medium text-text-secondary"
        >
          Verification code
        </label>
        <input
          ref={inputRef}
          id="otp-code"
          name="otp-code"
          type="text"
          value={code}
          onChange={(e) => {
            setCode(normalizeOtp(e.target.value));
            setError(null);
          }}
          // A phone shows a number pad, and the OS offers the code it just
          // received in a notification.
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={OTP_LENGTH}
          aria-invalid={error !== null || undefined}
          placeholder="000000"
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2.5 text-center font-mono text-lg tracking-[0.4em] text-text placeholder:text-text-muted placeholder:tracking-[0.3em] focus:border-accent focus:outline-none"
        />
      </div>

      <button
        type="submit"
        disabled={busy !== null || !complete}
        className="min-h-[44px] w-full rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy === "verify" ? "Verifying..." : "Verify and continue"}
      </button>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <button
          type="button"
          onClick={onBack}
          disabled={busy !== null}
          className="font-medium text-text-muted transition-colors hover:text-text disabled:opacity-50"
        >
          Use a different email
        </button>

        <button
          type="button"
          onClick={() => void handleResend()}
          disabled={busy !== null || remaining > 0}
          className="font-medium text-accent transition-colors hover:text-accent-hover disabled:cursor-not-allowed disabled:text-text-muted"
        >
          {busy === "resend"
            ? "Sending..."
            : remaining > 0
              ? `Resend in ${remaining}s`
              : "Resend code"}
        </button>
      </div>
    </form>
  );
}

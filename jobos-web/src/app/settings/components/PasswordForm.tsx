"use client";

import { useCallback, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { MIN_PASSWORD_LENGTH, validateNewPassword } from "@/lib/account/profile";
import SettingsCard from "./SettingsCard";

/**
 * Change password.
 *
 * SECURITY POSTURE — deliberate and narrow
 *
 *  - The new password goes straight to `supabase.auth.updateUser({ password })`.
 *    This app never hashes, stores, compares, logs, or transmits a password
 *    anywhere else. There is no custom credential storage.
 *  - Supabase authorizes the change against the caller's own active session, so
 *    one user cannot change another's password.
 *  - The value lives in component state for the life of the form and is cleared
 *    on success. It is never written to localStorage, sessionStorage, or a cookie.
 *  - `autoComplete="new-password"` so a password manager offers to generate and
 *    store one rather than autofilling the old value.
 *  - Local validation only produces a faster, more specific message; the provider
 *    stays authoritative and its error is surfaced verbatim when it refuses.
 *
 * A current-password field is intentionally absent: Supabase re-authorizes from
 * the live session, so collecting the old password would be security theatre that
 * the API does not verify.
 */
type State = "idle" | "saving" | "saved" | "error";

export default function PasswordForm({ canChange }: { canChange: boolean }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [reveal, setReveal] = useState(false);
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();

      const validation = validateNewPassword(password, confirmation);
      if (!validation.ok) {
        setError(validation.error);
        setState("error");
        return;
      }

      setState("saving");
      setError(null);

      try {
        const supabase = createClient();
        const { error: updateError } = await supabase.auth.updateUser({
          password,
        });

        if (updateError) throw new Error(updateError.message);

        // Clear immediately: there is no reason to keep the value in memory.
        setPassword("");
        setConfirmation("");
        setReveal(false);
        setState("saved");
      } catch (err: unknown) {
        setError(
          err instanceof Error
            ? err.message
            : "Your password could not be changed. Please try again."
        );
        setState("error");
      }
    },
    [password, confirmation]
  );

  if (!canChange) {
    return (
      <SettingsCard
        title="Password"
        description="This account signs in with an external provider, so there is no JobTrackOS password to change. Manage your credentials with that provider."
      />
    );
  }

  const inputType = reveal ? "text" : "password";

  return (
    <form onSubmit={handleSubmit}>
      <SettingsCard
        title="Password"
        description={`Choose a new password of at least ${MIN_PASSWORD_LENGTH} characters, including a letter and a number.`}
        footer={
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={state === "saving"}
              className="rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {state === "saving" ? "Updating..." : "Update password"}
            </button>

            {state === "saved" && (
              <span role="status" className="text-sm text-success">
                Password updated.
              </span>
            )}
            {state === "error" && error && (
              <span role="alert" className="text-sm text-danger">
                {error}
              </span>
            )}
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="new-password"
              className="mb-1.5 block text-sm font-medium text-text-secondary"
            >
              New password
            </label>
            <input
              id="new-password"
              name="new-password"
              type={inputType}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setState("idle");
                setError(null);
              }}
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              aria-invalid={state === "error" || undefined}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="confirm-password"
              className="mb-1.5 block text-sm font-medium text-text-secondary"
            >
              Confirm new password
            </label>
            <input
              id="confirm-password"
              name="confirm-password"
              type={inputType}
              value={confirmation}
              onChange={(e) => {
                setConfirmation(e.target.value);
                setState("idle");
                setError(null);
              }}
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              aria-invalid={state === "error" || undefined}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
            />
          </div>
        </div>

        <label className="mt-3 inline-flex items-center gap-2 text-sm text-text-secondary">
          <input
            type="checkbox"
            checked={reveal}
            onChange={(e) => setReveal(e.target.checked)}
            className="h-4 w-4 rounded border-border-strong accent-accent"
          />
          Show passwords
        </label>
      </SettingsCard>
    </form>
  );
}

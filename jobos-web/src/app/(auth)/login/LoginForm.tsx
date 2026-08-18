"use client";

import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import {
  VERIFY_OTP_TYPE,
  describeOtpError,
  isPlausibleEmail,
} from "@/lib/account/otp";
import { buildSupabaseOAuthCallbackUrl } from "@/lib/supabase/oauthRedirect";
import OtpStep from "../OtpStep";

/** Why a previous sign-in attempt did not produce a session. */
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  provider: "Google sign-in was cancelled or refused. Please try again.",
  missing_code:
    "Google sign-in did not return an authorization code. Please try again.",
  exchange:
    "We could not complete Google sign-in. Please try again, or use your email and password.",
};

/**
 * Turn a provider error into something a person can act on.
 *
 * Supabase returns "Invalid login credentials" for both a wrong password and an
 * unknown address — deliberately, so the form must not claim to know which. It is
 * reworded to say what to do rather than leaving the raw API string on screen.
 */
function describeSignInError(message: string): string {
  const normalized = message.toLowerCase();

  if (normalized.includes("invalid login credentials")) {
    return "That email and password combination did not match. Check both and try again.";
  }
  if (normalized.includes("email not confirmed")) {
    return "Please confirm your email address first — check your inbox for the verification code.";
  }
  if (normalized.includes("rate limit") || normalized.includes("too many")) {
    return "Too many attempts. Please wait a moment and try again.";
  }
  if (normalized.includes("failed to fetch") || normalized.includes("network")) {
    return "We could not reach the server. Check your connection and try again.";
  }
  return message;
}

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [revealPassword, setRevealPassword] = useState(false);
  const [loading, setLoading] = useState<"email" | "google" | "code" | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  /** Which sign-in method the user is using. Password is the default. */
  const [method, setMethod] = useState<"password" | "code">("password");
  /** True once a code has been emailed and the code step is showing. */
  const [awaitingCode, setAwaitingCode] = useState(false);
  const [codeSentAt, setCodeSentAt] = useState<number | null>(null);

  const supabase = createClient();

  // Only allow relative same-origin destinations, so ?next= cannot be used to
  // redirect a freshly authenticated user off-site.
  const rawNext = searchParams.get("next");
  const next =
    rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//")
      ? rawNext
      : "/";

  const authErrorKey = searchParams.get("auth_error");
  const authErrorMessage = authErrorKey
    ? AUTH_ERROR_MESSAGES[authErrorKey] ??
      "We could not complete sign-in. Please try again."
    : null;

  const busy = loading !== null;

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading("email");

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) throw new Error(signInError.message);

      router.push(next);
      router.refresh();
    } catch (err: unknown) {
      setError(
        describeSignInError(
          err instanceof Error ? err.message : "Failed to log in."
        )
      );
      setLoading(null);
    }
    // No `finally`: on success the router navigates away, and clearing the
    // loading state first would flash an enabled button mid-navigation.
  }

  /**
   * Request an email sign-in code.
   *
   * `shouldCreateUser: false` is the important option: without it Supabase would
   * silently CREATE an account for an unrecognised address, turning the sign-in
   * form into a hidden signup and letting anyone provision accounts for emails
   * they do not own. Sign-up stays on the signup page.
   */
  async function requestSignInCode(event?: React.FormEvent) {
    event?.preventDefault();
    setError(null);

    if (!isPlausibleEmail(email)) {
      setError("Enter a valid email address.");
      return;
    }

    setLoading("code");
    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { shouldCreateUser: false },
      });

      if (otpError) throw new Error(describeOtpError(otpError.message));

      setCodeSentAt(Date.now());
      setAwaitingCode(true);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "We could not send a code."
      );
    } finally {
      setLoading(null);
    }
  }

  /** Verify the emailed sign-in code. Supabase validates it and mints the session. */
  async function verifySignInCode(code: string): Promise<void> {
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code,
      type: VERIFY_OTP_TYPE.signin,
    });

    if (verifyError) throw new Error(describeOtpError(verifyError.message));

    router.push(next);
    router.refresh();
  }

  /** Resend, reusing the same guarded request path. */
  async function resendSignInCode(): Promise<void> {
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false },
    });

    if (otpError) throw new Error(describeOtpError(otpError.message));
    setCodeSentAt(Date.now());
  }

  async function handleGoogleLogin() {
    setError(null);
    setLoading("google");

    try {
      // Supabase Auth flow only. The `next` hop is carried through the
      // callback so the user resumes their intended destination.
      const callbackUrl = buildSupabaseOAuthCallbackUrl(
        window.location.origin,
        next
      );

      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: callbackUrl },
      });

      if (oauthError) throw new Error(oauthError.message);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to log in with Google."
      );
      setLoading(null);
    }
  }

  const inputClass =
    "mt-1 w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-text placeholder:text-text-muted focus:border-accent focus:outline-none";

  // The code step replaces the form while a code is outstanding.
  if (awaitingCode) {
    return (
      <div className="rounded-md border border-border bg-surface p-6 sm:p-8">
        <OtpStep
          email={email}
          lastSentAt={codeSentAt}
          onVerify={verifySignInCode}
          onResend={resendSignInCode}
          onBack={() => {
            setAwaitingCode(false);
            setCodeSentAt(null);
            setError(null);
          }}
          title="Check your email"
        />
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border bg-surface p-6 sm:p-8">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          Welcome back
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          Sign in to JobTrackOS
        </p>
      </div>

      {/* Two clear sign-in methods. A segmented control rather than a hidden
          link, so the code option is discoverable without being pushed. */}
      <div
        role="tablist"
        aria-label="Sign-in method"
        className="mb-5 inline-flex w-full rounded-md border border-border p-0.5"
      >
        {(
          [
            { value: "password", label: "Password" },
            { value: "code", label: "Login with code" },
          ] as const
        ).map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={method === option.value}
            onClick={() => {
              setMethod(option.value);
              setError(null);
            }}
            className={`min-h-[36px] flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors ${
              method === option.value
                ? "bg-surface-2 text-text"
                : "text-text-muted hover:text-text-secondary"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {(error || authErrorMessage) && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-danger/20 bg-danger-bg px-3 py-2.5 text-sm text-danger"
        >
          {error ?? authErrorMessage}
        </div>
      )}

      <form
        onSubmit={method === "password" ? handleEmailLogin : requestSignInCode}
        className="space-y-4"
      >
        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-text-secondary"
          >
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            className={inputClass}
            placeholder="you@example.com"
          />
        </div>

        {method === "code" ? (
          <>
            <p className="text-sm text-text-secondary">
              We&apos;ll email you a 6-digit code. No password needed.
            </p>
            <button
              type="submit"
              disabled={busy}
              className="min-h-[44px] w-full rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading === "code" ? "Sending code..." : "Email me a code"}
            </button>
          </>
        ) : (
        <>
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <label
              htmlFor="password"
              className="block text-sm font-medium text-text-secondary"
            >
              Password
            </label>
            {/* Visibility toggle rather than a permanently masked field: on a
                phone keyboard a mistyped password is the most common reason a
                correct one appears to fail. */}
            <button
              type="button"
              onClick={() => setRevealPassword((prev) => !prev)}
              className="text-xs font-medium text-text-muted transition-colors hover:text-text-secondary"
            >
              {revealPassword ? "Hide" : "Show"}
            </button>
          </div>
          <input
            id="password"
            type={revealPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            className={inputClass}
            placeholder="Your password"
          />
        </div>

        <button
          type="submit"
          disabled={busy}
          // text-accent-fg, not text-text: the accent is a dark indigo in the
          // light theme, so body-text colour on it would fail contrast.
          className="min-h-[44px] w-full rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading === "email" ? "Logging in..." : "Log in"}
        </button>
        </>
        )}
      </form>

      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs text-text-muted">Or continue with</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <button
        type="button"
        onClick={() => void handleGoogleLogin()}
        disabled={busy}
        className="flex min-h-[44px] w-full items-center justify-center gap-3 rounded-md border border-border-strong bg-surface px-4 py-2.5 text-sm font-medium text-text transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="currentColor"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          />
          <path
            fill="currentColor"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="currentColor"
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
          />
          <path
            fill="currentColor"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          />
        </svg>
        {loading === "google" ? "Redirecting..." : "Continue with Google"}
      </button>

      <p className="mt-5 text-center text-sm text-text-secondary">
        Don&apos;t have an account?{" "}
        <Link
          href="/signup"
          className="font-medium text-accent hover:text-accent-hover"
        >
          Sign up
        </Link>
      </p>
    </div>
  );
}

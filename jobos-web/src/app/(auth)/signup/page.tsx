"use client";

import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { MIN_PASSWORD_LENGTH, validateNewPassword } from "@/lib/account/profile";
import {
  VERIFY_OTP_TYPE,
  describeOtpError,
  isPlausibleEmail,
} from "@/lib/account/otp";
import { buildSupabaseOAuthCallbackUrl } from "@/lib/supabase/oauthRedirect";
import OtpStep from "../OtpStep";

/** Turn a provider error into something actionable. */
function describeSignUpError(message: string): string {
  const normalized = message.toLowerCase();

  if (normalized.includes("already registered") || normalized.includes("already been registered")) {
    return "An account already exists for that email. Try logging in instead.";
  }
  if (normalized.includes("invalid email")) {
    return "That email address does not look valid. Please check it.";
  }
  if (normalized.includes("weak password") || normalized.includes("password should be")) {
    return `Choose a stronger password of at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (normalized.includes("rate limit") || normalized.includes("too many")) {
    return "Too many attempts. Please wait a moment and try again.";
  }
  if (
    normalized.includes("error sending confirmation email") ||
    normalized.includes("confirmation email") ||
    normalized.includes("sending email")
  ) {
    return "We could not send your confirmation code. Check the configured email provider and try again.";
  }
  if (normalized.includes("failed to fetch") || normalized.includes("network")) {
    return "We could not reach the server. Check your connection and try again.";
  }
  return message;
}

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [revealPassword, setRevealPassword] = useState(false);
  const [loading, setLoading] = useState<"email" | "google" | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * True once the account is created and Supabase has emailed a confirmation
   * code. The form is replaced by the code step — the account is not usable
   * until the code is verified.
   */
  const [awaitingCode, setAwaitingCode] = useState(false);
  /** When the last code was sent, for the resend cooldown. */
  const [codeSentAt, setCodeSentAt] = useState<number | null>(null);

  const supabase = createClient();
  const busy = loading !== null;

  /**
   * Verify the emailed signup code.
   *
   * `verifyOtp` with type 'signup' is Supabase's own confirmation mechanism: it
   * validates the code server-side and returns a session. We never see, store, or
   * compare the code ourselves.
   */
  async function verifySignupCode(code: string): Promise<void> {
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code,
      type: VERIFY_OTP_TYPE.signup,
    });

    if (verifyError) throw new Error(describeOtpError(verifyError.message));

    // Verified: a session now exists, so land the user in the product.
    router.push("/");
    router.refresh();
  }

  /** Ask Supabase to email another signup code. */
  async function resendSignupCode(): Promise<void> {
    const { error: resendError } = await supabase.auth.resend({
      type: "signup",
      email: email.trim(),
    });

    if (resendError) throw new Error(describeOtpError(resendError.message));
    setCodeSentAt(Date.now());
  }

  async function handleEmailSignup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!isPlausibleEmail(email)) {
      setError("Enter a valid email address.");
      return;
    }

    // Checked locally first so the rule is stated once and the user gets an
    // immediate, specific message. The provider remains authoritative.
    const check = validateNewPassword(password, password);
    if (!check.ok) {
      setError(check.error);
      return;
    }

    setLoading("email");

    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });

      if (signUpError) throw new Error(signUpError.message);

      // No session means Supabase requires email confirmation, and has just
      // emailed a code. Move to the code step rather than redirecting into a
      // protected route the user cannot reach yet.
      if (!data.session) {
        setCodeSentAt(Date.now());
        setAwaitingCode(true);
        setLoading(null);
        return;
      }

      // Confirmation is disabled on this project, so the account is already
      // usable and there is no code to enter.
      router.push("/");
      router.refresh();
    } catch (err: unknown) {
      setError(
        describeSignUpError(
          err instanceof Error ? err.message : "Failed to sign up."
        )
      );
      setLoading(null);
    }
  }

  async function handleGoogleSignup() {
    setError(null);
    setLoading("google");

    try {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: buildSupabaseOAuthCallbackUrl(window.location.origin),
        },
      });

      if (oauthError) throw new Error(oauthError.message);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to sign up with Google."
      );
      setLoading(null);
    }
  }

  const inputClass =
    "mt-1 w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-text placeholder:text-text-muted focus:border-accent focus:outline-none";

  // The code step replaces the form entirely: the account exists but is not
  // verified, so re-submitting the form would only error.
  if (awaitingCode) {
    return (
      <div className="rounded-md border border-border bg-surface p-6 sm:p-8">
        <OtpStep
          email={email}
          lastSentAt={codeSentAt}
          onVerify={verifySignupCode}
          onResend={resendSignupCode}
          onBack={() => {
            setAwaitingCode(false);
            setCodeSentAt(null);
            setError(null);
          }}
          title="Confirm your email"
          description={undefined}
        />
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border bg-surface p-6 sm:p-8">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          Create your JobTrackOS account
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          Know where your career stands.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-danger/20 bg-danger-bg px-3 py-2.5 text-sm text-danger"
        >
          {error}
        </div>
      )}

      <form onSubmit={handleEmailSignup} className="space-y-4">
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

        <div>
          <div className="flex items-baseline justify-between gap-2">
            <label
              htmlFor="password"
              className="block text-sm font-medium text-text-secondary"
            >
              Password
            </label>
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
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            aria-describedby="password-requirements"
            className={inputClass}
            placeholder="Choose a password"
          />
          {/* The stated rule is the one actually enforced, from the shared policy. */}
          <p id="password-requirements" className="mt-1 text-xs text-text-muted">
            At least {MIN_PASSWORD_LENGTH} characters, including a letter and a
            number.
          </p>
        </div>

        <button
          type="submit"
          disabled={busy}
          className="min-h-[44px] w-full rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading === "email" ? "Creating account..." : "Sign up"}
        </button>
      </form>

      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs text-text-muted">Or continue with</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <button
        type="button"
        onClick={() => void handleGoogleSignup()}
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
        Already have an account?{" "}
        <Link
          href="/login"
          className="font-medium text-accent hover:text-accent-hover"
        >
          Log in
        </Link>
      </p>
    </div>
  );
}

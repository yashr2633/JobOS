/**
 * Login page.
 *
 * A thin server wrapper. The interactive form reads `next` and `auth_error`
 * from the query string via useSearchParams(), which Next requires to sit
 * inside a Suspense boundary so the shell can still be prerendered.
 */

import { Suspense } from "react";
import LoginForm from "./LoginForm";

function LoginFallback() {
  return (
    <div className="rounded-lg border border-border-strong/50 bg-surface/50 p-8 backdrop-blur-sm">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-semibold text-text">Welcome back</h1>
        <p className="mt-2 text-sm text-text-secondary">Log in to your JobTrackOS account</p>
      </div>
      <div className="h-64 animate-pulse rounded-md bg-surface-2/40" />
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginForm />
    </Suspense>
  );
}
/**
 * GET /auth/callback
 *
 * The single Supabase Auth code-exchange endpoint. Used by "Continue with
 * Google" and by email-confirmation links.
 *
 * Entirely separate from /api/gmail/callback: this establishes the JobTrackOS login
 * session, that one only obtains Gmail API authorization.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Only allow same-origin relative paths as a post-login destination, so a
 * crafted link cannot turn the callback into an open redirect.
 */
function safeNextPath(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

/**
 * Strip credential-shaped substrings before anything is logged.
 *
 * Supabase reports upstream failures as e.g.
 *   "Unable to exchange external code: 4/0AVMBsJ..."
 * which embeds the Google authorization code. That must never reach a log
 * sink, so long opaque runs are redacted.
 */
function redactCredentials(text: string): string {
  return text
    .replace(/4\/[\w-]+/g, "4/[redacted]")
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, "[redacted]");
}

/**
 * Classify a provider-side failure into a stable reason code.
 *
 * "Unable to exchange external code" is emitted by Supabase's own GoTrue when
 * ITS server-to-server call to Google's token endpoint is rejected. Nothing in
 * this application participates in that exchange, so it is always a provider
 * credential/redirect configuration problem and is worth its own reason so the
 * login page can say what to check.
 */
function classifyProviderError(description: string): string {
  const normalized = description.toLowerCase();

  if (normalized.includes("unable to exchange external code")) {
    return "provider_exchange";
  }
  if (normalized.includes("access_denied") || normalized.includes("denied")) {
    return "provider_denied";
  }
  return "provider";
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = requestUrl.origin;

  const code = requestUrl.searchParams.get("code");
  const next = safeNextPath(requestUrl.searchParams.get("next"));

  // Provider-side failure. Supabase may report this in the query string or in
  // the URL fragment; a fragment never reaches the server, so the login page
  // also inspects location.hash.
  const providerErrorDescription =
    requestUrl.searchParams.get("error_description") ??
    requestUrl.searchParams.get("error");

  if (providerErrorDescription) {
    const reason = classifyProviderError(providerErrorDescription);
    // Redacted: the raw description can contain the authorization code.
    console.error(
      "[auth/callback] Provider error:",
      reason,
      redactCredentials(providerErrorDescription)
    );
    return NextResponse.redirect(
      new URL(`/login?auth_error=${reason}`, origin)
    );
  }

  if (!code) {
    // Previously this still redirected to "/", where middleware saw no session
    // and bounced to /login with no explanation.
    return NextResponse.redirect(
      new URL("/login?auth_error=missing_code", origin)
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error(
      "[auth/callback] Code exchange failed:",
      redactCredentials(error.message)
    );
    return NextResponse.redirect(new URL("/login?auth_error=exchange", origin));
  }

  return NextResponse.redirect(new URL(next, origin));
}

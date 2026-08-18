/**
 * Google OAuth utilities for the Gmail integration.
 *
 * SERVER ONLY. This module reads GOOGLE_CLIENT_SECRET and must never be
 * imported from a client component.
 *
 * This flow is completely separate from Supabase Auth ("Continue with
 * Google"). Supabase owns the login session; this module only obtains Gmail
 * API authorization for an already-authenticated JobTrackOS user.
 */

/**
 * Scopes requested for the Gmail integration.
 *
 * - gmail.readonly : the actual capability we need (read job-related email).
 * - openid + email : the MINIMUM required to receive an `id_token`, which is
 *   the only reliable way to learn Google's stable subject identifier (`sub`).
 *   Identity binding is a hard requirement, and `sub` cannot be obtained from
 *   a gmail.readonly-only grant.
 */
export const GMAIL_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
] as const;

/** Name of the httpOnly cookie holding the pending OAuth state. */
export const GMAIL_STATE_COOKIE = "gmail_oauth_state";

/** Pending-state lifetime. Short enough to bound replay, long enough to consent. */
export const GMAIL_STATE_MAX_AGE_SECONDS = 600;

/** The canonical production callback used when Vercel has no explicit override. */
export const PRODUCTION_GMAIL_REDIRECT_URI =
  "https://jobtrackos.vercel.app/api/gmail/callback";

/** The local callback used outside Vercel production. */
export const LOCAL_GMAIL_REDIRECT_URI =
  "http://localhost:3000/api/gmail/callback";

/**
 * Redirect URI Google sends the browser back to.
 *
 * Must exactly match an Authorized redirect URI in the Google Cloud OAuth
 * client, and must be identical on the authorize and token-exchange calls or
 * Google rejects the exchange with redirect_uri_mismatch. An explicit value
 * always wins; otherwise Vercel production uses the deployed callback and
 * local/non-Vercel development uses localhost.
 */
export function getGmailRedirectUri(): string {
  const configured = process.env.GMAIL_OAUTH_REDIRECT_URI?.trim();
  if (configured) return configured;

  return process.env.VERCEL_ENV === "production"
    ? PRODUCTION_GMAIL_REDIRECT_URI
    : LOCAL_GMAIL_REDIRECT_URI;
}

/** Cryptographically secure, unpredictable state value. */
export function generateOAuthState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Constant-time string comparison.
 *
 * A plain `===` on a secret leaks length/prefix information through timing.
 * The cost is negligible here and removes the whole class of issue.
 */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Serialize the pending state so it is bound to one JobTrackOS user.
 *
 * Storing the user id alongside the state means a state minted for user A can
 * never be redeemed by a session belonging to user B, even if the cookie is
 * somehow replayed into another browser session.
 */
export function encodePendingState(userId: string, state: string): string {
  return `${userId}.${state}`;
}

export function decodePendingState(
  raw: string
): { userId: string; state: string } | null {
  const separator = raw.indexOf(".");
  if (separator <= 0 || separator === raw.length - 1) return null;
  return {
    userId: raw.slice(0, separator),
    state: raw.slice(separator + 1),
  };
}

/** Validate a returned state against the server-stored pending state. */
export function validateOAuthState(
  storedState: string,
  receivedState: string
): boolean {
  return safeEqual(storedState, receivedState);
}

/** Build the Google authorization URL the browser is sent to. */
export function buildOAuthUrl(state: string): string {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  if (!clientId) {
    throw new Error("GOOGLE_CLIENT_ID is not configured");
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getGmailRedirectUri(),
    response_type: "code",
    scope: GMAIL_SCOPES.join(" "),
    // offline + consent are required to reliably receive a refresh_token.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export interface GoogleTokenSet {
  accessToken: string;
  /** Google omits this on re-consent in some cases; caller must keep the old one. */
  refreshToken: string | null;
  expiresAt: string;
  /** Stable Google subject identifier, taken from the id_token. */
  googleSub: string;
  /** Present when the `email` scope was granted. Diagnostic only, never the security primitive. */
  email: string | null;
  grantedScopes: string[];
}

/**
 * Decode a JWT payload without verifying the signature.
 *
 * Safe here and only here: the id_token is read from the direct TLS response
 * of Google's token endpoint, authenticated by our client secret. It never
 * passes through the browser, so there is no untrusted hop to forge it.
 */
function decodeIdTokenPayload(idToken: string): Record<string, unknown> {
  const segments = idToken.split(".");
  if (segments.length !== 3) {
    throw new Error("Malformed id_token");
  }
  const payload = Buffer.from(segments[1], "base64url").toString("utf8");
  const parsed = JSON.parse(payload) as unknown;
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Malformed id_token payload");
  }
  return parsed as Record<string, unknown>;
}

/**
 * Exchange the authorization code for tokens and the Google subject id.
 *
 * The client secret is sent only to Google over TLS. Neither the code nor any
 * token is ever returned to the browser.
 */
export async function exchangeCodeForTokens(
  code: string
): Promise<GoogleTokenSet> {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth credentials are not configured");
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: getGmailRedirectUri(),
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) {
    // Read as text: a non-JSON error body must not mask the real status.
    const detail = await response.text().catch(() => "");
    // Length only — never echo the body, which can contain the code.
    throw new Error(
      `Google token exchange failed (HTTP ${response.status}, ${detail.length} chars)`
    );
  }

  const data = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    expires_in?: number;
    scope?: string;
  };

  if (!data.access_token) {
    throw new Error("Google token response contained no access_token");
  }
  if (!data.id_token) {
    throw new Error("Google token response contained no id_token");
  }

  const claims = decodeIdTokenPayload(data.id_token);
  const googleSub = typeof claims.sub === "string" ? claims.sub : null;
  if (!googleSub) {
    throw new Error("Google id_token contained no sub claim");
  }

  const expiresIn =
    typeof data.expires_in === "number" && data.expires_in > 0
      ? data.expires_in
      : 3600;

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    googleSub,
    email: typeof claims.email === "string" ? claims.email : null,
    grantedScopes: data.scope ? data.scope.split(" ") : [],
  };
}

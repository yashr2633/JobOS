/**
 * Server-side Gmail access-token lifecycle.
 *
 * SERVER ONLY. This module reads GOOGLE_CLIENT_SECRET and handles OAuth
 * refresh tokens. It must never be imported from a client component; the
 * runtime guard below turns an accidental import into an immediate, obvious
 * failure rather than a silent credential leak into the browser bundle.
 *
 * Nothing here is part of the login flow. Supabase owns the JobTrackOS session;
 * these tokens only authorize Gmail API reads for an already-authenticated
 * user.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
// Relative + explicit .ts extension, matching the convention in lib/ai/ so
// these modules stay runnable under `node --test` without a bundler.
import {
  getGmailTokensForServer,
  saveRefreshedGmailTokens,
  deactivateGmailConnection,
} from "../api/gmail.ts";

/**
 * Refresh when the access token expires within this window.
 *
 * A token that is technically still valid but expires mid-request would fail
 * halfway through a batch, so it is renewed proactively.
 */
export const TOKEN_EXPIRY_SKEW_MS = 5 * 60 * 1000;

/** Google's token endpoint. Reached only from the server. */
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/**
 * The user must re-authorize Gmail before tracking can continue.
 *
 * Raised when Google rejects the refresh token outright (revoked access,
 * password change, deleted grant). Callers surface this as an actionable
 * "reconnect Gmail" state; it is never a crash.
 */
export class GmailReconnectRequiredError extends Error {
  constructor(message = "Gmail access needs to be reconnected.") {
    super(message);
    this.name = "GmailReconnectRequiredError";
  }
}

/** Raised when no active Gmail connection exists for the user. */
export class GmailNotConnectedError extends Error {
  constructor(message = "Gmail is not connected.") {
    super(message);
    this.name = "GmailNotConnectedError";
  }
}

/** Fails fast if this module is ever pulled into a browser bundle. */
function assertServerOnly(): void {
  if (typeof window !== "undefined") {
    throw new Error(
      "lib/gmail/tokens.ts is server-only and must not run in the browser."
    );
  }
}

/**
 * Pure predicate: does this token need refreshing now?
 *
 * Extracted so the skew boundary is unit-testable without any network or
 * database involvement. An unparseable or absent expiry is treated as expired,
 * which fails safe (a needless refresh) rather than unsafe (a dead token).
 */
export function shouldRefresh(
  expiresAt: string | null,
  now: number = Date.now(),
  skewMs: number = TOKEN_EXPIRY_SKEW_MS
): boolean {
  if (!expiresAt) return true;

  const expiryMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiryMs)) return true;

  return expiryMs - now <= skewMs;
}

export interface RefreshedToken {
  accessToken: string;
  expiresAt: string;
  /** Google usually omits this on refresh; null means "keep the stored one". */
  refreshToken: string | null;
}

/**
 * Exchange a refresh token for a new access token.
 *
 * The client secret is sent only to Google over TLS. Neither the refresh token
 * nor the returned access token is logged or returned to any caller outside the
 * server.
 */
export async function refreshAccessToken(
  refreshToken: string
): Promise<RefreshedToken> {
  assertServerOnly();

  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth credentials are not configured");
  }
  if (!refreshToken) {
    throw new GmailReconnectRequiredError();
  }

  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    // Read as text so a non-JSON body cannot mask the real status. Only the
    // error CODE is inspected; the body is never logged.
    const raw = await response.text().catch(() => "");

    let errorCode = "";
    try {
      errorCode = (JSON.parse(raw) as { error?: string }).error ?? "";
    } catch {
      errorCode = "";
    }

    // invalid_grant is terminal: the grant is gone and no retry can recover it.
    if (errorCode === "invalid_grant") {
      throw new GmailReconnectRequiredError();
    }

    throw new Error(
      `Gmail token refresh failed (HTTP ${response.status}, code=${errorCode || "unknown"})`
    );
  }

  const data = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  if (!data.access_token) {
    throw new Error("Gmail token refresh returned no access_token");
  }

  const expiresIn =
    typeof data.expires_in === "number" && data.expires_in > 0
      ? data.expires_in
      : 3600;

  return {
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    // Preserved by the caller when null.
    refreshToken: data.refresh_token ?? null,
  };
}

/**
 * Refresh unconditionally and persist the result.
 *
 * Used by the 401 retry path, where the stored expiry claimed the token was
 * still valid but Gmail disagreed.
 */
export async function forceRefreshAccessToken(
  supabase: SupabaseClient,
  userId: string
): Promise<string> {
  assertServerOnly();

  const stored = await getGmailTokensForServer(supabase, userId);
  if (!stored) throw new GmailNotConnectedError();

  return persistRefresh(supabase, userId, stored.refreshToken);
}

/**
 * A usable Gmail access token for this user.
 *
 * Reuses the stored token when it is comfortably valid, refreshes it when it is
 * not. On a terminal refresh failure the connection is marked inactive so the
 * UI can ask the user to reconnect instead of retrying forever.
 */
export async function getValidAccessToken(
  supabase: SupabaseClient,
  userId: string
): Promise<string> {
  assertServerOnly();

  const stored = await getGmailTokensForServer(supabase, userId);
  if (!stored) throw new GmailNotConnectedError();

  if (!shouldRefresh(stored.expiresAt)) {
    return stored.accessToken;
  }

  return persistRefresh(supabase, userId, stored.refreshToken);
}

/** Shared refresh + persist + failure handling. */
async function persistRefresh(
  supabase: SupabaseClient,
  userId: string,
  refreshToken: string
): Promise<string> {
  try {
    const refreshed = await refreshAccessToken(refreshToken);

    await saveRefreshedGmailTokens(supabase, userId, {
      accessToken: refreshed.accessToken,
      expiresAt: refreshed.expiresAt,
      // null => keep the existing refresh token.
      refreshToken: refreshed.refreshToken,
    });

    return refreshed.accessToken;
  } catch (error: unknown) {
    if (error instanceof GmailReconnectRequiredError) {
      // Terminal. Deactivate so the UI stops offering a sync that cannot work.
      await deactivateGmailConnection(supabase, userId).catch(() => {
        // Best effort: the reconnect error is what matters to the caller.
      });
    }
    throw error;
  }
}

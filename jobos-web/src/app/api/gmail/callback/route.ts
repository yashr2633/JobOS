/**
 * GET /api/gmail/callback
 *
 * Step 2 of the Gmail authorization flow. Google redirects the BROWSER here,
 * so this must be a GET and must respond with redirects, never raw JSON.
 *
 *   validate state (present, bound to this user, single-use)
 *     -> exchange the code server-side
 *     -> derive Google sub from the id_token
 *     -> enforce identity binding
 *     -> persist tokens server-side
 *     -> redirect back into the app
 *
 * This route never touches the Supabase login session. A failure here leaves
 * the user logged in.
 */

export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  GMAIL_STATE_COOKIE,
  decodePendingState,
  exchangeCodeForTokens,
  validateOAuthState,
} from "@/lib/gmail/oauth";
import {
  upsertGmailConnection,
  getGmailConnectionGoogleSub,
  GmailIdentityMismatchError,
} from "@/lib/api/gmail";
import { decideIdentityBinding, getGoogleAuthSub } from "@/lib/gmail/identity";

/** Where the user lands after the flow, success or failure. */
const RETURN_PATH = "/settings/integrations";

/**
 * Build a redirect that also expires the pending-state cookie.
 *
 * Clearing on every exit path is what makes the state single-use: a replayed
 * callback URL finds no cookie and is rejected.
 */
function finish(origin: string, params: Record<string, string>): NextResponse {
  const url = new URL(RETURN_PATH, origin);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = NextResponse.redirect(url);
  response.cookies.set(GMAIL_STATE_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  return response;
}


export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestUrl = new URL(request.url);
  const origin = requestUrl.origin;

  const code = requestUrl.searchParams.get("code");
  const returnedState = requestUrl.searchParams.get("state");
  const googleError = requestUrl.searchParams.get("error");

  // The user declined consent, or Google refused the request.
  if (googleError) {
    console.warn("[gmail/callback] Google returned an error:", googleError);
    return finish(origin, { gmail_error: "denied" });
  }

  if (!code || !returnedState) {
    return finish(origin, { gmail_error: "invalid_response" });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  // Browser navigation: send them through login rather than emitting JSON.
  if (authError || !user) {
    const loginUrl = new URL("/login", origin);
    loginUrl.searchParams.set("next", RETURN_PATH);
    return NextResponse.redirect(loginUrl);
  }

  // ---- State validation -------------------------------------------------
  const rawPendingState = request.cookies.get(GMAIL_STATE_COOKIE)?.value;
  if (!rawPendingState) {
    // Missing, expired, or already consumed.
    return finish(origin, { gmail_error: "state_expired" });
  }

  const pending = decodePendingState(rawPendingState);
  if (!pending) {
    return finish(origin, { gmail_error: "state_invalid" });
  }

  // The state must have been minted for THIS session's user.
  if (pending.userId !== user.id) {
    console.warn("[gmail/callback] Pending state belongs to a different user");
    return finish(origin, { gmail_error: "state_invalid" });
  }

  if (!validateOAuthState(pending.state, returnedState)) {
    console.warn("[gmail/callback] State mismatch; rejecting callback");
    return finish(origin, { gmail_error: "state_invalid" });
  }

  // ---- Token exchange + identity binding --------------------------------
  try {
    const tokens = await exchangeCodeForTokens(code);

    // Identity binding. Resolved from the linked Google identity only; see
    // lib/gmail/identity.ts for why user_metadata.sub must not be used.
    const decision = decideIdentityBinding({
      authGoogleSub: getGoogleAuthSub(user),
      existingGoogleSub: await getGmailConnectionGoogleSub(supabase, user.id),
      incomingGoogleSub: tokens.googleSub,
    });

    if (!decision.allowed) {
      return finish(origin, { gmail_error: decision.reason });
    }

    await upsertGmailConnection(supabase, {
      userId: user.id,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      googleSub: tokens.googleSub,
      scopes: tokens.grantedScopes,
    });

    return finish(origin, { gmail: "connected" });
  } catch (error: unknown) {
    if (error instanceof GmailIdentityMismatchError) {
      return finish(origin, { gmail_error: "identity_mismatch" });
    }

    // Metadata only. Never log the code, tokens, or response bodies.
    console.error(
      "[gmail/callback] Authorization failed:",
      error instanceof Error ? error.message : "unknown error"
    );
    return finish(origin, { gmail_error: "exchange_failed" });
  }
}
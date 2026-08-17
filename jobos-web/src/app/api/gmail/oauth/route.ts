/**
 * POST /api/gmail/oauth
 *
 * Step 1 of the Gmail authorization flow (NOT login).
 *
 *   Authenticated JobTrackOS user
 *     -> mint a cryptographically secure state
 *     -> store it httpOnly, bound to this user id, short-lived
 *     -> return the Google authorization URL
 *     -> the client performs a top-level redirect to Google
 *
 * The state value is deliberately NOT returned in the response body: the
 * browser has no legitimate use for it, and echoing it would turn an httpOnly
 * secret into a JS-readable one.
 */

export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  GMAIL_STATE_COOKIE,
  GMAIL_STATE_MAX_AGE_SECONDS,
  buildOAuthUrl,
  encodePendingState,
  generateOAuthState,
} from "@/lib/gmail/oauth";

function err(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(_request: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return err("You must be logged in to connect Gmail.", 401);
  }

  let oauthUrl: string;
  const state = generateOAuthState();

  try {
    oauthUrl = buildOAuthUrl(state);
  } catch (error: unknown) {
    // Configuration problem (missing client id), not the user's fault.
    console.error(
      "[gmail/oauth] Cannot build authorization URL:",
      error instanceof Error ? error.message : "unknown error"
    );
    return err(
      "Gmail integration is not configured. Please contact support.",
      503
    );
  }

  const response = NextResponse.json({ oauthUrl });

  response.cookies.set(GMAIL_STATE_COOKIE, encodePendingState(user.id, state), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // MUST be "lax", not "strict". Google returns the user via a cross-site
    // top-level navigation; a Strict cookie is withheld on that request, so
    // the callback could never see the pending state.
    sameSite: "lax",
    maxAge: GMAIL_STATE_MAX_AGE_SECONDS,
    path: "/",
  });

  return response;
}

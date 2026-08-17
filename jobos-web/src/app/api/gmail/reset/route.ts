/**
 * Gmail tracked-application reset.
 *
 *   GET  /api/gmail/reset   read-only preview: what a reset would remove
 *   POST /api/gmail/reset   perform the reset
 *
 * AUTHORIZATION — server-side, and not negotiable by the client
 *
 * The acting user is resolved from the SESSION via `supabase.auth.getUser()`. It
 * is never read from the request body, the query string, or a header, so there is
 * no parameter a caller could set to act on someone else's data. Every statement
 * in `applicationReset.ts` then carries `.eq("user_id", userId)`, with RLS behind
 * it as a second layer.
 *
 * A destructive action gets no client-only guard: the confirmation dialog is a
 * courtesy to the user, and this route re-derives authorization regardless of
 * what the client claims.
 *
 * The POST body carries a required acknowledgement field. That is not a security
 * control — the session check is — but it makes an accidental or replayed POST
 * without intent fail closed rather than delete data.
 */

export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  previewGmailApplicationReset,
  resetGmailApplications,
} from "@/lib/api/applicationReset";

/** The client must echo this exactly, so an intentless POST cannot delete. */
export const RESET_CONFIRMATION = "reset-tracked-gmail-applications";

function err(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  // `authError || !user` is the guard idiom every other Gmail route uses, and
  // `gmail/security.test.ts` asserts it. Checking the error as well as the user
  // means a failed session lookup is refused rather than read as "signed out".
  if (authError || !user) return err("You must be logged in.", 401);

  try {
    const preview = await previewGmailApplicationReset(supabase, user.id);
    return NextResponse.json(preview, { status: 200 });
  } catch (error: unknown) {
    console.error("[gmail/reset] Preview failed:", error);
    return err(
      "We could not check your tracked applications. Please try again.",
      500
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err("Request body must be valid JSON.", 400);
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return err("Request body must be a JSON object.", 400);
  }

  const { confirm } = body as Record<string, unknown>;
  if (confirm !== RESET_CONFIRMATION) {
    return err("This action needs to be confirmed before it can run.", 400);
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  // The session is the ONLY source of the acting user id.
  if (authError || !user) return err("You must be logged in.", 401);

  try {
    const result = await resetGmailApplications(supabase, user.id);
    return NextResponse.json(result, { status: 200 });
  } catch (error: unknown) {
    console.error("[gmail/reset] Reset failed:", error);
    // The steps are ordered and idempotent, so a partial run is consistent and a
    // retry completes it. That is what the message promises, accurately.
    return err(
      "The reset did not finish. Your manual applications and Gmail connection are unaffected — please try again.",
      500
    );
  }
}

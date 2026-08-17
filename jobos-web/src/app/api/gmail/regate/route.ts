/**
 * POST /api/gmail/regate
 *
 * Re-gates ONE bounded batch of this user's legacy Gmail activity in place: rows
 * ledgered before the Evidence Gate verdict was stored, which normal sync can
 * never revisit because they are already deduplicated away.
 *
 * Bounded per request so it cannot approach maxDuration, and resumable because
 * the predicate itself is the cursor — a re-gated row no longer matches it. The
 * client calls this repeatedly while `remaining` is above zero.
 *
 * Nothing here deletes or re-inserts a row.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runLegacyRegate } from "@/lib/gmail/regate";
import {
  GmailNotConnectedError,
  GmailReconnectRequiredError,
} from "@/lib/gmail/tokens";
import { GmailApiError } from "@/lib/gmail/client";

function err(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export async function POST(): Promise<NextResponse> {
  const supabase = await createClient();

  // Authentication FIRST: no data statement runs before the session is proven.
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return err("You must be logged in to re-check Gmail activity.", 401);
  }

  // The user id comes ONLY from the verified session. The request body is not
  // read at all, so there is nothing in it that could redirect this work at
  // another user's rows.
  try {
    const result = await runLegacyRegate(supabase, user.id);
    return NextResponse.json(result);
  } catch (error: unknown) {
    if (error instanceof GmailReconnectRequiredError) {
      return err("Gmail access expired. Please reconnect Gmail.", 409, {
        reconnectRequired: true,
      });
    }

    if (error instanceof GmailNotConnectedError) {
      return err("Gmail is not connected.", 409, { reconnectRequired: true });
    }

    if (error instanceof GmailApiError) {
      const retryable =
        error.kind === "rate_limit" || error.kind === "unavailable";

      // Metadata only — never the Gmail response body.
      console.error("[gmail/regate] Gmail API failure:", error.kind, error.status);

      return err(
        retryable
          ? "Gmail is rate-limiting us. Pause a moment and try again."
          : "Gmail rejected the request. Please reconnect Gmail and try again.",
        retryable ? 503 : 502,
        { retryable }
      );
    }

    console.error(
      "[gmail/regate] Unexpected failure:",
      error instanceof Error ? error.message : "unknown error"
    );

    return err("The re-check hit an unexpected problem. You can try again.", 500, {
      retryable: true,
    });
  }
}

/**
 * POST /api/gmail/sync/record
 *
 * Record a COMPLETED browser Gmail scan for server-side analytics.
 *
 * The browser-only Gmail flow keeps applications in IndexedDB. This route
 * persists scan METADATA only, so "Gmail Accounts Tested" and "Gmail Scan
 * Attempts" can be computed from `gmail_sync_jobs`.
 *
 * Identity comes from `googleSub` — the Google `sub` of the account that
 * actually performed the scan, resolved in the browser from its own access
 * token. It is NOT read from `gmail_connections`: the browser-only flow never
 * writes that table, and any legacy row there could describe a different Gmail
 * account than the one just scanned.
 *
 * SECURITY / PRIVACY: accepts only an opaque account id, a date window and
 * counts. No access token, no email address, no message content.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { recordCompletedScan } from "@/lib/api/gmailActivity";

interface RecordScanRequest {
  /** Google OAuth 'sub' claim of the Gmail account that ran the scan. */
  googleSub: string;
  /** Scan window start (ISO 8601). */
  windowStart: string;
  /** Scan window end (ISO 8601). */
  windowEnd: string;
  /** Applications created/updated by this scan. 0 is valid and recorded. */
  applicationsFound?: number;
  /** Messages processed by this scan. */
  messagesProcessed?: number;
  /** Messages judged application-related. */
  candidates?: number;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const body = (await request.json()) as RecordScanRequest;
    const {
      googleSub,
      windowStart,
      windowEnd,
      applicationsFound,
      messagesProcessed,
      candidates,
    } = body;

    if (!googleSub || !windowStart || !windowEnd) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: googleSub, windowStart, windowEnd",
        },
        { status: 400 }
      );
    }

    // Best effort only. The browser-only flow has no connection row, and its
    // absence must never block recording — connection_id is nullable precisely
    // so scan identity survives without it.
    const { data: connection } = await supabase
      .from("gmail_connections")
      .select("id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    const job = await recordCompletedScan(supabase, user.id, {
      googleSub,
      connectionId: connection?.id ?? null,
      windowStart,
      windowEnd,
      applicationsFound: applicationsFound ?? 0,
      messagesSeen: messagesProcessed ?? 0,
      candidates: candidates ?? 0,
    });

    return NextResponse.json({
      success: true,
      jobId: job.id,
      status: job.status,
      applicationsFound: job.applicationsFound,
    });
  } catch (error) {
    // Message only — never request bodies or Gmail-derived values.
    console.error(
      "Error recording Gmail scan:",
      error instanceof Error ? error.message : "unknown error"
    );
    return NextResponse.json(
      {
        error: "Failed to record Gmail scan",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

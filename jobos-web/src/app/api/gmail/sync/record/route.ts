/**
 * POST /api/gmail/sync/record
 *
 * Record browser Gmail scan completion for analytics tracking.
 *
 * Browser-based Gmail integration stores applications in IndexedDB locally.
 * This endpoint records scan metadata to gmail_sync_jobs for server-side
 * analytics (Gmail Accounts Tested, Gmail Scan Attempts, etc.).
 *
 * SECURITY: Only records scan metadata (connection_id, google_sub, window,
 * result counts). Does NOT accept or store Gmail message content.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { startSyncJob, updateSyncJobProgress } from "@/lib/api/gmailActivity";

interface RecordScanRequest {
  /** Gmail connection ID from gmail_connections */
  connectionId: string;
  /** Google OAuth 'sub' claim (immutable Gmail account ID) */
  googleSub: string;
  /** Scan window start (ISO 8601) */
  windowStart: string;
  /** Scan window end (ISO 8601) */
  windowEnd: string;
  /** Number of applications found/stored */
  applicationsFound: number;
  /** Number of messages processed */
  messagesProcessed: number;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Verify authentication
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

    // Parse request body
    const body: RecordScanRequest = await request.json();

    const {
      connectionId,
      googleSub,
      windowStart,
      windowEnd,
      applicationsFound,
      messagesProcessed,
    } = body;

    // Validate required fields
    if (!connectionId || !googleSub || !windowStart || !windowEnd) {
      return NextResponse.json(
        { error: "Missing required fields: connectionId, googleSub, windowStart, windowEnd" },
        { status: 400 }
      );
    }

    // Verify connection belongs to authenticated user
    const { data: connection, error: connectionError } = await supabase
      .from("gmail_connections")
      .select("id, google_sub")
      .eq("id", connectionId)
      .eq("user_id", user.id)
      .single();

    if (connectionError || !connection) {
      return NextResponse.json(
        { error: "Gmail connection not found or access denied" },
        { status: 404 }
      );
    }

    // Verify google_sub matches (security check)
    if (connection.google_sub !== googleSub) {
      return NextResponse.json(
        { error: "Google account mismatch" },
        { status: 403 }
      );
    }

    // Start sync job record
    const job = await startSyncJob(supabase, user.id, {
      connectionId,
      googleSub,
      windowStart,
      windowEnd,
      syncMode: "full", // Browser scans are always full scans
    });

    // Immediately complete it with results
    await updateSyncJobProgress(supabase, user.id, job.id, {
      status: "complete",
      applicationsFound: applicationsFound ?? 0,
      messagesSeen: messagesProcessed ?? 0,
    });

    return NextResponse.json({
      success: true,
      jobId: job.id,
      applicationsFound: applicationsFound ?? 0,
    });
  } catch (error) {
    console.error("Error recording Gmail scan:", error);
    return NextResponse.json(
      {
        error: "Failed to record Gmail scan",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

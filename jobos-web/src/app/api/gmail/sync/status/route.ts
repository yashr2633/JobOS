/**
 * GET /api/gmail/sync/status
 *
 * Current scan progress for the authenticated user. Read-only; drives the
 * progress UI and lets a returning user resume an interrupted scan.
 */

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getGmailConnection } from "@/lib/api/gmail";
import { getLatestSyncJob, getOpenSyncJob } from "@/lib/api/gmailActivity";

export async function GET(): Promise<NextResponse> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: "You must be logged in." },
      { status: 401 }
    );
  }

  // Pass the known user id so this does not repeat getUser() internally.
  const [connection, openJob, latestJob] = await Promise.all([
    getGmailConnection(supabase, user.id),
    getOpenSyncJob(supabase, user.id),
    getLatestSyncJob(supabase, user.id),
  ]);

  const job = openJob ?? latestJob;

  return NextResponse.json({
    connected: connection !== null,
    lastSyncAt: connection?.lastSyncAt ?? null,
    job: job
      ? {
          id: job.id,
          status: job.status,
          resumable: openJob !== null,
          windowStart: job.windowStart,
          windowEnd: job.windowEnd,
          messagesSeen: job.messagesSeen,
          candidates: job.candidates,
          classified: job.classified,
          applicationsFound: job.applicationsFound,
          error: job.error,
          startedAt: job.startedAt,
          updatedAt: job.updatedAt,
        }
      : null,
  });
}

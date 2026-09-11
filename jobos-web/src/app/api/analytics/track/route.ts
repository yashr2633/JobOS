/**
 * POST /api/analytics/track
 *
 * Event ingestion endpoint for client-side analytics tracking.
 *
 * Security:
 * - Requires authenticated user
 * - User can only track their own events (enforced by RLS)
 * - Server-side deduplication via unique constraint
 * - Rate limited (one per user per UTC day for session_activity)
 *
 * Non-blocking design: failures are logged but tracked events are advisory only.
 */

export const runtime = 'nodejs';

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { TrackEventRequest, TrackEventResponse } from '@/types/analytics';

function ok(body: TrackEventResponse, status = 200): NextResponse {
  return NextResponse.json(body, { status });
}

function err(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── 1. Parse request body ────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err('Request body must be valid JSON.', 400);
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return err('Request body must be a JSON object.', 400);
  }

  const { event_name, metadata } = body as Partial<TrackEventRequest>;

  // ── 2. Validate event ────────────────────────────────────────────────────
  if (event_name !== 'user_session_activity') {
    return err('Invalid event_name. Only user_session_activity is supported.', 400);
  }

  // ── 3. Authenticate ──────────────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return err('Unauthorized.', 401);
  }

  // ── 4. Insert event (with server-side deduplication) ────────────────────
  try {
    const { error } = await supabase.from('analytics_events').insert({
      user_id: user.id,
      event_name,
      metadata: metadata ?? null,
    });

    if (error) {
      // Check if this is a unique constraint violation (duplicate event)
      if (error.code === '23505') {
        // User already has an event for today - return success (idempotent)
        return ok({ success: true, inserted: false });
      }

      // Other database error
      console.error('[analytics/track] Database error:', error);
      return err('Failed to track event.', 500);
    }

    // Successfully inserted
    return ok({ success: true, inserted: true });
  } catch (error) {
    console.error('[analytics/track] Unexpected error:', error);
    return err('Failed to track event.', 500);
  }
}

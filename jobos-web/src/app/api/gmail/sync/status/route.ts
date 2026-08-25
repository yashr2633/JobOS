/**
 * GET /api/gmail/sync/status
 *
 * DEPRECATED — Server-side Gmail sync status is no longer used.
 *
 * JobTrackOS now uses browser-only Gmail integration with state stored in IndexedDB.
 *
 * This endpoint returns 410 Gone to indicate the resource is permanently unavailable.
 */

export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";

export async function GET(_request: NextRequest): Promise<NextResponse> {
  return NextResponse.json(
    {
      error: "Server-side Gmail sync status is no longer available. Please use the browser-based Gmail integration.",
      migration: "Integration state is now stored in browser IndexedDB.",
    },
    { status: 410 }
  );
}

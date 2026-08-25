/**
 * POST /api/gmail/sync
 *
 * DEPRECATED — Server-side Gmail scanning is no longer used.
 *
 * JobTrackOS now uses browser-only Gmail integration where the browser directly
 * calls Gmail APIs, classifies emails locally, and stores results in IndexedDB.
 *
 * This endpoint returns 410 Gone to indicate the resource is permanently unavailable.
 */

export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";

export async function POST(_request: NextRequest): Promise<NextResponse> {
  return NextResponse.json(
    {
      error: "Server-side Gmail scanning is no longer available. Please use the browser-based Gmail integration.",
      migration: "Use the Sync Gmail feature on the dashboard or applications page.",
    },
    { status: 410 }
  );
}

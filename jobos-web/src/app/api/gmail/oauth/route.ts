/**
 * POST /api/gmail/oauth
 *
 * DEPRECATED — Server-side Gmail OAuth is no longer used.
 *
 * JobTrackOS now uses browser-only Gmail integration via Google Identity Services.
 * This route is disabled to prevent accidental use of the legacy server-side flow.
 *
 * The browser-local Gmail architecture:
 * - Uses Google Identity Services token model in the browser
 * - Never sends Gmail tokens or content to JobTrackOS backend
 * - Stores applications only in browser IndexedDB
 * - Merges with server applications client-side for display
 *
 * This endpoint returns 410 Gone to indicate the resource is permanently unavailable.
 */

export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";

export async function POST(_request: NextRequest): Promise<NextResponse> {
  return NextResponse.json(
    {
      error: "Server-side Gmail OAuth is no longer available. Please use the browser-based Gmail integration.",
      migration: "Use the Sync Gmail feature on the dashboard or applications page.",
    },
    { status: 410 }
  );
}

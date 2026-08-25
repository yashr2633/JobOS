/**
 * POST /api/gmail/regate
 *
 * DEPRECATED — Server-side Gmail re-gating is no longer used.
 *
 * JobTrackOS now uses browser-only Gmail integration. Legacy server-side
 * Gmail activity re-classification is no longer needed.
 *
 * This endpoint returns 410 Gone to indicate the resource is permanently unavailable.
 */

export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";

export async function POST(_request: NextRequest): Promise<NextResponse> {
  return NextResponse.json(
    {
      error: "Server-side Gmail re-gating is no longer available.",
      migration: "Re-scan using the browser-based Gmail integration to update applications.",
    },
    { status: 410 }
  );
}

/**
 * POST /api/gmail/reconcile
 *
 * DEPRECATED — Server-side Gmail reconciliation is no longer used.
 *
 * JobTrackOS now uses browser-only Gmail integration. Legacy server-side
 * application repair is no longer needed.
 *
 * This endpoint returns 410 Gone to indicate the resource is permanently unavailable.
 */

export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";

export async function POST(_request: NextRequest): Promise<NextResponse> {
  return NextResponse.json(
    {
      error: "Server-side Gmail reconciliation is no longer available.",
      migration: "Re-scan using the browser-based Gmail integration to update applications.",
    },
    { status: 410 }
  );
}

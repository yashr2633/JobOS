/**
 * POST /api/gmail/disconnect
 *
 * DEPRECATED — Server-side Gmail disconnection is no longer used.
 *
 * JobTrackOS now uses browser-only Gmail integration. To disconnect:
 * - Clear browser-local integration state from IndexedDB
 * - Revoke token at https://myaccount.google.com/permissions
 *
 * This endpoint returns 410 Gone to indicate the resource is permanently unavailable.
 */

export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";

export async function POST(_request: NextRequest): Promise<NextResponse> {
  return NextResponse.json(
    {
      error: "Server-side Gmail disconnection is no longer available.",
      migration: "Use the browser-based Gmail integration controls to clear local state.",
    },
    { status: 410 }
  );
}

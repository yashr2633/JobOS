/**
 * GET/POST /api/gmail/reset
 *
 * DEPRECATED — Server-side Gmail application reset is no longer used.
 *
 * JobTrackOS now uses browser-only Gmail integration with applications stored
 * in browser IndexedDB. To clear Gmail applications, clear browser-local storage.
 *
 * This endpoint returns 410 Gone to indicate the resource is permanently unavailable.
 */

export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    {
      error: "Server-side Gmail application reset is no longer available.",
      migration: "Gmail applications are now stored in browser IndexedDB. Clear browser data to reset.",
    },
    { status: 410 }
  );
}

export async function POST(_request: NextRequest): Promise<NextResponse> {
  return NextResponse.json(
    {
      error: "Server-side Gmail application reset is no longer available.",
      migration: "Gmail applications are now stored in browser IndexedDB. Clear browser data to reset.",
    },
    { status: 410 }
  );
}

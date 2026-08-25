/**
 * Legacy Gmail server import endpoint.
 *
 * Gmail-derived applications are now processed and stored browser-side.
 */

import { NextResponse } from "next/server";

export async function POST(): Promise<NextResponse> {
  return NextResponse.json(
    {
      error: "Server-side Gmail import is no longer available.",
    },
    { status: 410 }
  );
}

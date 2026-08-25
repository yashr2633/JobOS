/**
 * Legacy Gmail OAuth callback.
 *
 * Server-side Gmail OAuth has been retired.
 * Gmail authorization now happens directly in the user's browser.
 */

import { NextResponse } from "next/server";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    {
      error: "Server-side Gmail OAuth is no longer available.",
    },
    { status: 410 }
  );
}

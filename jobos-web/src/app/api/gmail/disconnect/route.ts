/**
 * POST /api/gmail/disconnect
 *
 * Disconnects Gmail for the authenticated user.
 *
 * This exists as a server route so the Gmail data-access module (which reads
 * and writes token columns) is never pulled into the client bundle.
 */

export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { disconnectGmail } from "@/lib/api/gmail";

export async function POST(_request: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: "You must be logged in to manage Gmail." },
      { status: 401 }
    );
  }

  try {
    await disconnectGmail(supabase, user.id);
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    console.error(
      "[gmail/disconnect] Failed:",
      error instanceof Error ? error.message : "unknown error"
    );
    return NextResponse.json(
      { error: "Could not disconnect Gmail. Please try again." },
      { status: 500 }
    );
  }
}

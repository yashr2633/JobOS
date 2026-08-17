/**
 * POST /api/gmail/reconcile
 *
 * Explicit repair of the acting user's already-imported applications: fills the
 * `Unknown company` / `Unknown role` placeholders and the `job_portal = "Gmail"`
 * fallback from evidence already linked to those applications, and advances a
 * status that never moved.
 *
 * User-triggered only. Nothing schedules this, no scan calls it, and there is no
 * timer: it runs exactly when someone presses "Repair Gmail-imported
 * applications". Rerunning it is safe — a repaired placeholder no longer
 * matches, so a second run patches nothing.
 *
 * Reads and writes only the acting user's rows, deletes nothing, and never
 * touches the Gmail evidence.
 */

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runReconciliation } from "@/lib/gmail/reconcile";

function err(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(): Promise<NextResponse> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return err("You must be logged in to repair applications.", 401);
  }

  try {
    const { examined, patched, failed } = await runReconciliation(
      supabase,
      user.id
    );
    return NextResponse.json({ examined, patched, failed });
  } catch (error: unknown) {
    console.error(
      "[gmail/reconcile] Repair failed:",
      error instanceof Error ? error.message : "unknown error"
    );
    return err("The repair could not be completed.", 500);
  }
}

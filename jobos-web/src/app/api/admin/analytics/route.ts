/**
 * GET /api/admin/analytics
 *
 * Founder analytics dashboard data aggregation.
 *
 * Security:
 * - Requires authenticated user
 * - Requires admin authorization (checked via service role)
 * - Non-admins receive 403
 *
 * Returns aggregate metrics from existing source-of-truth tables plus
 * minimal analytics_events tracking.
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin, AdminAuthError } from '@/lib/analytics/admin';
import { aggregateDashboardMetrics } from '@/lib/analytics/metrics';
import type { DashboardMetrics } from '@/types/analytics';

function ok(body: DashboardMetrics): NextResponse {
  return NextResponse.json(body);
}

function err(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(_request: NextRequest): Promise<NextResponse> {
  // ── 1. Authenticate ──────────────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return err('Unauthorized.', 401);
  }

  // ── 2. Authorize admin access ────────────────────────────────────────────
  try {
    await requireAdmin(user.id);
  } catch (error) {
    if (error instanceof AdminAuthError) {
      return err(error.message, error.statusCode);
    }
    console.error('[admin/analytics] Authorization error:', error);
    return err('Authorization failed.', 500);
  }

  // ── 3. Aggregate metrics ─────────────────────────────────────────────────
  try {
    const metrics = await aggregateDashboardMetrics();
    return ok(metrics);
  } catch (error) {
    console.error('[admin/analytics] Metrics aggregation error:', error);
    return err('Failed to aggregate metrics.', 500);
  }
}

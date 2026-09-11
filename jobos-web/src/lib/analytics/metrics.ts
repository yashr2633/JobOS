/**
 * Server-side analytics metrics aggregation.
 *
 * Queries existing source-of-truth tables plus minimal analytics_events.
 * Only called by admin routes with service role authorization.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import type { DashboardMetrics } from '@/types/analytics';

/**
 * Date when analytics tracking was deployed.
 * Used to label metrics dependent on analytics_events.
 */
const TRACKING_SINCE = '2026-09-11'; // Update this to actual deployment date

/**
 * Aggregate all dashboard metrics.
 *
 * Queries multiple tables via service role client. Should only be called
 * by admin-authorized routes.
 */
export async function aggregateDashboardMetrics(): Promise<DashboardMetrics> {
  const admin = createAdminClient();

  // Run queries in parallel
  const [
    totalUsers,
    newUsers7d,
    newUsers30d,
    activeUsers7d,
    activeUsers30d,
    engagedUsers7d,
    engagedUsers30d,
    returningUsers,
    gmailConnected,
    resumeMatchUsers,
    totalApplications,
    applications7d,
    applications30d,
    applicationsByStatus,
    totalGmailSyncs,
    gmailSyncs7d,
    gmailSyncs30d,
    totalResumeAnalyses,
    resumeAnalyses7d,
    resumeAnalyses30d,
    totalResumes,
    signupTrend,
  ] = await Promise.all([
    countTotalUsers(admin),
    countNewUsers(admin, 7),
    countNewUsers(admin, 30),
    countActiveUsers(admin, 7),
    countActiveUsers(admin, 30),
    countEngagedUsers(admin, 7),
    countEngagedUsers(admin, 30),
    countReturningUsers(admin),
    countGmailConnectedUsers(admin),
    countResumeMatchUsers(admin),
    countApplications(admin),
    countApplications(admin, 7),
    countApplications(admin, 30),
    getApplicationsByStatus(admin),
    countGmailSyncs(admin),
    countGmailSyncs(admin, 7),
    countGmailSyncs(admin, 30),
    countResumeAnalyses(admin),
    countResumeAnalyses(admin, 7),
    countResumeAnalyses(admin, 30),
    countResumes(admin),
    getSignupTrend(admin),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    trackingSince: TRACKING_SINCE,
    users: {
      total: totalUsers,
      new7d: newUsers7d,
      new30d: newUsers30d,
      active7d: activeUsers7d,
      active30d: activeUsers30d,
      engaged7d: engagedUsers7d,
      engaged30d: engagedUsers30d,
      returning: returningUsers,
    },
    adoption: {
      gmailConnected,
      gmailConnectedPercent:
        totalUsers > 0 ? Math.round((gmailConnected / totalUsers) * 100) : 0,
      resumeMatchUsers,
      resumeMatchUsersPercent:
        totalUsers > 0 ? Math.round((resumeMatchUsers / totalUsers) * 100) : 0,
    },
    activity: {
      totalApplications,
      applications7d,
      applications30d,
      totalGmailSyncs,
      gmailSyncs7d,
      gmailSyncs30d,
      totalResumeAnalyses,
      resumeAnalyses7d,
      resumeAnalyses30d,
      totalResumes,
    },
    applicationsByStatus,
    signupTrend,
  };
}

// ============================================================================
// User Metrics
// ============================================================================

async function countTotalUsers(admin: ReturnType<typeof createAdminClient>): Promise<number> {
  const { count } = await admin
    .from('users')
    .select('*', { count: 'exact', head: true })
    .in('aud', ['authenticated']);

  return count ?? 0;
}

async function countNewUsers(
  admin: ReturnType<typeof createAdminClient>,
  days: number
): Promise<number> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const { count } = await admin
    .from('users')
    .select('*', { count: 'exact', head: true })
    .in('aud', ['authenticated'])
    .gte('created_at', since.toISOString());

  return count ?? 0;
}

/**
 * Active Users = users with authenticated sessions (from analytics_events).
 * Tracking since TRACKING_SINCE date.
 */
async function countActiveUsers(
  admin: ReturnType<typeof createAdminClient>,
  days: number
): Promise<number> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const { data } = await admin
    .from('analytics_events')
    .select('user_id')
    .eq('event_name', 'user_session_activity')
    .gte('created_at', since.toISOString());

  if (!data) return 0;

  // Count distinct users
  const uniqueUsers = new Set(data.map((row) => row.user_id));
  return uniqueUsers.size;
}

/**
 * Engaged Users = users with meaningful product actions (from existing tables).
 * Does NOT require analytics_events tracking.
 */
async function countEngagedUsers(
  admin: ReturnType<typeof createAdminClient>,
  days: number
): Promise<number> {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceISO = since.toISOString();

  // Query multiple sources of engagement
  const [applicationsUsers, gmailSyncUsers, resumeAnalysisUsers, resumeUploadUsers] =
    await Promise.all([
      // Users who created applications
      admin
        .from('applications')
        .select('user_id')
        .gte('created_at', sinceISO)
        .then((res) => new Set(res.data?.map((r) => r.user_id) ?? [])),

      // Users who completed Gmail syncs
      admin
        .from('gmail_sync_jobs')
        .select('user_id')
        .eq('status', 'complete')
        .gte('updated_at', sinceISO)
        .then((res) => new Set(res.data?.map((r) => r.user_id) ?? [])),

      // Users who completed resume analyses
      admin
        .from('match_results')
        .select('user_id')
        .eq('status', 'complete')
        .gte('completed_at', sinceISO)
        .then((res) => new Set(res.data?.map((r) => r.user_id) ?? [])),

      // Users who uploaded/created resumes
      admin
        .from('resumes')
        .select('user_id')
        .gte('created_at', sinceISO)
        .then((res) => new Set(res.data?.map((r) => r.user_id) ?? [])),
    ]);

  // Union all engaged users
  const engaged = new Set<string>();
  for (const userId of applicationsUsers) engaged.add(userId);
  for (const userId of gmailSyncUsers) engaged.add(userId);
  for (const userId of resumeAnalysisUsers) engaged.add(userId);
  for (const userId of resumeUploadUsers) engaged.add(userId);

  return engaged.size;
}

/**
 * Returning Users = users active on 2+ distinct UTC dates.
 * Tracking since TRACKING_SINCE date.
 */
async function countReturningUsers(admin: ReturnType<typeof createAdminClient>): Promise<number> {
  const { data } = await admin
    .from('analytics_events')
    .select('user_id, created_at')
    .eq('event_name', 'user_session_activity');

  if (!data || data.length === 0) return 0;

  // Group by user and count distinct dates
  const userDates = new Map<string, Set<string>>();

  for (const row of data) {
    const date = new Date(row.created_at).toISOString().split('T')[0];
    if (!userDates.has(row.user_id)) {
      userDates.set(row.user_id, new Set());
    }
    userDates.get(row.user_id)!.add(date);
  }

  // Count users with 2+ distinct dates
  let returning = 0;
  for (const dates of userDates.values()) {
    if (dates.size >= 2) {
      returning++;
    }
  }

  return returning;
}

// ============================================================================
// Feature Adoption
// ============================================================================

async function countGmailConnectedUsers(
  admin: ReturnType<typeof createAdminClient>
): Promise<number> {
  const { count } = await admin
    .from('gmail_connections')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true);

  return count ?? 0;
}

async function countResumeMatchUsers(
  admin: ReturnType<typeof createAdminClient>
): Promise<number> {
  const { data } = await admin
    .from('match_results')
    .select('user_id')
    .eq('status', 'complete');

  if (!data) return 0;

  const uniqueUsers = new Set(data.map((row) => row.user_id));
  return uniqueUsers.size;
}

// ============================================================================
// Activity Metrics
// ============================================================================

async function countApplications(
  admin: ReturnType<typeof createAdminClient>,
  days?: number
): Promise<number> {
  let query = admin.from('applications').select('*', { count: 'exact', head: true });

  if (days !== undefined) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    query = query.gte('created_at', since.toISOString());
  }

  const { count } = await query;
  return count ?? 0;
}

async function getApplicationsByStatus(
  admin: ReturnType<typeof createAdminClient>
): Promise<Array<{ status: string; count: number }>> {
  const { data } = await admin
    .from('applications')
    .select('status')
    .order('status');

  if (!data) return [];

  // Count by status
  const counts = new Map<string, number>();
  for (const row of data) {
    counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);
}

async function countGmailSyncs(
  admin: ReturnType<typeof createAdminClient>,
  days?: number
): Promise<number> {
  let query = admin
    .from('gmail_sync_jobs')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'complete');

  if (days !== undefined) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    query = query.gte('updated_at', since.toISOString());
  }

  const { count } = await query;
  return count ?? 0;
}

async function countResumeAnalyses(
  admin: ReturnType<typeof createAdminClient>,
  days?: number
): Promise<number> {
  let query = admin
    .from('match_results')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'complete');

  if (days !== undefined) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    query = query.gte('completed_at', since.toISOString());
  }

  const { count } = await query;
  return count ?? 0;
}

async function countResumes(admin: ReturnType<typeof createAdminClient>): Promise<number> {
  const { count } = await admin
    .from('resumes')
    .select('*', { count: 'exact', head: true });

  return count ?? 0;
}

// ============================================================================
// Trends
// ============================================================================

async function getSignupTrend(
  admin: ReturnType<typeof createAdminClient>
): Promise<Array<{ date: string; count: number }>> {
  const since = new Date();
  since.setDate(since.getDate() - 30);

  const { data } = await admin
    .from('users')
    .select('created_at')
    .in('aud', ['authenticated'])
    .gte('created_at', since.toISOString())
    .order('created_at');

  if (!data) return [];

  // Group by date
  const counts = new Map<string, number>();
  for (const row of data) {
    const date = new Date(row.created_at).toISOString().split('T')[0];
    counts.set(date, (counts.get(date) ?? 0) + 1);
  }

  // Fill in missing dates with 0
  const trend: Array<{ date: string; count: number }> = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    trend.push({ date: dateStr, count: counts.get(dateStr) ?? 0 });
  }

  return trend;
}

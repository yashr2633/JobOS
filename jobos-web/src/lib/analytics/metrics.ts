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
 * Aggregate all dashboard metrics for BETA analytics.
 *
 * Queries multiple tables via service role client. Should only be called
 * by admin-authorized routes.
 */
export async function aggregateDashboardMetrics(): Promise<DashboardMetrics> {
  const admin = createAdminClient();

  // Run queries in parallel
  const [
    registeredUsers,
    activeUsers7d,
    activeUsers30d,
    engagedUsers30d,
    returningUsers,
    activatedUsers,
    gmailAdoptionUsers,
    gmailCurrentlyConnected,
    gmailSyncUsers,
    resumeMatchUsers,
    applicationsTracked,
    applicationsAdded7d,
    applicationsAdded30d,
    applicationsByStatus,
    gmailScansCompleted,
    gmailScans7d,
    gmailScans30d,
    resumeAnalysesCompleted,
    resumeAnalyses7d,
    resumeAnalyses30d,
    resumesUploaded,
  ] = await Promise.all([
    countTotalUsers(admin),
    countActiveUsers(admin, 7),
    countActiveUsers(admin, 30),
    countEngagedUsers(admin, 30),
    countReturningUsers(admin),
    countActivatedUsers(admin),
    countGmailAdoptionUsers(admin),
    countGmailCurrentlyConnected(admin),
    countGmailSyncUsers(admin),
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
  ]);

  const total = registeredUsers;

  return {
    generatedAt: new Date().toISOString(),
    trackingSince: TRACKING_SINCE,
    users: {
      registered: registeredUsers,
      active7d: activeUsers7d,
      active30d: activeUsers30d,
      engaged30d: engagedUsers30d,
      returning: returningUsers,
    },
    adoption: {
      activated: {
        count: activatedUsers,
        total,
        percent: total > 0 ? Math.round((activatedUsers / total) * 100) : 0,
      },
      gmailAdoption: {
        count: gmailAdoptionUsers,
        total,
        percent: total > 0 ? Math.round((gmailAdoptionUsers / total) * 100) : 0,
      },
      gmailCurrentlyConnected: {
        count: gmailCurrentlyConnected,
        total,
        percent: total > 0 ? Math.round((gmailCurrentlyConnected / total) * 100) : 0,
      },
      gmailSyncUsers: {
        count: gmailSyncUsers,
        total,
        percent: total > 0 ? Math.round((gmailSyncUsers / total) * 100) : 0,
      },
      resumeMatchUsers: {
        count: resumeMatchUsers,
        total,
        percent: total > 0 ? Math.round((resumeMatchUsers / total) * 100) : 0,
      },
    },
    usage: {
      applicationsTracked,
      applicationsAdded7d,
      applicationsAdded30d,
      gmailScansCompleted,
      gmailScans7d,
      gmailScans30d,
      resumeAnalysesCompleted,
      resumeAnalyses7d,
      resumeAnalyses30d,
      resumesUploaded,
    },
    applicationsByStatus,
  };
}

// ============================================================================
// User Metrics
// ============================================================================

/**
 * Count total registered users from Supabase Auth.
 * 
 * Uses Admin Auth API to access auth.users, which is not a regular table.
 * Paginates through all users if necessary.
 */
async function countTotalUsers(admin: ReturnType<typeof createAdminClient>): Promise<number> {
  let total = 0;
  let page = 1;
  const perPage = 1000; // Supabase Admin API max per page
  
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage,
    });
    
    if (error) {
      console.error('[analytics/metrics] Error fetching users:', error);
      break;
    }
    
    if (!data || !data.users || data.users.length === 0) {
      break;
    }
    
    // Count only authenticated users (not anonymous sessions)
    total += data.users.filter(u => u.aud === 'authenticated').length;
    
    // If we got fewer users than requested, we've reached the end
    if (data.users.length < perPage) {
      break;
    }
    
    page++;
  }
  
  return total;
}

/**
 * Count new users registered in the last N days.
 * 
 * Uses Admin Auth API to access auth.users.
 */
async function countNewUsers(
  admin: ReturnType<typeof createAdminClient>,
  days: number
): Promise<number> {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceISO = since.toISOString();
  
  let count = 0;
  let page = 1;
  const perPage = 1000;
  
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage,
    });
    
    if (error) {
      console.error('[analytics/metrics] Error fetching users:', error);
      break;
    }
    
    if (!data || !data.users || data.users.length === 0) {
      break;
    }
    
    // Count authenticated users created after the cutoff date
    count += data.users.filter(
      u => u.aud === 'authenticated' && u.created_at >= sinceISO
    ).length;
    
    if (data.users.length < perPage) {
      break;
    }
    
    page++;
  }
  
  return count;
}
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
 * 
 * Meaningful actions: created/updated application, completed Gmail scan, completed Resume Match
 */
async function countEngagedUsers(
  admin: ReturnType<typeof createAdminClient>,
  days: number
): Promise<number> {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceISO = since.toISOString();

  // Query multiple sources of engagement
  const [applicationsUsers, gmailSyncUsers, resumeAnalysisUsers] =
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
    ]);

  // Union all engaged users
  const engaged = new Set<string>();
  for (const userId of applicationsUsers) engaged.add(userId);
  for (const userId of gmailSyncUsers) engaged.add(userId);
  for (const userId of resumeAnalysisUsers) engaged.add(userId);

  return engaged.size;
}

/**
 * Activated Users = users who completed at least one meaningful core workflow.
 * Same as engaged users but for all time (not time-bound).
 */
async function countActivatedUsers(admin: ReturnType<typeof createAdminClient>): Promise<number> {
  const [applicationsUsers, gmailSyncUsers, resumeAnalysisUsers] = await Promise.all([
    admin
      .from('applications')
      .select('user_id')
      .then((res) => new Set(res.data?.map((r) => r.user_id) ?? [])),

    admin
      .from('gmail_sync_jobs')
      .select('user_id')
      .eq('status', 'complete')
      .then((res) => new Set(res.data?.map((r) => r.user_id) ?? [])),

    admin
      .from('match_results')
      .select('user_id')
      .eq('status', 'complete')
      .then((res) => new Set(res.data?.map((r) => r.user_id) ?? [])),
  ]);

  const activated = new Set<string>();
  for (const userId of applicationsUsers) activated.add(userId);
  for (const userId of gmailSyncUsers) activated.add(userId);
  for (const userId of resumeAnalysisUsers) activated.add(userId);

  return activated.size;
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

/**
 * Gmail Adoption Users = users who have EVER successfully connected Gmail.
 * This is the PRIMARY Gmail adoption metric.
 * 
 * Attempts to reconstruct historical adoption from:
 * 1. Currently connected users (gmail_connections.is_active = true)
 * 2. Users with successful Gmail syncs (proves past connection)
 * 3. Any other reliable evidence of past successful connection
 * 
 * Users who disconnected later still count as adopted.
 */
async function countGmailAdoptionUsers(
  admin: ReturnType<typeof createAdminClient>
): Promise<number> {
  const [currentlyConnected, syncedUsers] = await Promise.all([
    // Users with active connections
    admin
      .from('gmail_connections')
      .select('user_id')
      .eq('is_active', true)
      .then((res) => new Set(res.data?.map((r) => r.user_id) ?? [])),

    // Users who completed at least one sync (proves they connected)
    admin
      .from('gmail_sync_jobs')
      .select('user_id')
      .eq('status', 'complete')
      .then((res) => new Set(res.data?.map((r) => r.user_id) ?? [])),
  ]);

  // Union: anyone who is currently connected OR has synced
  const adopted = new Set<string>();
  for (const userId of currentlyConnected) adopted.add(userId);
  for (const userId of syncedUsers) adopted.add(userId);

  return adopted.size;
}

/**
 * Gmail Currently Connected = users with Gmail integration currently active.
 * This is a SECONDARY operational metric.
 */
async function countGmailCurrentlyConnected(
  admin: ReturnType<typeof createAdminClient>
): Promise<number> {
  const { count } = await admin
    .from('gmail_connections')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true);

  return count ?? 0;
}

/**
 * Gmail Sync Users = users who completed at least one successful Gmail scan/sync.
 */
async function countGmailSyncUsers(
  admin: ReturnType<typeof createAdminClient>
): Promise<number> {
  const { data } = await admin
    .from('gmail_sync_jobs')
    .select('user_id')
    .eq('status', 'complete');

  if (!data) return 0;

  const uniqueUsers = new Set(data.map((row) => row.user_id));
  return uniqueUsers.size;
}

/**
 * Resume Match Users = users who completed at least one Resume Match analysis.
 */
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

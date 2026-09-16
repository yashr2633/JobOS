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
    // Gmail Integration Metrics
    gmailAccountsTested,
    gmailScanAttempts,
    gmailFeatureUsers,
    gmailCurrentlyConnected,
    // Other metrics
    resumeMatchUsers,
    applicationsTracked,
    applicationsAdded7d,
    applicationsAdded30d,
    applicationsByStatus,
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
    // Gmail metrics
    countGmailAccountsTested(admin),
    countGmailScanAttempts(admin),
    countGmailFeatureUsers(admin),
    countGmailCurrentlyConnected(admin),
    // Other
    countResumeMatchUsers(admin),
    countApplications(admin),
    countApplications(admin, 7),
    countApplications(admin, 30),
    getApplicationsByStatus(admin),
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
    gmail: {
      accountsTested: gmailAccountsTested,
      scanAttempts: gmailScanAttempts,
      featureUsers: {
        count: gmailFeatureUsers,
        total,
        percent: total > 0 ? Math.round((gmailFeatureUsers / total) * 100) : 0,
      },
      currentlyConnected: gmailCurrentlyConnected,
    },
    adoption: {
      activated: {
        count: activatedUsers,
        total,
        percent: total > 0 ? Math.round((activatedUsers / total) * 100) : 0,
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
      gmailScansCompleted: gmailScanAttempts, // For backward compatibility in usage section
      gmailScans7d: 0, // Deprecated - not needed with new metrics
      gmailScans30d: 0, // Deprecated - not needed with new metrics
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
// Gmail Integration Metrics
// ============================================================================

/**
 * Gmail Accounts Tested = COUNT DISTINCT Gmail accounts/integrations that
 * successfully connected AND reached at least one genuine scan attempt.
 * 
 * CRITICAL DEFINITIONS:
 * - Counts GMAIL ACCOUNTS, not JobTrackOS users
 * - Uses google_sub (stable Gmail account identifier) for counting
 * - Zero-result scans MUST count
 * - One user testing 3 Gmail accounts = 3 accounts tested
 * - Same Gmail account scanned 5 times = 1 account tested
 * 
 * Historical Recovery:
 * - Joins gmail_connections with gmail_sync_jobs via connection_id
 * - Includes disconnected accounts (via sync history)
 * - Does NOT require applications to be found
 */
async function countGmailAccountsTested(
  admin: ReturnType<typeof createAdminClient>
): Promise<number> {
  // Get all connection_ids that have completed at least one scan
  const { data: syncedConnections } = await admin
    .from('gmail_sync_jobs')
    .select('connection_id')
    .eq('status', 'complete');

  if (!syncedConnections || syncedConnections.length === 0) return 0;

  const connectionIds = [...new Set(syncedConnections.map(r => r.connection_id))];

  // Get google_sub for those connections (including disconnected ones)
  const { data: connections } = await admin
    .from('gmail_connections')
    .select('google_sub')
    .in('id', connectionIds);

  if (!connections) return 0;

  // Count distinct Google accounts (google_sub)
  const uniqueGoogleAccounts = new Set(
    connections.map(r => r.google_sub).filter(Boolean)
  );

  return uniqueGoogleAccounts.size;
}

/**
 * Gmail Scan Attempts = total Gmail scan operations initiated/completed.
 * 
 * DEFINITION:
 * - Counts ALL completed scan jobs
 * - Zero-result scans count
 * - Repeated scans from same Gmail account increase this count
 * - Failed scans do NOT count (only status='complete')
 */
async function countGmailScanAttempts(
  admin: ReturnType<typeof createAdminClient>
): Promise<number> {
  const { count } = await admin
    .from('gmail_sync_jobs')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'complete');

  return count ?? 0;
}

/**
 * Gmail Feature Users = unique JobTrackOS users who used Gmail integration.
 * 
 * DEFINITION:
 * - Counts USERS, not Gmail accounts
 * - User who tested 3 Gmail accounts = 1 feature user
 * - Requires at least one completed scan
 * - This is USER adoption (different from Gmail Accounts Tested)
 */
async function countGmailFeatureUsers(
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
 * Gmail Currently Connected = number of active Gmail integrations right now.
 * 
 * DEFINITION:
 * - Counts active gmail_connections records
 * - This is an operational state metric, not adoption
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

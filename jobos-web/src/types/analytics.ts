/**
 * Analytics types for founder dashboard.
 *
 * Metrics are derived from existing source-of-truth tables plus minimal
 * user_session_activity tracking.
 */

export interface DashboardMetrics {
  /** Snapshot timestamp */
  generatedAt: string;

  /** Date when analytics tracking began (for new metrics) */
  trackingSince: string;

  /** User metrics */
  users: {
    /** Total registered users from auth.users */
    total: number;
    /** New users in last 7 days */
    new7d: number;
    /** New users in last 30 days */
    new30d: number;
    /** Users with authenticated sessions (7d) - tracking since [date] */
    active7d: number;
    /** Users with authenticated sessions (30d) - tracking since [date] */
    active30d: number;
    /** Users with meaningful product actions (7d) - from existing tables */
    engaged7d: number;
    /** Users with meaningful product actions (30d) - from existing tables */
    engaged30d: number;
    /** Users active on 2+ distinct days - tracking since [date] */
    returning: number;
  };

  /** Feature adoption from existing tables */
  adoption: {
    /** Users with active Gmail connection */
    gmailConnected: number;
    /** Percentage of total users */
    gmailConnectedPercent: number;
    /** Users who completed at least one Resume Match */
    resumeMatchUsers: number;
    /** Percentage of total users */
    resumeMatchUsersPercent: number;
  };

  /** Activity from existing tables */
  activity: {
    /** Total applications created */
    totalApplications: number;
    /** Applications created in last 7 days */
    applications7d: number;
    /** Applications created in last 30 days */
    applications30d: number;
    /** Total Gmail syncs completed */
    totalGmailSyncs: number;
    /** Gmail syncs completed in last 7 days */
    gmailSyncs7d: number;
    /** Gmail syncs completed in last 30 days */
    gmailSyncs30d: number;
    /** Total resume analyses completed */
    totalResumeAnalyses: number;
    /** Resume analyses completed in last 7 days */
    resumeAnalyses7d: number;
    /** Resume analyses completed in last 30 days */
    resumeAnalyses30d: number;
    /** Total resumes uploaded/created */
    totalResumes: number;
  };

  /** Applications by status breakdown */
  applicationsByStatus: Array<{ status: string; count: number }>;

  /** Daily signup trend (last 30 days) */
  signupTrend: Array<{ date: string; count: number }>;
}

/** Event stored in analytics_events table */
export interface AnalyticsEvent {
  id: string;
  user_id: string;
  event_name: 'user_session_activity';
  metadata: {
    session_date?: string; // YYYY-MM-DD in UTC
  } | null;
  created_at: string;
}

/** Track event request payload */
export interface TrackEventRequest {
  event_name: 'user_session_activity';
  metadata?: {
    session_date?: string;
  };
}

/** Track event response */
export interface TrackEventResponse {
  success: boolean;
  /** True if event was inserted, false if deduplicated */
  inserted: boolean;
}

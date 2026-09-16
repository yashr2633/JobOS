/**
 * Analytics types for founder BETA dashboard.
 *
 * Metrics are derived from existing source-of-truth tables plus minimal
 * user_session_activity tracking. All adoption metrics show both count and
 * percentage of registered users.
 */

export interface DashboardMetrics {
  /** Snapshot timestamp */
  generatedAt: string;

  /** Date when analytics tracking began (for session/returning metrics) */
  trackingSince: string;

  /** BETA OVERVIEW - User Metrics */
  users: {
    /** Total registered legitimate accounts from auth.users */
    registered: number;
    /** Users with authenticated sessions in last 7 days */
    active7d: number;
    /** Users with authenticated sessions in last 30 days */
    active30d: number;
    /** Users with meaningful core product actions in last 30 days */
    engaged30d: number;
    /** Users active on 2+ distinct days since tracking began */
    returning: number;
  };

  /** GMAIL INTEGRATION METRICS */
  gmail: {
    /** Distinct Gmail accounts/integrations that reached a scan (including zero-result) */
    accountsTested: number;
    /** Total Gmail scan operations (including zero-result scans) */
    scanAttempts: number;
    /** Unique JobTrackOS users who used Gmail integration */
    featureUsers: {
      count: number;
      total: number;
      percent: number;
    };
    /** Active Gmail integrations right now */
    currentlyConnected: number;
  };

  /** PRODUCT ADOPTION - Users / Registered Users (%) */
  adoption: {
    /** Users who completed at least one meaningful core workflow */
    activated: {
      count: number;
      total: number;
      percent: number;
    };
    /** Users who completed at least one Resume Match analysis */
    resumeMatchUsers: {
      count: number;
      total: number;
      percent: number;
    };
  };

  /** PRODUCT USAGE - Activity Metrics */
  usage: {
    /** Unique canonical application records */
    applicationsTracked: number;
    /** Applications added in last 7 days */
    applicationsAdded7d: number;
    /** Applications added in last 30 days */
    applicationsAdded30d: number;
    /** Successful Gmail scan/sync operations */
    gmailScansCompleted: number;
    /** Gmail scans in last 7 days */
    gmailScans7d: number;
    /** Gmail scans in last 30 days */
    gmailScans30d: number;
    /** Successful Resume Match analyses completed */
    resumeAnalysesCompleted: number;
    /** Resume analyses in last 7 days */
    resumeAnalyses7d: number;
    /** Resume analyses in last 30 days */
    resumeAnalyses30d: number;
    /** Unique resume records uploaded */
    resumesUploaded: number;
  };

  /** Applications by status breakdown */
  applicationsByStatus: Array<{ status: string; count: number }>;
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

import type {
  ApplicationStatus,
  ApplicationStatusSource,
} from "../applications/types";

/*
 * The `DashboardStats` shape was removed with the unlinked stat row it fed. KPI
 * figures are now carried by `WindowReport` in `report.ts`, which keeps them
 * attached to the window they were counted over.
 */

/**
 * One recent-activity row: exactly one recorded `application_status_history`
 * event.
 *
 * This REPLACES the earlier shape, which reported an "Applied to X" row per
 * application dated with `applied_date`, because no status history existed to
 * date a real event from. History exists now, so every row here is a change that
 * actually happened, at the moment it actually happened. Nothing is derived from
 * `applied_date`, `updated_at`, or the application's current status — an
 * application with no recorded change produces no row at all.
 */
export interface ActivityItem {
  /** The history row's id, so two events on one application stay distinct. */
  id: string;
  applicationId: string;
  company: string;
  role: string;
  /** The real `changed_at` of the recorded event. */
  timestamp: string;
  /** The status this event moved the application TO. */
  status: ApplicationStatus;
  source: ApplicationStatusSource;
  /** Human sentence for the event, built from the status and the company. */
  label: string;
  note: string | null;
}

export interface WeeklyData {
  week: string;
  applications: number;
}

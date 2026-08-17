/**
 * Recent activity — built ONLY from recorded status history.
 *
 * This reverses an earlier decision. Recent activity used to emit one
 * "Applied to X" row per application, dated with `applied_date`, because the
 * schema recorded no status changes and that was the only timestamp available.
 * `application_status_history` now records real events with real timestamps, so
 * every row here is a change that actually happened, at the moment it happened.
 *
 * Nothing is inferred. Not from `applied_date`, not from `updated_at`, not from
 * the application's current status. An application whose status has never
 * changed since history started being recorded contributes NO rows, and the
 * dashboard says the feed is empty. That is the honest reading — it is not a
 * missing feature.
 *
 * Pure: no network, no Supabase, no React, no clock. Imported by relative path
 * with an explicit `.ts` extension so this module and its test stay runnable
 * under `node --test`.
 */

import type {
  Application,
  ApplicationStatus,
  ApplicationStatusHistory,
} from "../applications/types.ts";
import type { ActivityItem } from "./types.ts";

/** Rows the dashboard panel shows. */
export const RECENT_ACTIVITY_LIMIT = 5;

/**
 * The sentence shown for an event.
 *
 * Built from the target status and the employer, both of which are persisted
 * facts. There is no "current status" wording, because a row is an event, not a
 * state.
 */
export function describeStatusEvent(
  status: ApplicationStatus,
  company: string
): string {
  switch (status) {
    case "Applied":
      return `Applied to ${company}`;
    case "Interview":
      return `Moved to Interview at ${company}`;
    case "Offer":
      return `Offer received from ${company}`;
    case "Rejected":
      return `Application rejected by ${company}`;
    case "Ghosted":
      return `Marked Ghosted at ${company}`;
  }
}

/** The fields the feed needs from an application, so a full row is not required. */
type ActivityApplication = Pick<Application, "id" | "company" | "role">;

/**
 * Turn recorded status changes into feed rows, newest first.
 *
 * `history` may arrive in any order; it is sorted by the stored `changed_at`, so
 * the feed's order is the order things actually happened. An event whose
 * application is not in `applications` is dropped rather than shown with a
 * placeholder employer: the company name is the point of the row, and inventing
 * one would be the exact fabrication this module exists to avoid.
 */
export function buildRecentActivity(
  history: readonly ApplicationStatusHistory[],
  applications: readonly ActivityApplication[],
  limit: number = RECENT_ACTIVITY_LIMIT
): ActivityItem[] {
  const byId = new Map<string, ActivityApplication>();
  for (const application of applications) byId.set(application.id, application);

  const dated = history
    .map((event) => ({ event, time: Date.parse(event.changedAt) }))
    // An unparseable timestamp cannot be placed in the feed's order, and the
    // feed is ordered by time, so it is excluded rather than guessed at.
    .filter((entry) => Number.isFinite(entry.time))
    .sort((a, b) => b.time - a.time);

  const items: ActivityItem[] = [];

  for (const { event } of dated) {
    if (items.length >= Math.max(0, limit)) break;

    const application = byId.get(event.applicationId);
    if (application === undefined) continue;

    items.push({
      id: event.id,
      applicationId: event.applicationId,
      company: application.company,
      role: application.role,
      // The real recorded moment, never a substitute.
      timestamp: event.changedAt,
      status: event.toStatus,
      source: event.source,
      label: describeStatusEvent(event.toStatus, application.company),
      note: event.note,
    });
  }

  return items;
}

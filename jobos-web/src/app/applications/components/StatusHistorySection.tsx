"use client";

import { useEffect, useState } from "react";
import type {
  ApplicationStatusHistory,
  ApplicationStatusSource,
} from "../types";
import StatusBadge from "./StatusBadge";
import { createClient } from "@/lib/supabase/client";
import { fetchApplicationStatusHistory } from "@/lib/api/applications";
import { toHumanMessage } from "../../components/errorMessage";

/**
 * The recorded status trail for one application, oldest first.
 *
 * Shows only rows that exist. An application whose status has not changed since
 * status history started being recorded has no rows, and that is stated plainly
 * rather than filled in with an "Applied" event invented from `applied_date`.
 */

/** Exact wording for the empty state. */
const EMPTY_MESSAGE = "No status history available yet.";

const sourceLabels: Record<ApplicationStatusSource, string> = {
  manual: "Changed by you",
  gmail: "From Gmail evidence",
  system: "Set automatically",
};

/** Date and time of a real recorded change. Never a derived timestamp. */
function formatChangedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";

  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

interface StatusHistorySectionProps {
  applicationId: string;
}

export default function StatusHistorySection({
  applicationId,
}: StatusHistorySectionProps) {
  const [events, setEvents] = useState<ApplicationStatusHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) throw new Error("You must be signed in to see this history.");

        // Scoped to the acting user as well as to the application, so a known
        // application id alone never reaches another user's trail.
        const history = await fetchApplicationStatusHistory(
          supabase,
          user.id,
          applicationId
        );
        if (!cancelled) setEvents(history);
      } catch (err: unknown) {
        if (!cancelled) {
          setError(toHumanMessage(err, "Could not load the status history."));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [applicationId]);

  return (
    <section className="mt-6 border-t border-border pt-5">
      <h3 className="text-xs font-medium uppercase tracking-wide text-text-muted">
        Status History
      </h3>

      {loading && (
        <p className="mt-3 text-sm text-text-muted">Loading status history…</p>
      )}

      {!loading && error !== null && (
        <p className="mt-3 text-sm text-danger">{error}</p>
      )}

      {!loading && error === null && events.length === 0 && (
        <p className="mt-3 text-sm text-text-muted">{EMPTY_MESSAGE}</p>
      )}

      {!loading && error === null && events.length > 0 && (
        <ol className="mt-3 space-y-3">
          {events.map((event) => (
            <li
              key={event.id}
              className="rounded-md border border-border bg-bg/50 px-3 py-2.5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={event.toStatus} />
                {event.fromStatus !== null && (
                  <span className="text-xs text-text-muted">
                    from {event.fromStatus}
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-xs text-text-muted">
                {formatChangedAt(event.changedAt)} ·{" "}
                {sourceLabels[event.source]}
              </p>
              {event.note !== null && (
                <p className="mt-1.5 text-xs text-text-secondary">{event.note}</p>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

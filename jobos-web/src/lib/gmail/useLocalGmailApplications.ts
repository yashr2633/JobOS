/**
 * React hook to load local Gmail applications from IndexedDB.
 *
 * CLIENT ONLY - provides local applications to UI components.
 */

"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  getGmailApplicationsForUser,
  getGmailApplicationCountsByStatus,
  type LocalGmailApplication,
} from "./browserStore";
import type { ApplicationStatus } from "@/app/applications/types";

export interface UseLocalGmailApplicationsResult {
  applications: LocalGmailApplication[];
  counts: Record<ApplicationStatus, number>;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Load local Gmail applications for the current user from IndexedDB.
 */
export function useLocalGmailApplications(): UseLocalGmailApplicationsResult {
  const [applications, setApplications] = useState<LocalGmailApplication[]>([]);
  const [counts, setCounts] = useState<Record<ApplicationStatus, number>>({
    Applied: 0,
    Interview: 0,
    Offer: 0,
    Rejected: 0,
    Ghosted: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadApplications = async () => {
    try {
      setLoading(true);
      setError(null);

      // Get current user
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        setApplications([]);
        setCounts({
          Applied: 0,
          Interview: 0,
          Offer: 0,
          Rejected: 0,
          Ghosted: 0,
        });
        setLoading(false);
        return;
      }

      // Load from IndexedDB
      const [apps, statusCounts] = await Promise.all([
        getGmailApplicationsForUser(user.id),
        getGmailApplicationCountsByStatus(user.id),
      ]);

      setApplications(apps);
      setCounts(statusCounts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load local applications");
      setApplications([]);
      setCounts({
        Applied: 0,
        Interview: 0,
        Offer: 0,
        Rejected: 0,
        Ghosted: 0,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadApplications();

    const handleLocalGmailChange = () => {
      void loadApplications();
    };

    window.addEventListener(
      "jobos:gmail-applications-changed",
      handleLocalGmailChange
    );

    return () => {
      window.removeEventListener(
        "jobos:gmail-applications-changed",
        handleLocalGmailChange
      );
    };
  }, []);

  return {
    applications,
    counts,
    loading,
    error,
    refresh: loadApplications,
  };
}

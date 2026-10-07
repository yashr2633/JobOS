/**
 * React hook to load local Gmail applications from IndexedDB.
 *
 * CLIENT ONLY - provides local applications to UI components.
 */

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  getGmailApplicationsForUser,
  type LocalGmailApplication,
} from "./browserStore";
import type { ApplicationStatus } from "@/app/applications/types";
import { consolidateLocalApplications } from "./localApplications";

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
  const requestNumber = useRef(0);

  const loadApplications = useCallback(async () => {
    const request = ++requestNumber.current;
    try {
      setLoading(true);
      setError(null);

      // Get current user
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (request !== requestNumber.current) return;

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
      const apps = consolidateLocalApplications(await getGmailApplicationsForUser(user.id));
      if (request !== requestNumber.current) return;
      const statusCounts: Record<ApplicationStatus, number> = {Applied:0, Interview:0, Offer:0, Rejected:0, Ghosted:0};
      for (const app of apps) statusCounts[app.status]++;

      setApplications(apps);
      setCounts(statusCounts);
    } catch (err) {
      if (request !== requestNumber.current) return;
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
      if (request === requestNumber.current) setLoading(false);
    }
  }, []);

  const invalidateRequest = useCallback(() => { requestNumber.current++; }, []);

  useEffect(() => {
    const { data: { subscription } } = createClient().auth.onAuthStateChange((event) => {
      if (event === "INITIAL_SESSION" || event === "SIGNED_OUT" || event === "SIGNED_IN") {
        setApplications([]);
        void loadApplications();
      }
    });

    const handleLocalGmailChange = () => {
      void loadApplications();
    };

    window.addEventListener(
      "jobos:gmail-applications-changed",
      handleLocalGmailChange
    );

    return () => {
      invalidateRequest();
      subscription.unsubscribe();
      window.removeEventListener(
        "jobos:gmail-applications-changed",
        handleLocalGmailChange
      );
    };
  }, [loadApplications, invalidateRequest]);

  return {
    applications,
    counts,
    loading,
    error,
    refresh: loadApplications,
  };
}

/**
 * React hook to provide merged server + local Gmail applications.
 *
 * CLIENT ONLY - merges Supabase applications with IndexedDB Gmail applications.
 */

"use client";

import { useMemo } from "react";
import type { Application } from "@/app/applications/types";
import { useLocalGmailApplications } from "./useLocalGmailApplications";
import type { LocalGmailApplication } from "./browserStore";

/**
 * Convert local Gmail application to Application shape for UI.
 */
function localToApplication(local: LocalGmailApplication): Application {
  return {
    id: local.id,
    company: local.company || "Unknown Company",
    role: local.role || "Unknown Role",
    location: "",
    jobPortal: local.source || "Email", // Use actual source (portal name or "Email")
    appliedDate: local.appliedDate,
    status: local.status,
    salary: undefined,
    jobDescription: undefined,
    gmailMessageId: local.gmailMessageId,
    gmailAddress: null,
  };
}

/**
 * Deduplicate server + local applications conservatively.
 * 
 * Keep server records, mark potential local duplicates.
 */
function deduplicateApplications(
  server: Application[],
  local: Application[]
): Application[] {
  const result = [...server];
  const seen = new Set<string>();

  // Track server applications by company + role + date (normalized)
  for (const app of server) {
    const key = [
      app.gmailMessageId ?? app.id,
    ].join("|");
    seen.add(key);
  }

  // Add local applications that don't match server records
  for (const app of local) {
    const key = [
      app.gmailMessageId ?? app.id,
    ].join("|");

    if (!seen.has(key)) {
      result.push(app);
      seen.add(key);
    }
  }

  return result;
}

export interface UseMergedApplicationsResult {
  applications: Application[];
  loading: boolean;
  error: string | null;
  serverCount: number;
  localCount: number;
  mergedCount: number;
}

/**
 * Merge server and local Gmail applications for unified UI display.
 */
export function useMergedApplications(
  serverApplications: Application[]
): UseMergedApplicationsResult {
  const {
    applications: localApps,
    loading: localLoading,
    error: localError,
  } = useLocalGmailApplications();

  const merged = useMemo(() => {
    if (!localLoading && !localError) {
      const localAsApps = localApps.map(localToApplication);
      const deduplicated = deduplicateApplications(serverApplications, localAsApps);
      return deduplicated;
    } else {
      return serverApplications;
    }
  }, [serverApplications, localApps, localLoading, localError]);

  return {
    applications: merged,
    loading: localLoading,
    error: localError,
    serverCount: serverApplications.length,
    localCount: localApps.length,
    mergedCount: merged.length,
  };
}

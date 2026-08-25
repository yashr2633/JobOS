/**
 * Client-side wrapper for PortalBreakdown that merges server + Gmail applications.
 *
 * The dashboard page is server-rendered for performance, but portal distribution
 * MUST include browser-local Gmail applications from IndexedDB. This component
 * hydrates on the client, reads IndexedDB, merges with server applications, and
 * computes the correct portal distribution.
 */

"use client";

import { useEffect, useState } from "react";
import PortalBreakdown from "./PortalBreakdown";
import { computePortalDistribution } from "../metrics";
import { useLocalGmailApplications } from "@/lib/gmail/useLocalGmailApplications";
import type { Application } from "@/app/applications/types";

interface PortalBreakdownClientProps {
  /** Server applications from initial SSR. */
  serverApplications: Application[];
  windowDays: number;
}

/**
 * Merge server + local Gmail applications and compute portal distribution.
 *
 * Deduplicates conservatively: server records win, local records are added only
 * if they don't match any server record by (company, role, appliedDate).
 */
export default function PortalBreakdownClient({
  serverApplications,
  windowDays,
}: PortalBreakdownClientProps) {
  const { applications: localApps, loading, error } = useLocalGmailApplications();
  const [mergedApplications, setMergedApplications] = useState<Application[]>(
    serverApplications
  );

  useEffect(() => {
    if (loading || error) {
      // While loading or on error, use server data only
      setMergedApplications(serverApplications);
      return;
    }

    // Convert local Gmail apps to Application shape
    const localAsApps: Application[] = localApps.map((local) => ({
      id: local.id,
      company: local.company || "Unknown Company",
      role: local.role || "Unknown Role",
      location: "",
      jobPortal: local.source || "Unknown", // source field already has display name (LinkedIn, Email, etc.)
      appliedDate: local.appliedDate,
      status: local.status,
      salary: undefined,
      jobDescription: undefined,
      gmailMessageId: local.gmailMessageId,
      gmailAddress: null,
    }));

    // Deduplicate: server applications + non-duplicate local applications
    const seen = new Set<string>();
    const merged: Application[] = [...serverApplications];

    // Track server applications
    for (const app of serverApplications) {
      const key = [
        app.company.toLowerCase().trim(),
        app.role.toLowerCase().trim(),
        app.appliedDate,
      ].join("|");
      seen.add(key);
    }

    // Add local applications that don't duplicate server records
    for (const app of localAsApps) {
      const key = [
        app.company.toLowerCase().trim(),
        app.role.toLowerCase().trim(),
        app.appliedDate,
      ].join("|");

      if (!seen.has(key)) {
        merged.push(app);
        seen.add(key);
      }
    }

    setMergedApplications(merged);
  }, [serverApplications, localApps, loading, error]);

  // Compute portal distribution from merged dataset
  const portals = computePortalDistribution(mergedApplications);
  const hasData =
    mergedApplications.length > 0 &&
    portals.some((entry) => entry.portal !== "Unknown");

  return (
    <PortalBreakdown
      portals={portals}
      hasData={hasData}
      windowDays={windowDays}
    />
  );
}

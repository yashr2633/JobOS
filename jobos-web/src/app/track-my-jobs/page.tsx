/**
 * Track My Jobs — the results-first Gmail workspace.
 *
 * Server component. It reads everything the workspace needs in one pass so the
 * client renders immediately with no data waterfall, and so the Gmail data layer
 * (which touches token columns) stays out of the browser bundle.
 *
 * This page is NOT an approval queue. Ordinary lifecycle applications are
 * organized automatically by the Auto_Importer during the scan; what is rendered
 * here is what that already did, plus the two kinds of exception it refused to
 * guess at:
 *
 *   - held proposals            — ambiguous, so they still offer import/merge/ignore
 *   - Unknown-bucket entries    — no employer could be determined, so the user names one
 *
 * Held-ness is never re-derived here: `selectPendingDecisions` runs the same
 * decision table the importer ran, so the workspace and the importer cannot
 * disagree about what was left undone.
 */

import { redirect } from "next/navigation";
import AppShell from "@/app/components/AppShell";
import { createClient } from "@/lib/supabase/server";
import { getGmailConnection } from "@/lib/api/gmail";
import {
  countActivityRows,
  countEvidenceByReason,
  countUnknownBucket,
  fetchLifecycleActivityForAutoImport,
  fetchOrganizedActivity,
  fetchUnknownBucket,
  getLatestSyncJob,
  getOpenSyncJob,
  getThreadApplicationLinks,
  type GmailActivityRow,
} from "@/lib/api/gmailActivity";
import { fetchApplications } from "@/lib/api/applications";
import { buildProposals } from "@/lib/gmail/proposals";
import { selectPendingDecisions } from "@/lib/gmail/pendingDecisions";
import { inferStatusFromCategory } from "@/lib/gmail/statusInference";
import TrackMyJobsWorkspace, {
  type OrganizedApplicationView,
  type UnknownEntryView,
} from "./components/TrackMyJobsWorkspace";

/** How many organized applications the collapsed section lists. */
const ORGANIZED_LIMIT = 25;

/**
 * Excluded mail, straight from the persisted reason codes.
 *
 * The gate's exclusion codes all share the `excluded_` prefix, so the tally is a
 * sum over real ledger rows rather than an estimate. Nothing is counted twice:
 * one ledger row carries exactly one reason code.
 */
function countExcluded(reasonCounts: Record<string, number>): number {
  let total = 0;
  for (const [reason, count] of Object.entries(reasonCounts)) {
    if (reason.startsWith("excluded_")) total += count;
  }
  return total;
}

/** ISO timestamp -> the newest of two, tolerating nulls and unparseable input. */
function newer(left: string | null, right: string | null): string | null {
  const a = left ? Date.parse(left) : Number.NaN;
  const b = right ? Date.parse(right) : Number.NaN;
  if (!Number.isFinite(a)) return Number.isFinite(b) ? right : null;
  if (!Number.isFinite(b)) return left;
  return a >= b ? left : right;
}

/**
 * Group linked activity by application, so each organized row carries the ids a
 * "Not mine" (`reject`) decision needs.
 */
function groupOrganized(
  rows: GmailActivityRow[],
  applications: { id: string; company: string; role: string; status: string; jobPortal: string; appliedDate: string }[]
): OrganizedApplicationView[] {
  const byId = new Map(applications.map((application) => [application.id, application]));
  const grouped = new Map<string, OrganizedApplicationView>();

  for (const row of rows) {
    const applicationId = row.application_id;
    if (applicationId === null) continue;

    const application = byId.get(applicationId);
    // A link whose application is gone (deleted between the two reads) has
    // nothing to show, and rejecting it would name an application that no
    // longer exists.
    if (!application) continue;

    const existing = grouped.get(applicationId);
    if (existing) {
      existing.activityIds.push(row.id);
      existing.evidenceCount += 1;
      existing.lastActivityAt = newer(existing.lastActivityAt, row.email_date);
      continue;
    }

    grouped.set(applicationId, {
      applicationId,
      company: application.company,
      role: application.role,
      status: application.status,
      jobPortal: application.jobPortal,
      appliedDate: application.appliedDate,
      activityIds: [row.id],
      evidenceCount: 1,
      lastActivityAt: row.email_date,
    });
  }

  return [...grouped.values()]
    .sort((a, b) => {
      const left = a.lastActivityAt ? Date.parse(a.lastActivityAt) : 0;
      const right = b.lastActivityAt ? Date.parse(b.lastActivityAt) : 0;
      return right - left;
    })
    .slice(0, ORGANIZED_LIMIT);
}

export default async function TrackMyJobsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Defence in depth; middleware also protects /track-my-jobs.
  if (!user) {
    redirect("/login?next=/track-my-jobs");
  }

  // Independent reads, so run them concurrently rather than as a waterfall.
  // Each is settled separately: one failure must not blank the whole page.
  const [
    connectionResult,
    activityResult,
    applicationsResult,
    openJobResult,
    latestJobResult,
    bucketResult,
    bucketCountResult,
    organizedResult,
    activityCountResult,
  ] = await Promise.allSettled([
    getGmailConnection(supabase, user.id),
    fetchLifecycleActivityForAutoImport(supabase, user.id),
    fetchApplications(supabase),
    getOpenSyncJob(supabase, user.id),
    getLatestSyncJob(supabase, user.id),
    fetchUnknownBucket(supabase, user.id),
    countUnknownBucket(supabase, user.id),
    fetchOrganizedActivity(supabase, user.id),
    countActivityRows(supabase, user.id),
  ]);

  for (const result of [
    connectionResult,
    activityResult,
    applicationsResult,
    openJobResult,
    latestJobResult,
    bucketResult,
    bucketCountResult,
    organizedResult,
    activityCountResult,
  ]) {
    if (result.status === "rejected") {
      console.error("[track-my-jobs] Load failure:", result.reason);
    }
  }

  const connection =
    connectionResult.status === "fulfilled" ? connectionResult.value : null;
  const activity =
    activityResult.status === "fulfilled" ? activityResult.value : [];
  const applications =
    applicationsResult.status === "fulfilled" ? applicationsResult.value : [];
  const openJob =
    openJobResult.status === "fulfilled" ? openJobResult.value : null;
  const latestJob =
    latestJobResult.status === "fulfilled" ? latestJobResult.value : null;
  const bucketRows = bucketResult.status === "fulfilled" ? bucketResult.value : [];
  const unknownTotal =
    bucketCountResult.status === "fulfilled" ? bucketCountResult.value : 0;
  const organizedRows =
    organizedResult.status === "fulfilled" ? organizedResult.value : [];
  // Null, not 0, when the count could not be read: the panel renders an unknown
  // number as "—" rather than claiming nothing was scanned.
  const scanned =
    activityCountResult.status === "fulfilled" ? activityCountResult.value : null;

  // Excluded mail is tallied over the WHOLE ledger, matching `scanned` being
  // cumulative. Scoping it to the latest job's start made it read 0 whenever
  // that job was a no-op — every message it listed had already been ledgered, so
  // it processed nothing and there was nothing in its window to tally.
  let excluded: number | null = null;
  try {
    excluded = countExcluded(await countEvidenceByReason(supabase, user.id));
  } catch (error) {
    console.error("[track-my-jobs] Evidence reason tally failed:", error);
  }

  // Thread links let tier-1 matching attach follow-ups to the right application.
  const threadIds = activity
    .map((row) => row.gmail_thread_id)
    .filter((id): id is string => typeof id === "string");

  let threadLinks = new Map<string, string>();
  try {
    threadLinks = await getThreadApplicationLinks(supabase, user.id, threadIds);
  } catch (error) {
    console.error("[track-my-jobs] Thread link load failed:", error);
  }

  const candidates = applications.map((application) => ({
    id: application.id,
    company: application.company,
    role: application.role,
    appliedDate: application.appliedDate,
    jobUrl: null,
  }));

  const ownedApplicationIds = new Set(applications.map((application) => application.id));

  // Grouping, matching, status resolution, and the DERIVED Ghosted state all
  // happen in pure logic, from evidence already read under RLS. The decision
  // table then classifies each proposal exactly as the importer classified it.
  const proposals = buildProposals(activity, candidates, threadLinks);
  const pending = selectPendingDecisions(proposals, bucketRows, {
    ownedApplicationIds,
  });

  // Only the ambiguous holds are questions with import/merge/ignore answers
  // (design §11). An unknown-employer hold is answered by naming the employer,
  // and its evidence is already listed in the Unknown-applications section, so
  // repeating it here would ask the same thing twice.
  const heldProposals = pending.heldProposals
    .filter((held) => held.action === "hold_ambiguous")
    .map((held) => ({
      key: held.proposal.key,
      activityIds: held.proposal.activityIds,
      company: held.proposal.company,
      jobTitle: held.proposal.jobTitle,
      jobPortal: held.proposal.jobPortal,
      location: held.proposal.location,
      appliedDate: held.proposal.appliedDate,
      lastActivityAt: held.proposal.lastActivityAt,
      status: held.proposal.status,
      confidence: held.proposal.confidence,
      evidenceCount: held.proposal.evidence.length,
      suggestedApplicationId: held.proposal.suggestedApplicationId,
      reason: held.reason,
    }));

  // Compact evidence only: category, sender domain, portal, date, reason code.
  // The status each entry would start at is inferred from its lifecycle category
  // here, server-side, so the client never needs the inference rules.
  const unknownEntries: UnknownEntryView[] = pending.unknownEntries.map((entry) => ({
    activityId: entry.activityId,
    category: entry.category,
    senderDomain: entry.senderDomain,
    jobPortal: entry.jobPortal,
    emailDate: entry.emailDate,
    reason: entry.reason,
    status: inferStatusFromCategory(entry.category),
  }));

  const organized = groupOrganized(organizedRows, applications);

  return (
    <AppShell maxWidth="5xl">
      <>
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-text">
            Track My Jobs
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            JobTrackOS organizes what it recognizes and asks you only about the
            uncertain cases
          </p>
        </div>

        <TrackMyJobsWorkspace
              connected={connection !== null}
              lastSyncAt={connection?.lastSyncAt ?? null}
              resumable={openJob !== null}
              initialProgress={
                openJob
                  ? {
                      messagesSeen: openJob.messagesSeen,
                      candidates: openJob.candidates,
                    }
                  : null
              }
              scanSummary={{
                // Persisted per job, so the last scan's own delta survives the
                // request that produced it. No job at all means no figure —
                // null renders as "—" rather than as a fabricated zero.
                created: latestJob?.applicationsFound ?? null,
                updated: latestJob?.applicationsUpdated ?? null,
                // Cumulative ledger facts, because the last scan can legitimately
                // have processed nothing: everything it listed was already known.
                scanned,
                excluded,
              }}
              heldProposals={heldProposals}
              unknownEntries={unknownEntries}
              unknownTotal={unknownTotal}
              organized={organized}
          existingApplications={applications.map((application) => ({
            id: application.id,
            company: application.company,
            role: application.role,
          }))}
        />
      </>
    </AppShell>
  );
}

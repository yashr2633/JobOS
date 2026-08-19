/**
 * Dashboard — the command centre.
 *
 * Two kinds of number live on this page and they are kept structurally apart:
 *
 *   REPORTING   Applications in the selected window, counted from rows of the
 *               `applications` table by `computeWindowReport`. That function
 *               takes no message counter as input, so `messagesListed`,
 *               `messagesDeduplicated`, `messagesFresh` and `messagesSeen`
 *               cannot reach a KPI even by accident. A repeated scan of the same
 *               window therefore still reports the COMPLETE set for that window:
 *               0 fresh messages and 22 applications in the window is
 *               Total Applications = 22.
 *
 *   SCANNING    What one Gmail scan read and changed, reported by the scan
 *               module below in its own labelled panel.
 *
 * The reporting window is a URL search param (`?window=30d`), so refresh,
 * back/forward and shared links all report the same period. Its default is
 * recovered from the latest COMPLETED scan's persisted bounds, and falls back to
 * the 30-day default when no scan has completed.
 *
 * Every read is settled separately: one failure must not blank the page, and an
 * unknown is rendered as "—" or as an explicit notice, never as a zero.
 */

import AppShell from "./components/AppShell";
import {
  RECENT_ACTIVITY_LIMIT,
  buildRecentActivity,
} from "./dashboard/recentActivity";
import { computeWindowReport } from "./dashboard/report";
import {
  firstParamValue,
  reportingWindowDays,
  resolveReportingWindow,
} from "./dashboard/reportingWindow";
import KpiRow from "./dashboard/components/KpiRow";
import ReportingWindowControl from "./dashboard/components/ReportingWindowControl";
import StatusDistribution from "./dashboard/components/StatusDistribution";
import PortalBreakdown from "./dashboard/components/PortalBreakdown";
import ActivityChart from "./dashboard/components/ActivityChart";
import RecentActivity from "./dashboard/components/RecentActivity";
import QuickActions from "./dashboard/components/QuickActions";
import GmailScanModule from "./dashboard/components/GmailScanModule";
import { createClient } from "@/lib/supabase/server";
import {
  fetchApplications,
  fetchRecentStatusHistory,
} from "@/lib/api/applications";
import type {
  Application,
  ApplicationStatusHistory,
} from "./applications/types";

interface HomeProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function Home({ searchParams }: HomeProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // PUBLIC HOMEPAGE (required for Google OAuth brand verification).
  //
  // Signed-out visitors — including Google's verification reviewers — get a
  // public marketing landing that names the product, explains what it does, and
  // links to the legal pages, with NO authenticated data access. Signed-in users
  // fall through to the dashboard below. This is a server-side branch, so the
  // homepage's primary content never depends on client-side authentication.
  if (!user) {
    return <PublicHome />;
  }

  // The window param is read here and narrowed below. It is never trusted raw.
  const params = await searchParams;
  const requestedWindow = firstParamValue(params.window);

  // Applications, status history, the Gmail connection and the scan facts are
  // independent reads, so run them concurrently rather than as a sequential
  // waterfall. Each is settled separately so one failure cannot blank the whole
  // dashboard. Every Gmail module is imported dynamically inside the read, so
  // none of that data-access code can be pulled toward the client bundle.
  const [
    applicationsResult,
    statusHistoryResult,
    gmailResult,
    reviewResult,
    unknownBucketResult,
    opportunityCountResult,
    latestJobResult,
    latestCompletedJobResult,
    openJobResult,
  ] = await Promise.allSettled([
    fetchApplications(supabase),
    // Recent activity is built from these rows and from nothing else.
    user
      ? fetchRecentStatusHistory(supabase, user.id, RECENT_ACTIVITY_LIMIT)
      : Promise.resolve<ApplicationStatusHistory[]>([]),
    user
      ? import("@/lib/api/gmail").then(({ getGmailConnection }) =>
          // Pass the known user id so this does not repeat getUser().
          getGmailConnection(supabase, user.id)
        )
      : Promise.resolve(null),
    user
      ? import("@/lib/api/gmailActivity").then(({ fetchUnlinkedActivity }) =>
          fetchUnlinkedActivity(supabase, user.id, 200)
        )
      : Promise.resolve([]),
    user
      ? import("@/lib/api/gmailActivity").then(({ countUnknownBucket }) =>
          // Counted in the database: the entry point needs N, not the rows.
          countUnknownBucket(supabase, user.id)
        )
      : Promise.resolve(0),
    user
      ? import("@/lib/api/gmailActivity").then(({ countJobOpportunities }) =>
          // Opportunities are counted, never listed as applications.
          countJobOpportunities(supabase, user.id)
        )
      : Promise.resolve(0),
    user
      ? import("@/lib/api/gmailActivity").then(({ getLatestSyncJob }) =>
          getLatestSyncJob(supabase, user.id)
        )
      : Promise.resolve(null),
    user
      ? import("@/lib/api/gmailActivity").then(
          ({ getLatestCompletedSyncJob }) =>
            // Read-only: its stored bounds are what the default reporting window
            // is recovered from.
            getLatestCompletedSyncJob(supabase, user.id)
        )
      : Promise.resolve(null),
    user
      ? import("@/lib/api/gmailActivity").then(({ getOpenSyncJob }) =>
          getOpenSyncJob(supabase, user.id)
        )
      : Promise.resolve(null),
  ]);

  let applications: Application[] = [];
  if (applicationsResult.status === "fulfilled") {
    applications = applicationsResult.value;
  } else {
    console.error("Error fetching applications:", applicationsResult.reason);
  }
  // Drives an explicit notice: an empty stat row would otherwise read as "you
  // have no applications", which is a different claim from "we could not load
  // them".
  const applicationsFailed = applicationsResult.status === "rejected";

  if (statusHistoryResult.status === "rejected") {
    console.error(
      "Error fetching recent status history:",
      statusHistoryResult.reason
    );
  }
  // A failed read reads as "nothing recorded", which the panel states as an
  // empty feed. It never falls back to deriving events from application rows.
  const statusHistory: ApplicationStatusHistory[] =
    statusHistoryResult.status === "fulfilled" ? statusHistoryResult.value : [];

  if (gmailResult.status === "rejected") {
    console.error("Error fetching Gmail connection:", gmailResult.reason);
  }
  const gmailConnection =
    gmailResult.status === "fulfilled" ? gmailResult.value : null;
  const gmailConnected = gmailConnection !== null;

  if (reviewResult.status === "rejected") {
    console.error("Error loading unlinked Gmail activity:", reviewResult.reason);
  }
  if (unknownBucketResult.status === "rejected") {
    console.error(
      "Error counting unknown-employer Gmail activity:",
      unknownBucketResult.reason
    );
  }
  if (latestJobResult.status === "rejected") {
    console.error("Error loading the latest Gmail scan:", latestJobResult.reason);
  }
  if (latestCompletedJobResult.status === "rejected") {
    console.error(
      "Error loading the latest completed Gmail scan:",
      latestCompletedJobResult.reason
    );
  }
  if (openJobResult.status === "rejected") {
    console.error("Error loading the open Gmail scan:", openJobResult.reason);
  }

  // A failed count reads as an empty surface, so the scan module renders without
  // that entry point rather than breaking. It is never presented as a fact about
  // your applications.
  const unknownBucketCount =
    unknownBucketResult.status === "fulfilled" ? unknownBucketResult.value : 0;
  // Job opportunities: counted, never an application. A failed read shows nothing
  // rather than a misleading zero being treated as fact.
  const opportunityCount =
    opportunityCountResult.status === "fulfilled"
      ? opportunityCountResult.value
      : 0;


  const latestJob =
    latestJobResult.status === "fulfilled" ? latestJobResult.value : null;
  const latestCompletedJob =
    latestCompletedJobResult.status === "fulfilled"
      ? latestCompletedJobResult.value
      : null;
  const openJob = openJobResult.status === "fulfilled" ? openJobResult.value : null;

  // The reported window: the URL param when it is one of 7d / 30d / 90d,
  // otherwise the window the last completed scan actually covered, otherwise the
  // 30-day default. A junk param resolves down the same chain rather than
  // erroring.
  const reportingWindow = resolveReportingWindow({
    param: requestedWindow,
    latestScan: latestCompletedJob
      ? {
          windowStart: latestCompletedJob.windowStart,
          windowEnd: latestCompletedJob.windowEnd,
        }
      : null,
  });

  // One clock for every derivation on this render, so the KPI row, the charts and
  // the activity list cannot disagree about where "now" is.
  const now = new Date();
  // Applications only. No scan counter is an input to this call.
  const report = computeWindowReport(applications, reportingWindow, now);
  const windowDays = reportingWindowDays(reportingWindow);

  // Real recorded events only, named against the applications in view.
  const recentActivity = buildRecentActivity(
    statusHistory,
    report.applications,
    RECENT_ACTIVITY_LIMIT
  );

  return (
    <AppShell>
      <>
        {/* Header. Compact — this page's hierarchy is established below by
            size and position, not by an oversized title here. */}
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-text">
                Track My Job Applications
              </h1>
              <p className="mt-1 text-sm text-text-secondary">
                Here&apos;s what&apos;s happening with your job search.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Governs the KPIs and charts below; unrelated to the Gmail scan
                  window further down the page. */}
              <ReportingWindowControl selected={reportingWindow} />

              {/*
                Jumps to the EXISTING Gmail tracking section further down this
                page — it does not duplicate the scanner. A plain anchor, so it
                works with no client JavaScript and survives refresh and
                back/forward; `scroll-mt-*` on the target keeps the heading clear
                of the sticky top bar. Smooth scrolling comes from the global
                `scroll-behavior`, which the reduced-motion rule already disables
                for users who ask for that.

                The label is always "Track My Applications": the tracking section
                it targets handles both states — it starts the Gmail connect flow
                when there is no connection yet, and runs the scan once connected.
              */}
              <a
                href="#gmail-tracking"
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-2 hover:text-text"
              >
                {/* Always the same primary action, connected or not. When Gmail
                    is not yet connected the tracking section it lands on starts
                    the OAuth connect flow directly; when it is connected that
                    section runs the scan. The label never changes to "Connect
                    Gmail", so the primary action reads consistently. */}
                Track My Applications
                <span aria-hidden="true">↓</span>
              </a>
            </div>
          </div>

          {applicationsFailed && (
            <div className="mb-6 rounded-md border border-danger/20 bg-danger-bg px-4 py-3 text-sm text-danger">
              Your applications could not be loaded just now. The numbers below
              are incomplete — reload to try again.
            </div>
          )}

          {/* PRIMARY: the application pipeline. This is the product. Every number
              here is a persisted `applications` row — no Gmail counter is a KPI
              input anywhere in this section. */}
          <section id="reporting" className="scroll-mt-6">
            <KpiRow
              window={reportingWindow}
              totalApplications={report.totalApplications}
              statusCounts={report.statusCounts}
            />

            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="lg:col-span-2">
                {/* Range-aware: buckets span the selected window and include
                    today, so the 7/30/90 selector actually changes the chart. */}
                <ActivityChart
                  activity={report.activity}
                  windowDays={windowDays}
                />
              </div>
              <div className="lg:col-span-1">
                <StatusDistribution
                  statusCounts={report.statusCounts}
                  total={report.totalApplications}
                  windowDays={windowDays}
                />
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <RecentActivity activities={recentActivity} />
              </div>
              <div className="lg:col-span-1">
                <PortalBreakdown
                  portals={report.portals}
                  hasData={report.hasPortalBreakdown}
                  windowDays={windowDays}
                />
              </div>
            </div>
          </section>

          {/* SECONDARY: the input source. Gmail feeds the pipeline above; it does
              not compete with it for attention. Deliberately smaller and lower on
              the page, with the language of a sync mechanism rather than a
              standalone feature. */}
          {/* The shortcut above targets this id. `scroll-mt-20` clears the sticky
              header so the section heading is not hidden under it on arrival. */}
          <div id="gmail-tracking" className="mt-6 scroll-mt-20">
            <GmailScanModule
              connected={gmailConnected}
              lastSyncAt={gmailConnection?.lastSyncAt ?? null}
              resumable={openJob !== null}
              initialProgress={
                openJob
                  ? {
                      messagesSeen: openJob.messagesSeen,
                      candidates: openJob.candidates,
                    }
                  : null
              }
              latestScan={
                latestJob
                  ? {
                      finishedAt: latestJob.updatedAt,
                      status: latestJob.status,
                      messagesSeen: latestJob.messagesSeen,
                      candidates: latestJob.candidates,
                      applicationsCreated: latestJob.applicationsFound,
                      applicationsUpdated: latestJob.applicationsUpdated,
                    }
                  : null
              }
              // Unknown employer only. There is no approval queue in this flow.
              exceptions={{ unknownEmployer: unknownBucketCount }}
              opportunityCount={opportunityCount}
            />
          </div>

        <div className="mt-4">
          <QuickActions />
        </div>
      </>
    </AppShell>
  );
}

/**
 * Public, unauthenticated homepage.
 *
 * Rendered for signed-out visitors at `/` (see the early return in `Home`).
 * Its job is to satisfy Google OAuth brand verification: it presents the exact
 * product name "JobTrackOS", the tagline, a clear explanation of what the app
 * does, a truthful description of the optional read-only Gmail use, and visible
 * links to the Privacy Policy and Terms. It composes no authenticated shell and
 * reads no user data. Uses semantic design tokens only, matching the app UI.
 */
function PublicHome() {
  return (
    <main className="min-h-full bg-bg text-text">
      {/* Top bar — the wordmark establishes the OAuth app name on the homepage. */}
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <span className="text-lg font-semibold tracking-tight text-text">
            JobTrackOS
          </span>
          <nav className="flex items-center gap-2 text-sm" aria-label="Account">
            <a
              href="/login"
              className="rounded-md px-3 py-1.5 font-medium text-text-secondary transition-colors hover:bg-surface-2 hover:text-text"
            >
              Log in
            </a>
            <a
              href="/signup"
              className="rounded-md bg-accent px-3 py-1.5 font-medium text-accent-fg transition-colors hover:bg-accent-hover"
            >
              Sign up
            </a>
          </nav>
        </div>
      </header>

      {/* Hero — brand, tagline, and a plain-language description of the product. */}
      <section className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6">
        <h1 className="text-4xl font-semibold tracking-tight text-text sm:text-5xl">
          JobTrackOS
        </h1>
        <p className="mt-3 text-lg text-text-secondary">
          Know where your career stands.
        </p>
        <p className="mt-6 max-w-2xl text-base leading-7 text-text-secondary">
          JobTrackOS is a job application tracking platform. It helps you keep
          all of your job applications in one place, monitor each
          application&apos;s status from applied through interview, offer, or
          rejection, and understand your job search at a glance — so you always
          know where things stand.
        </p>
        <p className="mt-4 max-w-2xl text-base leading-7 text-text-secondary">
          JobTrackOS helps job seekers organize and track their job
          applications in one place. Users can monitor application statuses,
          manage opportunities, and keep their job search organized.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <a
            href="/signup"
            className="inline-flex items-center rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-accent-fg transition-colors hover:bg-accent-hover"
          >
            Get started
          </a>
          <a
            href="/login"
            className="inline-flex items-center rounded-md border border-border-strong px-5 py-2.5 text-sm font-semibold text-text transition-colors hover:bg-surface-2"
          >
            Log in
          </a>
        </div>
      </section>

      {/* What it does — concise, truthful feature summary. */}
      <section className="border-t border-border bg-surface">
        <div className="mx-auto grid w-full max-w-5xl gap-6 px-4 py-14 sm:grid-cols-3 sm:px-6">
          <div>
            <h2 className="text-base font-semibold text-text">
              Track every application
            </h2>
            <p className="mt-2 text-sm leading-6 text-text-secondary">
              Add the roles you apply to and keep company, title, and source
              details organized in one place.
            </p>
          </div>
          <div>
            <h2 className="text-base font-semibold text-text">
              Monitor status
            </h2>
            <p className="mt-2 text-sm leading-6 text-text-secondary">
              See where each application stands — applied, interview, offer,
              rejected, or gone quiet — and what needs attention.
            </p>
          </div>
          <div>
            <h2 className="text-base font-semibold text-text">
              Optional Gmail assist
            </h2>
            <p className="mt-2 text-sm leading-6 text-text-secondary">
              Connect Gmail if you want JobTrackOS to help identify job-related
              emails and keep your tracking up to date. It is entirely optional.
            </p>
          </div>
        </div>
      </section>

      {/* Gmail disclosure — the exact, truthful purpose statement. */}
      <section className="mx-auto w-full max-w-5xl px-4 py-14 sm:px-6">
        <h2 className="text-xl font-semibold text-text">
          How the optional Gmail connection works
        </h2>
        <p className="mt-4 max-w-2xl text-base leading-7 text-text-secondary">
          JobTrackOS can optionally use read-only Gmail access to identify job
          application-related emails and help keep your application tracking
          information up to date.
        </p>
        <p className="mt-4 max-w-2xl text-base leading-7 text-text-secondary">
          When you connect Gmail, JobTrackOS can identify relevant
          job-application emails and use those updates to help keep your
          application information organized and up to date.
        </p>
        <ul className="mt-4 max-w-2xl list-disc space-y-1.5 pl-5 text-sm leading-6 text-text-secondary">
          <li>Gmail is optional — JobTrackOS works without connecting it.</li>
          <li>Access is read-only. JobTrackOS never sends or modifies your email.</li>
          <li>Gmail data is never sold and is never used for advertising.</li>
          <li>You can disconnect and revoke access at any time.</li>
        </ul>
        <p className="mt-4 text-sm text-text-muted">
          Read more in our{" "}
          <a href="/privacy-policy" className="text-accent hover:text-accent-hover">
            Privacy Policy
          </a>
          .
        </p>
      </section>

      {/* Footer — visible legal links required for verification. */}
      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-4 py-8 text-sm text-text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>© {new Date().getFullYear()} JobTrackOS</span>
          <nav className="flex items-center gap-4" aria-label="Legal">
            <a href="/privacy-policy" className="text-accent hover:text-accent-hover">
              Privacy Policy
            </a>
            <a href="/terms" className="text-accent hover:text-accent-hover">
              Terms of Service
            </a>
          </nav>
        </div>
      </footer>
    </main>
  );
}

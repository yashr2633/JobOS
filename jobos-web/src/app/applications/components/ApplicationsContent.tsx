"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type {
  Application,
  ApplicationFormData,
} from "../types";
import { computeApplicationStats } from "../utils";
import {
  ALL_WINDOWS,
  applyApplicationFilters,
  describeWindow,
  hasActiveFilters,
  type ApplicationListFilter,
  resolveFiltersFromParams,
  type ApplicationWindowFilter,
} from "../filters";
import ApplicationFormModal, {
  type ApplicationSaveOptions,
} from "./ApplicationFormModal";
import ApplicationList from "./ApplicationList";
import ApplicationSearch from "./ApplicationSearch";
import ApplicationStats from "./ApplicationStats";
import ApplicationsHeader from "./ApplicationsHeader";
import ViewApplicationModal from "./ViewApplicationModal";
import Toast, { useToast } from "../../components/Toast";
import ConfirmDialog from "../../components/ConfirmDialog";
import { toHumanMessage } from "../../components/errorMessage";
import { createClient } from "@/lib/supabase/client";
import {
  fetchApplications,
  createApplication,
  updateApplication,
  deleteApplication,
  duplicateApplication,
} from "@/lib/api/applications";

interface ApplicationsContentProps {
  /**
   * Size of the Unknown_Bucket. Resolved by the page on the server and passed
   * through untouched: this client component never queries it, so the Gmail
   * data layer stays out of the browser bundle.
   */
  unknownBucketCount?: number;
}

/**
 * `useSearchParams` suspends during a static prerender, so the reading
 * component sits behind its own boundary. The fallback is the same loading
 * state the data fetch shows, so the page never flashes an empty list.
 */
export default function ApplicationsContent(props: ApplicationsContentProps) {
  return (
    <Suspense fallback={<ApplicationsLoading />}>
      <ApplicationsWorkspace {...props} />
    </Suspense>
  );
}

function ApplicationsLoading() {
  return (
    <div className="flex min-h-[400px] items-center justify-center">
      <div className="text-center">
        <div
          className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-4 border-border-strong border-t-accent"
          aria-hidden="true"
        />
        <p className="text-sm text-text-secondary">Loading applications...</p>
      </div>
    </div>
  );
}

function ApplicationsWorkspace({
  unknownBucketCount = 0,
}: ApplicationsContentProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  /**
   * The KPI drill-down contract with the dashboard:
   *   /applications?status=Applied&window=30d
   *   /applications?window=30d
   * Both values are untrusted strings until `resolveFiltersFromParams` narrows
   * them; an unrecognised one resolves to the unfiltered default.
   */
  const statusParam = searchParams.get("status");
  const windowParam = searchParams.get("window");

  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ApplicationListFilter>(
    () => resolveFiltersFromParams({ status: statusParam }).status
  );
  const [windowFilter, setWindowFilter] = useState<ApplicationWindowFilter>(
    () => resolveFiltersFromParams({ window: windowParam }).window
  );
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [viewApplication, setViewApplication] = useState<Application | null>(
    null
  );
  const [editApplication, setEditApplication] = useState<Application | null>(
    null
  );
  /** The application a delete has been requested for, pending confirmation. */
  const [pendingDelete, setPendingDelete] = useState<Application | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const { toast, showSuccess, showError, dismiss } = useToast();

  const supabase = createClient();

  const loadApplications = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchApplications(supabase);
      setApplications(data);
    } catch (err: unknown) {
      // A failed read is never reported as an empty list or as zero counts:
      // the rows are unknown, not absent.
      setError(toHumanMessage(err, "Failed to load applications."));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadApplications();
  }, [loadApplications]);

  /**
   * Re-seed the controls whenever the drill-down parameters change, so arriving
   * from a different KPI card applies that card's filters instead of leaving
   * the previous ones in place.
   */
  useEffect(() => {
    const resolved = resolveFiltersFromParams({
      status: statusParam,
      window: windowParam,
    });
    setStatusFilter(resolved.status);
    setWindowFilter(resolved.window);
  }, [statusParam, windowParam]);

  const filters = useMemo(
    () => ({ status: statusFilter, window: windowFilter, search: searchQuery }),
    [statusFilter, windowFilter, searchQuery]
  );

  /**
   * The rows the SUMMARY counts: window-filtered, but not narrowed by the status
   * or search controls.
   *
   * Two deliberate decisions here.
   *
   * The window IS applied, because that is what makes this row comparable to the
   * Dashboard: both surfaces then hand the same window-filtered set to the same
   * `summarizeApplicationStatuses`, so their counts cannot disagree.
   *
   * The status and search filters are NOT applied, because they would destroy
   * the row's meaning — filtering the list to Ghosted would show Ghosted = N and
   * every other status 0, which reads as data loss rather than as a filter.
   */
  const summaryScope = useMemo(
    () =>
      applyApplicationFilters(applications, {
        status: "All",
        window: windowFilter,
        search: "",
      }),
    [applications, windowFilter]
  );

  const stats = useMemo(
    () => computeApplicationStats(summaryScope),
    [summaryScope]
  );

  // One filter pass over the ACTUAL dataset, shared by the URL parameters and
  // the on-page controls. The window half delegates to the dashboard's own
  // `filterApplicationsByRange`, so both screens agree on "last 30 days".
  const filteredApplications = useMemo(
    () => applyApplicationFilters(applications, filters),
    [applications, filters]
  );

  const filtersActive = hasActiveFilters(filters);

  const clearFilters = useCallback(() => {
    setStatusFilter("All");
    setWindowFilter(ALL_WINDOWS);
    setSearchQuery("");

    // Drop the drill-down parameters too, otherwise the URL would keep claiming
    // a filter that is no longer applied.
    if (statusParam !== null || windowParam !== null) {
      router.replace(pathname, { scroll: false });
    }
  }, [pathname, router, statusParam, windowParam]);

  async function handleAddApplication(data: ApplicationFormData) {
    try {
      // Creating an application is not a transition, so no correction option
      // applies and no status history is recorded.
      const newApp = await createApplication(supabase, data);
      setApplications((prev) => [newApp, ...prev]);
      showSuccess(`Added ${newApp.role} at ${newApp.company}.`);
    } catch (err: unknown) {
      showError(toHumanMessage(err, "Failed to create the application."));
      throw err;
    }
  }

  /**
   * Save an edit. The status portion is routed through the centralized
   * lifecycle write inside `updateApplication`, so a status change here always
   * records one history event and a save that leaves the status alone records
   * none. A refused transition surfaces as a readable sentence, never SQL.
   */
  async function handleUpdateApplication(
    data: ApplicationFormData,
    options: ApplicationSaveOptions
  ) {
    if (!editApplication) return;

    const previousStatus = editApplication.status;

    try {
      const updatedApp = await updateApplication(
        supabase,
        editApplication.id,
        data,
        { allowCorrection: options.allowCorrection }
      );
      setApplications((prev) =>
        prev.map((app) => (app.id === updatedApp.id ? updatedApp : app))
      );
      showSuccess(
        updatedApp.status === previousStatus
          ? "Application updated."
          : `Status changed to ${updatedApp.status}.`
      );
    } catch (err: unknown) {
      showError(toHumanMessage(err, "Failed to update the application."));
      throw err;
    }
  }

  async function handleDuplicateApplication(application: Application) {
    try {
      const duplicate = await duplicateApplication(supabase, application);
      setApplications((prev) => [duplicate, ...prev]);
      showSuccess(`Duplicated ${application.role} at ${application.company}.`);
    } catch (err: unknown) {
      showError(toHumanMessage(err, "Failed to duplicate the application."));
    }
  }

  async function handleConfirmDelete() {
    if (!pendingDelete) return;
    const application = pendingDelete;

    setIsDeleting(true);
    try {
      await deleteApplication(supabase, application.id);
      setApplications((prev) => prev.filter((app) => app.id !== application.id));

      if (viewApplication?.id === application.id) {
        setViewApplication(null);
      }
      setPendingDelete(null);
      showSuccess(`Deleted ${application.role} at ${application.company}.`);
    } catch (err: unknown) {
      setPendingDelete(null);
      showError(toHumanMessage(err, "Failed to delete the application."));
    } finally {
      setIsDeleting(false);
    }
  }

  function handleEditFromView(application: Application) {
    setViewApplication(null);
    setEditApplication(application);
  }

  if (loading) {
    return <ApplicationsLoading />;
  }

  if (error) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="max-w-md rounded-lg border border-danger/20 bg-danger-bg p-6 text-center">
          <p className="font-medium text-danger">
            We couldn&apos;t load your applications
          </p>
          <p className="mt-1.5 text-sm text-danger/90">{error}</p>
          <button
            type="button"
            onClick={loadApplications}
            className="mt-5 rounded-md border border-danger/40 px-4 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger/10"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-8">
        <ApplicationsHeader
          onAddClick={() => setIsAddModalOpen(true)}
          unknownBucketCount={unknownBucketCount}
        />
        {/* The scope is named, because the Dashboard reports the same figures
            over ITS window. Ghosted makes the difference visible: it is derived
            from prolonged silence, so a narrow window genuinely contains none. */}
        <ApplicationStats stats={stats} scopeLabel={describeWindow(windowFilter)} />
        <ApplicationSearch
          searchQuery={searchQuery}
          statusFilter={statusFilter}
          windowFilter={windowFilter}
          onSearchChange={setSearchQuery}
          onStatusChange={setStatusFilter}
          onWindowChange={setWindowFilter}
          onClearFilters={clearFilters}
          resultCount={filteredApplications.length}
          totalCount={applications.length}
        />
        <ApplicationList
          applications={filteredApplications}
          totalCount={applications.length}
          filtersActive={filtersActive}
          onClearFilters={clearFilters}
          onAddFirst={() => setIsAddModalOpen(true)}
          onView={setViewApplication}
          onEdit={setEditApplication}
          onDuplicate={handleDuplicateApplication}
          onDelete={setPendingDelete}
        />
      </div>

      <ApplicationFormModal
        isOpen={isAddModalOpen}
        mode="add"
        onClose={() => setIsAddModalOpen(false)}
        onSave={handleAddApplication}
      />

      <ApplicationFormModal
        isOpen={editApplication !== null}
        mode="edit"
        application={editApplication ?? undefined}
        onClose={() => setEditApplication(null)}
        onSave={handleUpdateApplication}
      />

      <ViewApplicationModal
        application={viewApplication}
        onClose={() => setViewApplication(null)}
        onEdit={handleEditFromView}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this application?"
        message={
          pendingDelete
            ? `${pendingDelete.role} at ${pendingDelete.company} will be removed. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete application"
        busy={isDeleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDelete(null)}
      />

      <Toast toast={toast} onDismiss={dismiss} />
    </>
  );
}

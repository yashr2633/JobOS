"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  Application,
  ApplicationStatusFilter,
  ApplicationFormData,
} from "../types";
import { computeApplicationStats, formDataToApplication } from "../utils";
import ApplicationFormModal from "./ApplicationFormModal";
import ApplicationList from "./ApplicationList";
import ApplicationSearch from "./ApplicationSearch";
import ApplicationStats from "./ApplicationStats";
import ApplicationsHeader from "./ApplicationsHeader";
import ViewApplicationModal from "./ViewApplicationModal";
import { createClient } from "@/lib/supabase/client";
import {
  fetchApplications,
  createApplication,
  updateApplication,
  deleteApplication,
  duplicateApplication,
} from "@/lib/api/applications";

export default function ApplicationsContent() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<ApplicationStatusFilter>("All");
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [viewApplication, setViewApplication] = useState<Application | null>(
    null
  );
  const [editApplication, setEditApplication] = useState<Application | null>(
    null
  );

  const supabase = createClient();

  // Fetch applications on mount
  useEffect(() => {
    async function loadApplications() {
      try {
        setLoading(true);
        const data = await fetchApplications(supabase);
        setApplications(data);
      } catch (err: any) {
        setError(err.message || "Failed to load applications");
      } finally {
        setLoading(false);
      }
    }

    loadApplications();
  }, []);

  const stats = useMemo(
    () => computeApplicationStats(applications),
    [applications]
  );

  const filteredApplications = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return applications.filter((app) => {
      const matchesStatus =
        statusFilter === "All" || app.status === statusFilter;

      const matchesSearch =
        query === "" ||
        app.company.toLowerCase().includes(query) ||
        app.role.toLowerCase().includes(query) ||
        app.location.toLowerCase().includes(query);

      return matchesStatus && matchesSearch;
    });
  }, [applications, searchQuery, statusFilter]);

  async function handleAddApplication(data: ApplicationFormData) {
    try {
      const newApp = await createApplication(supabase, data);
      setApplications((prev) => [newApp, ...prev]);
    } catch (err: any) {
      alert(err.message || "Failed to create application");
      throw err;
    }
  }

  async function handleUpdateApplication(data: ApplicationFormData) {
    if (!editApplication) return;

    try {
      const updatedApp = await updateApplication(
        supabase,
        editApplication.id,
        data
      );
      setApplications((prev) =>
        prev.map((app) => (app.id === updatedApp.id ? updatedApp : app))
      );
    } catch (err: any) {
      alert(err.message || "Failed to update application");
      throw err;
    }
  }

  async function handleDuplicateApplication(application: Application) {
    try {
      const duplicate = await duplicateApplication(supabase, application);
      setApplications((prev) => [duplicate, ...prev]);
    } catch (err: any) {
      alert(err.message || "Failed to duplicate application");
    }
  }

  async function handleDeleteApplication(application: Application) {
    try {
      await deleteApplication(supabase, application.id);
      setApplications((prev) => prev.filter((app) => app.id !== application.id));

      if (viewApplication?.id === application.id) {
        setViewApplication(null);
      }
    } catch (err: any) {
      alert(err.message || "Failed to delete application");
    }
  }

  function handleEditFromView(application: Application) {
    setViewApplication(null);
    setEditApplication(application);
  }

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-center">
          <div className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-4 border-slate-700 border-t-blue-500"></div>
          <p className="text-sm text-slate-400">Loading applications...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-6 text-center">
          <p className="text-red-400">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-8">
        <ApplicationsHeader onAddClick={() => setIsAddModalOpen(true)} />
        <ApplicationStats stats={stats} />
        <ApplicationSearch
          searchQuery={searchQuery}
          statusFilter={statusFilter}
          onSearchChange={setSearchQuery}
          onStatusChange={setStatusFilter}
        />
        <ApplicationList
          applications={filteredApplications}
          onView={setViewApplication}
          onEdit={setEditApplication}
          onDuplicate={handleDuplicateApplication}
          onDelete={handleDeleteApplication}
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
    </>
  );
}

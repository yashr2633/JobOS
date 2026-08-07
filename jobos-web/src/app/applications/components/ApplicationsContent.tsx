"use client";

import { useMemo, useState } from "react";
import { applications as initialApplications } from "../data";
import type { Application, ApplicationStatusFilter, ApplicationFormData } from "../types";
import { computeApplicationStats, formDataToApplication } from "../utils";
import ApplicationFormModal from "./ApplicationFormModal";
import ApplicationList from "./ApplicationList";
import ApplicationSearch from "./ApplicationSearch";
import ApplicationStats from "./ApplicationStats";
import ApplicationsHeader from "./ApplicationsHeader";
import ViewApplicationModal from "./ViewApplicationModal";

export default function ApplicationsContent() {
  const [applications, setApplications] =
    useState<Application[]>(initialApplications);
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

  function handleAddApplication(data: ApplicationFormData) {
    setApplications((prev) => [formDataToApplication(data), ...prev]);
  }

  function handleUpdateApplication(data: ApplicationFormData) {
    if (!editApplication) return;

    setApplications((prev) =>
      prev.map((app) =>
        app.id === editApplication.id
          ? formDataToApplication(data, editApplication.id)
          : app
      )
    );
  }

  function handleDuplicateApplication(application: Application) {
    const duplicate: Application = {
      ...application,
      id: crypto.randomUUID(),
      company: `${application.company} (Copy)`,
    };

    setApplications((prev) => [duplicate, ...prev]);
  }

  function handleDeleteApplication(application: Application) {
    setApplications((prev) => prev.filter((app) => app.id !== application.id));

    if (viewApplication?.id === application.id) {
      setViewApplication(null);
    }
  }

  function handleEditFromView(application: Application) {
    setViewApplication(null);
    setEditApplication(application);
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

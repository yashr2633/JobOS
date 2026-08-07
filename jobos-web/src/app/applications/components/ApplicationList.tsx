import type { Application } from "../types";
import ApplicationCard from "./ApplicationCard";

interface ApplicationListProps {
  applications: Application[];
  onView: (application: Application) => void;
  onEdit: (application: Application) => void;
  onDuplicate: (application: Application) => void;
  onDelete: (application: Application) => void;
}

export default function ApplicationList({
  applications,
  onView,
  onEdit,
  onDuplicate,
  onDelete,
}: ApplicationListProps) {
  if (applications.length === 0) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900 px-6 py-12 text-center">
        <p className="text-lg font-medium text-slate-300">
          No applications found
        </p>
        <p className="mt-1 text-sm text-slate-500">
          Try adjusting your search or filter criteria.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {applications.map((application) => (
        <ApplicationCard
          key={application.id}
          application={application}
          onView={onView}
          onEdit={onEdit}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

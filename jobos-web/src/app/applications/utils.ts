import type {
  Application,
  ApplicationFormData,
  ApplicationStats,
} from "./types";
// Relative + explicit .ts extension so this module stays runnable under
// `node --test`, matching the convention in filters.ts and dashboard/metrics.ts.
import { summarizeApplicationStatuses } from "../dashboard/metrics.ts";

export function formatApplicationDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Application-page stats.
 *
 * A thin delegation to the canonical `summarizeApplicationStatuses`, so this
 * page and the Dashboard cannot compute status counts differently. It is kept as
 * a named function because call sites already import it; it deliberately adds no
 * logic of its own, since any logic here would be a second definition.
 */
export function computeApplicationStats(
  applications: Application[]
): ApplicationStats {
  return summarizeApplicationStatuses(applications);
}

export function formDataToApplication(
  data: ApplicationFormData,
  id?: string
): Application {
  return {
    id: id ?? crypto.randomUUID(),
    company: data.company,
    role: data.role,
    location: data.location,
    jobPortal: data.jobPortal,
    appliedDate: data.appliedDate,
    status: data.status,
    ...(data.salary.trim() ? { salary: data.salary.trim() } : {}),
    ...(data.jobDescription.trim()
      ? { jobDescription: data.jobDescription.trim() }
      : {}),
  };
}

export function applicationToFormData(
  application: Application
): ApplicationFormData {
  return {
    company: application.company,
    role: application.role,
    location: application.location,
    jobPortal: application.jobPortal,
    appliedDate: application.appliedDate,
    status: application.status,
    salary: application.salary ?? "",
    jobDescription: application.jobDescription ?? "",
  };
}

export function getEmptyApplicationForm(): ApplicationFormData {
  return {
    company: "",
    role: "",
    location: "",
    jobPortal: "",
    appliedDate: new Date().toISOString().split("T")[0],
    status: "Applied",
    salary: "",
    jobDescription: "",
  };
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}…`;
}

import type {
  Application,
  ApplicationFormData,
  ApplicationStats,
} from "./types";

export function formatApplicationDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function computeApplicationStats(
  applications: Application[]
): ApplicationStats {
  return {
    total: applications.length,
    active: applications.filter((app) =>
      ["Applied", "Interview", "Offer"].includes(app.status)
    ).length,
    interviews: applications.filter((app) => app.status === "Interview")
      .length,
    rejected: applications.filter((app) => app.status === "Rejected").length,
  };
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
  };
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}…`;
}

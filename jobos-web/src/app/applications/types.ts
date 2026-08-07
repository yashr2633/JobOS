export type ApplicationStatus =
  | "Applied"
  | "Interview"
  | "Offer"
  | "Rejected"
  | "Ghosted";

export type ApplicationStatusFilter = ApplicationStatus | "All";

export interface Application {
  id: string;
  company: string;
  role: string;
  location: string;
  jobPortal: string;
  appliedDate: string;
  status: ApplicationStatus;
  salary?: string;
}

export interface ApplicationStats {
  total: number;
  active: number;
  interviews: number;
  rejected: number;
}

export interface ApplicationFormData {
  company: string;
  role: string;
  location: string;
  jobPortal: string;
  appliedDate: string;
  status: ApplicationStatus;
  salary: string;
}

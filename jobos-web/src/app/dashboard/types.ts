import type { ApplicationStatus } from "../applications/types";

export interface DashboardStats {
  totalApplications: number;
  interviews: number;
  offers: number;
  rejections: number;
  responseRate: number;
}

export interface ActivityItem {
  id: string;
  type: "applied" | "interview" | "offer" | "rejected" | "updated";
  company: string;
  role: string;
  timestamp: string;
  status?: ApplicationStatus;
}

export interface WeeklyData {
  week: string;
  applications: number;
}

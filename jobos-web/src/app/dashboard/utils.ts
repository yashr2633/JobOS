import type { Application } from "../applications/types";
import type { DashboardStats, ActivityItem, WeeklyData } from "./types";

export function computeDashboardStats(
  applications: Application[]
): DashboardStats {
  const total = applications.length;
  const interviews = applications.filter(
    (app) => app.status === "Interview"
  ).length;
  const offers = applications.filter((app) => app.status === "Offer").length;
  const rejections = applications.filter(
    (app) => app.status === "Rejected"
  ).length;

  // Response rate = (Interviews + Offers + Rejections) / Total * 100
  const responded = interviews + offers + rejections;
  const responseRate = total > 0 ? Math.round((responded / total) * 100) : 0;

  return {
    totalApplications: total,
    interviews,
    offers,
    rejections,
    responseRate,
  };
}

export function generateRecentActivity(
  applications: Application[]
): ActivityItem[] {
  // Sort by date (most recent first) and take top 5
  const sorted = [...applications].sort(
    (a, b) =>
      new Date(b.appliedDate).getTime() - new Date(a.appliedDate).getTime()
  );

  return sorted.slice(0, 5).map((app) => ({
    id: app.id,
    type: getActivityType(app.status),
    company: app.company,
    role: app.role,
    timestamp: app.appliedDate,
    status: app.status,
  }));
}

function getActivityType(
  status: string
): "applied" | "interview" | "offer" | "rejected" | "updated" {
  switch (status) {
    case "Interview":
      return "interview";
    case "Offer":
      return "offer";
    case "Rejected":
      return "rejected";
    case "Applied":
      return "applied";
    default:
      return "updated";
  }
}

export function generateWeeklyData(): WeeklyData[] {
  // Mock data for weekly application progress (last 8 weeks)
  return [
    { week: "Week 1", applications: 3 },
    { week: "Week 2", applications: 5 },
    { week: "Week 3", applications: 4 },
    { week: "Week 4", applications: 7 },
    { week: "Week 5", applications: 6 },
    { week: "Week 6", applications: 8 },
    { week: "Week 7", applications: 5 },
    { week: "Week 8", applications: 9 },
  ];
}

export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffInMs = now.getTime() - date.getTime();
  const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

  if (diffInDays === 0) return "Today";
  if (diffInDays === 1) return "Yesterday";
  if (diffInDays < 7) return `${diffInDays} days ago`;
  if (diffInDays < 30) return `${Math.floor(diffInDays / 7)} weeks ago`;
  return `${Math.floor(diffInDays / 30)} months ago`;
}

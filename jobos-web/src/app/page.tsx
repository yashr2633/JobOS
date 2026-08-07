import Navbar from "./components/Navbar";
import Sidebar from "./components/Sidebar";
import {
  computeDashboardStats,
  generateRecentActivity,
  generateWeeklyData,
} from "./dashboard/utils";
import DashboardStats from "./dashboard/components/DashboardStats";
import WeeklyProgressChart from "./dashboard/components/WeeklyProgressChart";
import RecentActivity from "./dashboard/components/RecentActivity";
import QuickActions from "./dashboard/components/QuickActions";
import { createClient } from "@/lib/supabase/server";
import { fetchApplications } from "@/lib/api/applications";
import type { Application } from "./applications/types";

export default async function Home() {
  const supabase = await createClient();

  let applications: Application[] = [];
  try {
    applications = await fetchApplications(supabase);
  } catch (error) {
    console.error("Error fetching applications:", error);
  }

  const stats = computeDashboardStats(applications);
  const recentActivity = generateRecentActivity(applications);
  const weeklyData = generateWeeklyData();

  return (
    <>
      <Navbar />

      <div className="flex">
        <Sidebar />

        <main className="flex-1 min-h-screen bg-slate-950 p-6 sm:p-8 lg:p-10">
          {/* Header */}
          <div className="mb-10">
            <h1 className="text-3xl font-semibold tracking-tight text-white">
              Dashboard
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              Track your job search progress and recent activity
            </p>
          </div>

          {/* Stats Grid */}
          <DashboardStats stats={stats} />

          {/* Charts and Activity Grid */}
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <WeeklyProgressChart data={weeklyData} />
            </div>
            <div className="lg:col-span-1">
              <RecentActivity activities={recentActivity} />
            </div>
          </div>

          {/* Quick Actions */}
          <div className="mt-6">
            <QuickActions />
          </div>
        </main>
      </div>
    </>
  );
}
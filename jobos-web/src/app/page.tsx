import Navbar from "./components/Navbar";
import Sidebar from "./components/Sidebar";
import { applications } from "./applications/data";
import {
  computeDashboardStats,
  generateRecentActivity,
  generateWeeklyData,
} from "./dashboard/utils";
import DashboardStats from "./dashboard/components/DashboardStats";
import WeeklyProgressChart from "./dashboard/components/WeeklyProgressChart";
import RecentActivity from "./dashboard/components/RecentActivity";
import QuickActions from "./dashboard/components/QuickActions";

export default function Home() {
  const stats = computeDashboardStats(applications);
  const recentActivity = generateRecentActivity(applications);
  const weeklyData = generateWeeklyData();

  return (
    <>
      <Navbar />

      <div className="flex">
        <Sidebar />

        <main className="flex-1 min-h-screen bg-slate-950 text-white p-6 sm:p-8">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
            <p className="mt-2 text-slate-400">
              Welcome back! Here's what's happening with your job search.
            </p>
          </div>

          {/* Stats Grid */}
          <DashboardStats stats={stats} />

          {/* Charts and Activity */}
          <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <WeeklyProgressChart data={weeklyData} />
            </div>
            <div className="lg:col-span-1">
              <RecentActivity activities={recentActivity} />
            </div>
          </div>

          {/* Quick Actions */}
          <div className="mt-8">
            <QuickActions />
          </div>
        </main>
      </div>
    </>
  );
}
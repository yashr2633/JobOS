"use client";
import { useMemo, type ReactNode } from "react";
import type { Application } from "../../applications/types";
import type { ReportingWindow } from "../reportingWindow";
import { computeWindowReport } from "../report";
import { useMergedApplications } from "@/lib/gmail/useMergedApplications";
import KpiRow from "./KpiRow";
import ActivityChart from "./ActivityChart";
import StatusDistribution from "./StatusDistribution";
import PortalBreakdown from "./PortalBreakdown";

/** KPIs and charts must use the same browser-local and server application set. */
export default function DashboardReportClient({serverApplications, window, nowIso, children}: {
  serverApplications: Application[]; window: ReportingWindow; nowIso: string; children: ReactNode;
}) {
  const {applications, error} = useMergedApplications(serverApplications);
  const report = useMemo(() => computeWindowReport(applications, window, new Date(nowIso)), [applications, window, nowIso]);
  return <>
    {error && <p role="alert" className="mb-3 text-sm text-danger">Local Gmail applications could not be loaded. Refresh to retry.</p>}
    <KpiRow window={window} totalApplications={report.totalApplications} statusCounts={report.statusCounts}/>
    <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2"><ActivityChart activity={report.activity} windowDays={report.windowDays}/></div>
      <div className="lg:col-span-1"><StatusDistribution statusCounts={report.statusCounts} total={report.totalApplications} windowDays={report.windowDays}/></div>
    </div>
    <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">{children}</div>
      <div className="lg:col-span-1"><PortalBreakdown portals={report.portals} hasData={report.hasPortalBreakdown} windowDays={report.windowDays}/></div>
    </div>
  </>;
}

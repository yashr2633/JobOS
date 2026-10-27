import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import AppShell from "../components/AppShell";
import { createClient } from "@/lib/supabase/server";
import { discoveryData } from "@/lib/jobs/data";
import { getCachedCatalog } from "@/lib/jobs/cachedCatalog";
import WorkspaceLoading from "../components/WorkspaceLoading";
import JobsWorkspace from "./JobsWorkspace";
import InternalJobs from "./InternalJobs";
import { EMPTY_PROFILE } from "@/lib/jobs/types";
import { readJobFilters } from "@/lib/jobs/searchFilters";

export const metadata: Metadata = { title: "Find jobs" };

export default async function JobsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/jobs");
  const params = await searchParams;
  return <AppShell>
    <Suspense fallback={<WorkspaceLoading title="Find jobs" message="Checking employer listings and loading your preferences…" />}>
      <JobResults userId={user.id} params={params} />
    </Suspense>
    <Suspense fallback={<p className="mt-6 text-sm text-text-muted">Loading jobs posted on JobTrackOS…</p>}><InternalJobs /></Suspense>
  </AppShell>;
}

async function JobResults({ userId, params }: { userId: string; params: Record<string, string | undefined> }) {
  const supabase = await createClient();
  const [personal, catalog] = await Promise.allSettled([discoveryData(supabase, userId), getCachedCatalog()]);
  const filters = readJobFilters(params);
  const data = personal.status === "fulfilled" ? personal.value : { profile: { ...EMPTY_PROFILE }, states: [], resumes: [] };
  const profile = filters.resume && data.resumes.some(resume => resume.id === filters.resume && resume.usable !== false) ? { ...data.profile, resumeId: filters.resume } : data.profile;
  const feed = catalog.status === "fulfilled" ? catalog.value : { jobs: [], checkedAt: new Date().toISOString(), warnings: ["Employer feeds could not load. You can still submit a search to check additional public sources."] };
  return <>
    {personal.status === "rejected" && <p role="alert" className="mb-4 rounded-md bg-warning-bg p-4 text-sm text-warning">Saved preferences and resumes could not load. General job search remains available; account actions are paused until you reload.</p>}
    <JobsWorkspace key={JSON.stringify(filters)} {...data} profile={profile} catalog={feed} personalUnavailable={personal.status === "rejected"} initialJobId={params.job} initialJobSource={params.jobSource} initialQuery={filters.q} initialCompany={filters.company} initialLocation={filters.location} initialExperience={filters.experience} initialMode={filters.mode} initialDays={filters.days} initialAssistant={filters.assistant} />
    {catalog.status === "rejected" && <Link className="mt-4 inline-block text-sm text-accent" href="/applications">Your existing applications →</Link>}
  </>;
}

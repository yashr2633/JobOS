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

export const metadata: Metadata = { title: "Find jobs" };

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ q?: string; job?: string; location?: string; jobSource?: string }> }) {
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

async function JobResults({ userId, params }: { userId: string; params: { q?: string; job?: string; location?: string; jobSource?: string } }) {
  const supabase = await createClient();
  const [personal, catalog] = await Promise.allSettled([discoveryData(supabase, userId), getCachedCatalog()]);
  return <>
    {personal.status === "fulfilled" && catalog.status === "fulfilled"
      ? <JobsWorkspace {...personal.value} catalog={catalog.value} initialJobId={params.job} initialJobSource={params.jobSource} initialQuery={params.q} initialLocation={params.location} />
      : <section className="product-panel"><p className="product-kicker">Find jobs</p><h1>Your next opportunity</h1><p className="product-notice mt-5">{personal.status === "rejected" ? "Your job preferences could not load. Job Discovery setup may need to be completed. Your applications and resumes are still available." : "Job sources are temporarily unavailable. Please try again shortly."}</p><Link className="product-button" href="/applications">Open applications</Link></section>}
  </>;
}

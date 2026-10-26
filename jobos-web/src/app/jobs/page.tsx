import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import AppShell from "../components/AppShell";
import { createClient } from "@/lib/supabase/server";
import { discoveryData } from "@/lib/jobs/data";
import { getCatalog } from "@/lib/jobs/providers";
import JobsWorkspace from "./JobsWorkspace";
import InternalJobs from "./InternalJobs";

export const metadata: Metadata = { title: "Find jobs" };

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ q?: string; job?: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/jobs");
  const params = await searchParams;
  const [personal, catalog] = await Promise.allSettled([discoveryData(supabase, user.id), getCatalog()]);
  return <AppShell>
    {personal.status === "fulfilled" && catalog.status === "fulfilled"
      ? <JobsWorkspace {...personal.value} catalog={catalog.value} initialJobId={params.job} initialQuery={params.q} />
      : <section className="product-panel"><p className="product-kicker">Find jobs</p><h1>Your next opportunity</h1><p className="product-notice mt-5">{personal.status === "rejected" ? "Your job preferences could not load. Job Discovery setup may need to be completed. Your applications and resumes are still available." : "Job sources are temporarily unavailable. Please try again shortly."}</p><Link className="product-button" href="/applications">Open applications</Link></section>}
    <InternalJobs />
  </AppShell>;
}

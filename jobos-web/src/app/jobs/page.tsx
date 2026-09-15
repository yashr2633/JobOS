import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AppShell from "../components/AppShell";
import { createClient } from "@/lib/supabase/server";
import { getCatalog } from "@/lib/jobs/providers";
import { discoveryData } from "@/lib/jobs/data";
import JobsWorkspace from "./JobsWorkspace";
import { rankingConfig } from "@/lib/jobs/ranking";

export const metadata: Metadata = { title: "Discover Jobs" };
export default async function JobsPage({ searchParams }: { searchParams: Promise<{ job?: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/jobs");
  const params = await searchParams;
  const loaded = await Promise.all([getCatalog(), discoveryData(supabase, user.id)]).catch(() => null);
  if (!loaded) {
    return <AppShell><h1 className="text-2xl font-semibold">Discover Jobs</h1><p role="alert" className="mt-4 text-text-secondary">Your job preferences could not load. Please retry, or contact support if this continues.</p><a className="mt-4 inline-block text-accent" href="/jobs">Retry</a></AppShell>;
  }
  const [catalog, personal] = loaded;
  return <AppShell><JobsWorkspace key={user.id} {...personal} catalog={catalog} initialJobId={params.job} ranking={rankingConfig(process.env)} asOf={new Date().toISOString()} /></AppShell>;
}

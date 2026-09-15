import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AppShell from "../components/AppShell";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export const metadata: Metadata = { title: "Discover Jobs" };

export default async function JobsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/jobs");

  return (
    <AppShell>
      <div className="flex min-h-[60vh] items-center justify-center px-4 py-12">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-accent/10">
            <svg className="h-8 w-8 text-accent" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor">
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path strokeLinecap="round" d="m16 16 5 5" />
            </svg>
          </div>
          
          <h1 className="mb-2 text-2xl font-semibold tracking-tight text-text">Discover Jobs</h1>
          <p className="mb-6 text-base text-text-secondary">
            Personalized job discovery is coming soon.
          </p>
          
          <p className="mb-8 text-sm leading-relaxed text-text-muted">
            We're working on a better way to help you discover relevant opportunities, check your fit, and track everything in JobTrackOS.
          </p>
          
          <div className="rounded-lg border border-border bg-surface p-4">
            <p className="text-xs text-text-muted">
              Your existing{" "}
              <Link href="/applications" className="font-medium text-accent hover:underline">
                Applications
              </Link>
              {" "}and{" "}
              <Link href="/resumes" className="font-medium text-accent hover:underline">
                Resume Match
              </Link>
              {" "}features remain available.
            </p>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

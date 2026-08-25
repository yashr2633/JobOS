import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AppShell from "../components/AppShell";
import UnknownApplicationsList from "./components/UnknownApplicationsList";

export default async function TrackMyJobsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <AppShell>
      <div>
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-text">
            Track My Jobs
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Gmail applications that need your attention
          </p>
        </div>

        <div className="space-y-6">
          <UnknownApplicationsList />

          <div className="rounded-md border border-border bg-surface p-6">
            <h2 className="text-lg font-semibold text-text">
              Need to sync Gmail?
            </h2>
            <p className="mt-2 text-sm text-text-secondary">
              Go to the dashboard to connect Gmail and scan for job applications.
            </p>
            <a
              href="/#gmail-tracking"
              className="mt-4 inline-flex items-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover"
            >
              Go to Dashboard
            </a>
          </div>
        </div>
      </div>
    </AppShell>
  );
}


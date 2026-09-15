import AppShell from "../components/AppShell";
import ResumeMatchContent from "../resume-match/components/ResumeMatchContent";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getLiveJob } from "@/lib/jobs/providers";
import { discoveryData } from "@/lib/jobs/data";
import DiscoveryResumeMatch from "../jobs/DiscoveryResumeMatch";
import Link from "next/link";

/**
 * The Resumes area root — now Resume Match, the PRIMARY experience.
 *
 * Opening Resumes lands here on the match workflow (select or create an
 * application, pick or upload a resume, paste the JD, Analyze, then Tailor).
 * There is no separate Library destination any more: `/resumes/library` and
 * `/resume-match` both redirect here, and saved-resume management happens inside
 * this workflow. The stored resume data and the `resumes` table are untouched.
 */
export default async function ResumesPage({ searchParams }: { searchParams: Promise<{ job?: string }> }) {
  const { job: jobId } = await searchParams;
  if (jobId) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect("/login?next=/jobs");
    const loaded = await Promise.all([getLiveJob(jobId), discoveryData(supabase, user.id)]).catch(() => null);
    if (loaded?.[0]) {
      const [job, personal] = loaded;
      return <AppShell><DiscoveryResumeMatch job={job} resumes={personal.resumes} initialResumeId={personal.profile.resumeId} /></AppShell>;
    }
    return <AppShell><h1 className="text-2xl font-semibold">Resume Match</h1><p className="mt-3 text-text-secondary">This job or your preferences could not be loaded. The listing may have closed.</p><Link href="/jobs" className="mt-4 inline-block text-accent">Return to Discover Jobs</Link></AppShell>;
  }
  return (
    <AppShell>
      <ResumeMatchContent />
    </AppShell>
  );
}

import AppShell from "../components/AppShell";
import ResumeMatchContent from "../resume-match/components/ResumeMatchContent";

/**
 * The Resumes area root — now Resume Match, the PRIMARY experience.
 *
 * Opening Resumes lands here on the match workflow (select or create an
 * application, pick or upload a resume, paste the JD, Analyze, then Tailor).
 * There is no separate Library destination any more: `/resumes/library` and
 * `/resume-match` both redirect here, and saved-resume management happens inside
 * this workflow. The stored resume data and the `resumes` table are untouched.
 */
export default function ResumesPage() {
  return (
    <AppShell>
      <ResumeMatchContent />
    </AppShell>
  );
}

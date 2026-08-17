import { redirect } from "next/navigation";

/**
 * `/resume-match` is now an alias of the Resumes area root.
 *
 * Resume Match IS the Resumes experience (`/resumes`), so this legacy path just
 * redirects there rather than rendering a second copy. The one Resume Match
 * implementation lives in `ResumeMatchContent`, mounted by `/resumes`.
 */
export default function ResumeMatchPage() {
  redirect("/resumes");
}

import { redirect } from "next/navigation";

/**
 * The Resume Library is no longer a visible destination.
 *
 * Managing saved resumes happens naturally inside Resume Match (select an
 * existing resume, upload a new one, replace the selected one), so a separate
 * "Library" product surface only added confusion. This route is kept solely to
 * redirect any old bookmark or link safely to Resume Match — the stored resume
 * DATA and the `resumes` table are untouched; only this UX entry point is gone.
 */
export default function ResumeLibraryPage() {
  redirect("/resumes");
}

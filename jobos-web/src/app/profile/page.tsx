import Link from "next/link";
import { redirect } from "next/navigation";
import AppShell from "../components/AppShell";
import ProfileForm from "../settings/components/ProfileForm";
import { createClient } from "@/lib/supabase/server";
import { profileFromMetadata } from "@/lib/account/profile";
import { discoveryData } from "@/lib/jobs/data";
import CareerPreferences from "./CareerPreferences";
export default async function CandidateProfile() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/profile");
  const personal = await discoveryData(supabase, user.id).catch(() => null);
  return <AppShell><div className="product-heading"><div><p className="product-kicker">Your profile</p><h1>Make your next opportunity a better match.</h1><p>Keep your personal details, resume and job preferences up to date.</p></div><Link href="/settings/account" className="product-button">Account settings</Link></div><div className="product-two-column"><div className="product-section-stack"><ProfileForm initial={profileFromMetadata(user.user_metadata)} />{personal ? <CareerPreferences initial={personal.profile} resumes={personal.resumes} /> : <p className="product-notice">Career preferences could not load. Please retry after Job Discovery setup is complete.</p>}</div><aside className="product-section-stack"><section className="product-panel"><h2>Your resumes</h2><p className="mt-3 text-sm leading-7 text-text-secondary">Upload, select and manage your resume inside Resume Match.</p><Link className="product-button mt-5" href="/resumes">Open Resume Match</Link></section><section className="product-panel"><h2>Connected tools</h2><Link className="product-button mt-5 w-full" href="/settings/integrations">Manage Gmail connection</Link><Link className="product-button mt-3 w-full" href="/settings/preferences">Appearance & preferences</Link></section></aside></div></AppShell>;
}

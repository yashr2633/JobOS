import Link from "next/link";
import { redirect } from "next/navigation";
import AppShell from "../../components/AppShell";
import { createClient } from "@/lib/supabase/server";
import { fetchApplications } from "@/lib/api/applications";
import TrackedGmailApplications from "./TrackedGmailApplications";
import UnknownApplicationsList from "../../track-my-jobs/components/UnknownApplicationsList";

export default async function GmailReview() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/gmail/review");
  const applications = await fetchApplications(supabase).catch(() => null);
  return <AppShell>
    <div className="product-heading"><div><p className="product-kicker">Gmail review</p><h1>Your application emails, connected.</h1><p>Inspect tracked applications and open the exact source message in your Gmail account.</p></div><Link className="product-button product-button-primary" href="/#gmail-tracking">Scan Gmail</Link></div>
    <div className="product-two-column">
      <TrackedGmailApplications serverApplications={applications} />
      <aside className="product-section-stack">
        <section className="product-panel"><h2>Applications needing attention</h2><p className="mb-5 mt-3 text-sm leading-7 text-text-secondary">Review ambiguous messages and resolve unidentified employers. Recognised updates continue to use the existing scan flow.</p><UnknownApplicationsList /></section>
        <Link href="/applications" className="product-button">Open the full tracker</Link>
      </aside>
    </div>
  </AppShell>;
}

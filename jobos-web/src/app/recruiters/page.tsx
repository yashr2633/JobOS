import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CONTACT_PAGE_SIZE, hasCandidateProAccess, readProRecruiterContact, readRecruiterDirectory } from "@/lib/recruiters/server";
import AppShell from "../components/AppShell";
import OutreachDraft from "./OutreachDraft";
import RecruiterDirectory from "./RecruiterDirectory";

export const metadata: Metadata = {
  title: "Recruiter Outreach",
  robots: { index: false, follow: false },
};

export default async function RecruitersPage({ searchParams }: {
  searchParams: Promise<{ q?: string | string[]; page?: string | string[]; contact?: string | string[] }>;
}) {
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) redirect("/login?next=%2Frecruiters");
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 80) : "";
  const contactId = typeof params.contact === "string" ? params.contact : "";
  const [directory, access] = await Promise.allSettled([
    readRecruiterDirectory(query, 1),
    hasCandidateProAccess(user.id),
  ]);
  const pro = access.status === "fulfilled" && access.value;
  const contact = pro && contactId ? await readProRecruiterContact(user.id, contactId).catch(() => null) : null;

  return (
    <AppShell>
      <section className="product-panel mb-6">
        <p className="product-kicker">Career tools</p>
        <h1>Recruiter Outreach</h1>
        <p className="recruiter-intro">Introduce yourself to recruiters at companies you want to join. Find a contact, prepare a relevant email, then review and send it from your own inbox.</p>
        <ol className="recruiter-how-it-works" aria-label="How Recruiter Outreach works">
          <li><span>1</span><div><h2>Find a recruiter</h2><p>Search by name or company. Browse the available role and location details.</p></div></li>
          <li><span>2</span><div><h2>Prepare your introduction</h2><p>With Pro, open a work email and draft a message using your target role and a relevant skill or achievement.</p></div></li>
          <li><span>3</span><div><h2>Review &amp; send</h2><p>Edit your draft, open it in Gmail or copy it to your email app. Attach your resume before sending.</p></div></li>
        </ol>
        {!pro && <div className="recruiter-access-note"><p><strong>Browse profiles for free.</strong> Only work emails and outreach drafting require Pro.</p><Link href="/plans" className="product-button">See Pro plans →</Link></div>}
      </section>
      {contact && <OutreachDraft key={contact.email} contact={contact} />}
      <section className="product-panel" aria-labelledby="recruiter-directory-title">
        <h2 id="recruiter-directory-title">Recruiter contacts</h2>
        <form action="/recruiters" className="my-4 flex flex-wrap items-end gap-2">
          <label className="grid grow gap-1 text-sm font-medium">Recruiter name or company<input name="q" defaultValue={query} maxLength={80} className="rounded-lg border border-border bg-surface p-3" placeholder="Search contacts" /></label>
          <button className="product-button product-button-primary" type="submit">Search recruiters</button>
        </form>
        {directory.status === "rejected" ? (
          <p role="status" className="text-sm text-text-secondary">Recruiter contacts are temporarily unavailable.</p>
        ) : (
          <RecruiterDirectory key={query} initialContacts={directory.value.contacts} total={directory.value.count} query={query} pro={pro} nextPage={directory.value.count > CONTACT_PAGE_SIZE ? 2 : null} />
        )}
        <p className="mt-4 text-sm text-text-muted"><a className="underline" href="mailto:support@jobtrackos.online">Contact support</a> to correct or remove a directory listing.</p>
      </section>
    </AppShell>
  );
}

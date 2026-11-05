import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CONTACT_PAGE_SIZE, hasCandidateProAccess, readProRecruiterContact, readRecruiterDirectory } from "@/lib/recruiters/server";
import AppShell from "../components/AppShell";
import OutreachDraft from "./OutreachDraft";

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
  const pageNumber = Number(params.page);
  const page = Number.isSafeInteger(pageNumber) ? Math.max(1, Math.min(1000, pageNumber)) : 1;
  const contactId = typeof params.contact === "string" ? params.contact : "";
  const [directory, access] = await Promise.allSettled([
    readRecruiterDirectory(query, page),
    hasCandidateProAccess(user.id),
  ]);
  const pro = access.status === "fulfilled" && access.value;
  const contact = pro && contactId ? await readProRecruiterContact(user.id, contactId).catch(() => null) : null;
  const directoryHref = (targetPage: number, id?: string) => {
    const search = new URLSearchParams();
    if (query) search.set("q", query);
    if (targetPage > 1) search.set("page", String(targetPage));
    if (id) search.set("contact", id);
    return search.size ? `/recruiters?${search}` : "/recruiters";
  };

  return (
    <AppShell>
      <section className="product-panel mb-6">
        <p className="product-kicker">Career tools</p>
        <h1>Recruiter Outreach</h1>
        <p className="mt-2 max-w-prose text-sm text-text-secondary">Find recruiting contacts and write a short introduction for the role you want.</p>
        {!pro && <div className="mt-4 rounded-lg border border-border bg-bg p-3 text-sm"><p>Browse recruiter profiles for free. Work email and outreach drafts require Pro.</p><Link href="/plans" className="mt-2 inline-block font-medium text-accent underline">See Pro access</Link></div>}
      </section>
      {contact && <OutreachDraft key={contact.email} contact={contact} />}
      <section className="product-panel" aria-labelledby="recruiter-directory-title">
        <h2 id="recruiter-directory-title">Recruiter contacts</h2>
        <form action="/recruiters" className="my-4 flex flex-wrap items-end gap-2">
          <label className="grid grow gap-1 text-sm font-medium">Recruiter name or company<input name="q" defaultValue={query} maxLength={80} className="rounded-lg border border-border bg-surface p-3" placeholder="Search contacts" /></label>
          <button className="p-primary" type="submit">Search</button>
        </form>
        {directory.status === "rejected" ? (
          <p role="status" className="text-sm text-text-secondary">Recruiter contacts are temporarily unavailable.</p>
        ) : (
          <>
            {directory.value.contacts.length === 0 ? <p className="text-sm text-text-secondary">{query ? "No published contacts match this search." : "No recruiter contacts have been published yet."}</p> : (
              <div className="grid gap-3">
                {directory.value.contacts.map(item => (
                  <article key={item.id} className="grid gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <div>
                      <h3 className="font-semibold">{item.name || item.company}</h3>
                      <p className="text-sm text-text-secondary">{[item.name && item.company, item.title, item.location].filter(Boolean).join(" · ")}</p>
                    </div>
                    {pro ? <Link className="p-outline" href={directoryHref(page, item.id)}>Open contact</Link> : (
                      <div className="text-sm text-text-muted">
                        <span aria-hidden="true" className="mr-2 select-none blur-[2px]">••••••••@••••••••</span>
                        <span>Work email · Pro</span>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            )}
            {directory.value.count > 0 && (
              <nav aria-label="Recruiter directory pages" className="mt-4 flex flex-wrap items-center gap-3 text-sm">
                {page > 1 && <Link className="p-outline" href={directoryHref(page - 1)}>Previous</Link>}
                <span>{directory.value.count.toLocaleString("en-IN")} contacts · Page {page}</span>
                {page * CONTACT_PAGE_SIZE < directory.value.count && <Link className="p-outline" href={directoryHref(page + 1)}>Next</Link>}
              </nav>
            )}
          </>
        )}
        <p className="mt-4 text-sm text-text-muted"><a className="underline" href="mailto:support@jobtrackos.online">Contact support</a> to correct or remove a directory listing.</p>
      </section>
    </AppShell>
  );
}

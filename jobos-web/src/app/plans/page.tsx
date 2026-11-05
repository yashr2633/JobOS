import type { Metadata } from "next";
import Link from "next/link";
import AppShell from "../components/AppShell";

export const metadata: Metadata = { title: "Plans", robots: { index: false, follow: false } };

export default function PlansPage() {
  return <AppShell>
    <section className="product-panel">
      <h1>JobTrackOS plans</h1>
      <p className="mt-2 text-sm text-text-secondary">Keep searching for jobs and preparing your application. Paid subscriptions are being set up.</p>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <article className="rounded-lg border border-border p-5">
          <h2>Free</h2>
          <ul className="my-4 list-disc space-y-2 pl-5 text-sm"><li>Job search and employer application links</li><li>Resume Match</li><li>10 Free resume and cover letter designs with editing and export</li><li>Recruiter profile browsing</li></ul>
          <Link href="/jobs" className="p-primary">Find jobs</Link>
        </article>
        <article className="rounded-lg border border-border bg-accent/5 p-5">
          <h2>Pro · Access requests</h2>
          <p className="mt-3 text-sm">64 Premium resume and cover letter designs, recruiter contact access and outreach drafting require active Pro access.</p>
          <a className="p-outline mt-4 inline-block" href="mailto:support@jobtrackos.online?subject=JobTrackOS%20Pro%20access">Ask about Pro access</a>
          <p className="mt-3 text-xs text-text-muted">Online checkout, pricing and expanded premium benefits will be announced here when available.</p>
        </article>
      </div>
    </section>
  </AppShell>;
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Brand from "../components/Brand";
import { ProUpgradeButton, ProUpgradeCard } from "../components/ProUpgrade";
import CareerToolsCarousel from "../dashboard/components/CareerToolsCarousel";
import RecruiterDirectory from "../recruiters/RecruiterDirectory";
import PlansContent from "../plans/PlansContent";

export const metadata: Metadata = { title: "Private design review", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default function DesignReviewPage() {
  // Never expose this sample-data review destination on the production site.
  if (process.env.VERCEL_ENV !== "preview" && process.env.NODE_ENV !== "development") notFound();
  return <div className="product-app min-h-dvh bg-bg text-text"><div className="flex min-w-0 flex-col">
    <header className="product-header flex items-center justify-between border-b border-border bg-surface px-5"><Brand /><nav className="design-review-nav"><a href="#review-dashboard">Dashboard</a><a href="#review-recruiters">Recruiter Outreach</a><a href="#review-plans">Pro plans</a></nav></header>
    <main className="product-main mx-auto w-full max-w-7xl px-5 pb-12"><p className="design-review-note">Private design review · sample content only. Checkout is disabled here. Production pages and real account data are unchanged.</p>
      <section id="review-dashboard" className="design-review-grid"><div className="design-review-stack"><section className="product-panel"><p className="product-kicker">Career Assistant</p><h1>Make your next move.</h1><p className="mt-3 text-sm text-text-secondary">Find opportunities that fit your role, skills and preferred city.</p><label className="product-field mt-5">What are you looking for?<input placeholder="BBA fresher jobs in Kolkata" /></label><button type="button" className="product-button product-button-primary mt-4">Find jobs →</button></section><ProUpgradeCard /><section className="product-panel"><p className="product-kicker">Resume Match</p><h2>Your application, tailored to the role.</h2><p className="mt-3 mb-4 text-sm text-text-secondary">The scan result remains above the tailoring actions.</p><div className="tailoring-benefit-callout"><strong>It can increase your chances of being shortlisted.</strong><p>Tailor your resume and cover letter to this job description, using your real skills and experience.</p></div><div className="product-actions tailoring-actions"><button type="button" className="product-button product-button-primary">Tailor Resume</button><button type="button" className="product-button">Tailor Cover Letter</button><ProUpgradeButton label="Explore Pro →" /></div></section></div><CareerToolsCarousel /></section>
      <section id="review-recruiters" className="product-panel mt-8"><p className="product-kicker">Recruiter Outreach</p><h2>Find the right person to approach.</h2><p className="mt-3 mb-5 text-sm text-text-secondary">Names and company details remain visible. Only work email access is locked.</p><RecruiterDirectory initialContacts={[{ id: "review-contact", name: "Sample recruiter", company: "Example Company", title: "Talent acquisition", location: "India" }]} total={1} query="" pro={false} nextPage={null} /></section>
      <section id="review-plans" className="mt-10"><PlansContent signedIn={false} initiallyAvailable={false} /></section>
    </main>
  </div></div>;
}

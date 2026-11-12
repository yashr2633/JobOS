import Link from "next/link";
import PublicInfoPage from "../components/PublicInfoPage";
import { GUIDES } from "@/lib/seo/guides";
import { publicPageMetadata } from "@/lib/seo/metadata";
export const metadata = publicPageMetadata("/guides", "Job search, resume and recruiter email guides", "Practical JobTrackOS guides for resume tailoring, first resumes and personalised recruiter outreach. Read examples and prepare your next application.");
export default function GuidesPage() {
  return <PublicInfoPage><p className="seo-kicker">THE JOBTRACKOS CAREER GUIDE</p><h1>Find your next step. Prepare it well.</h1><p className="seo-lead">Practical examples and checklists for the work between finding a vacancy and sending a thoughtful application.</p>{GUIDES.map(guide => <section className="seo-card" key={guide.slug}><h2><Link href={`/guides/${guide.slug}`}>{guide.title}</Link></h2><p>{guide.description}</p><Link className="seo-link" href={`/guides/${guide.slug}`}>Read the guide →</Link></section>)}<section className="seo-card"><h2>Put the advice into practice</h2><p>Browse roles by company, location and experience, then compare the requirements with your own evidence.</p><Link className="seo-button" href="/jobs">Explore jobs</Link></section></PublicInfoPage>;
}

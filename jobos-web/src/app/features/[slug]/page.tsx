import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import PublicInfoPage from "../../components/PublicInfoPage";
import { publicPageMetadata } from "@/lib/seo/metadata";

const features = {
  "resume-match": {
    title: "Resume Match & Job Description Comparison", heading: "Understand how your resume fits the job.",
    description: "Compare your resume with a job description. Review matching skills, weak evidence and relevant improvements before tailoring your application.",
    steps: ["Sign in and select or upload your resume.", "Paste the job description you want to evaluate.", "Review the match explanation, matching skills and gaps.", "Prepare a tailored resume or cover letter, review the facts, then export."],
    section: "A useful score needs an explanation", detail: "Resume Match helps you compare the evidence in your document with a particular role. A missing keyword can mean the skill is not documented; it does not prove you lack the skill. The score is not a probability of getting hired or shortlisted.",
    action: "Open Resume Match", href: "/resumes",
  },
  "resume-builder": {
    title: "Resume Builder & Resume Templates", heading: "Build a clear resume from your own experience.",
    description: "Explore JobTrackOS resume templates, edit your information and formatting, preview your document, and export a resume as PDF or DOCX.",
    steps: ["Sign in and choose a resume design from the template gallery.", "Enter your details or use the available resume import workflow.", "Edit your content, section order and document formatting.", "Review the preview and export your document as PDF or DOCX."],
    section: "Choose a design that supports your content", detail: "The gallery includes 60 original visual designs across multiple layout families. For a straightforward application, choose a clear single-column layout with readable headings and selectable text. Review the exported file before applying; no template guarantees ATS acceptance or a shortlist.",
    action: "Open Resume Builder", href: "/resume-builder",
  },
  "cover-letter": {
    title: "Cover Letter Builder & Tailored Cover Letters", heading: "Introduce yourself with a role-specific cover letter.",
    description: "Create and edit a cover letter in JobTrackOS, or prepare a tailored draft from your resume and a job description in Resume Match.",
    steps: ["Sign in and open the cover letter tool to create an editable letter.", "Use your real experience, skills and motivation for the role.", "For a job-specific draft, use your resume and the JD in Resume Match.", "Check the employer, role, candidate facts and formatting before exporting."],
    section: "A cover letter complements your resume", detail: "Explain why your experience is relevant to the employer and give a clear example. JobTrackOS supports general letters and tailored drafts. Review generated text carefully and remove anything you cannot substantiate.",
    action: "Open Cover Letter", href: "/cover-letter",
  },
} as const;
function feature(slug: string) { return Object.hasOwn(features, slug) ? features[slug as keyof typeof features] : undefined; }
export function generateStaticParams() { return Object.keys(features).map(slug => ({ slug })); }
export const dynamicParams = false;
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params, item = feature(slug);
  if (!item) notFound();
  return publicPageMetadata(`/features/${slug}`, item.title, item.description);
}
export default async function FeaturePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params, item = feature(slug);
  if (!item) notFound();
  return <PublicInfoPage><p className="seo-kicker">JOBTRACKOS CAREER TOOLS</p><h1>{item.heading}</h1><p className="seo-lead">{item.description}</p><div className="seo-actions"><Link className="seo-button" href={item.href}>{item.action}</Link><Link className="seo-button" href="/jobs">Explore jobs in India</Link></div><section className="seo-card"><h2>How it works</h2><ol>{item.steps.map(step => <li key={step}>{step}</li>)}</ol></section><section className="seo-card"><h2>{item.section}</h2><p>{item.detail}</p><p>Your saved resumes and personal workspace require sign-in. This public page explains the tool without exposing candidate information.</p></section><h2>Prepare the next part of your application</h2><div className="seo-related">{Object.entries(features).filter(([key]) => key !== slug).map(([key, value]) => <Link className="seo-link" key={key} href={`/features/${key}`}>{value.title}</Link>)}<Link className="seo-link" href="/about">About JobTrackOS and job sources</Link></div></PublicInfoPage>;
}

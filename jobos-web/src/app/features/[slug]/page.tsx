import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import PublicInfoPage from "../../components/PublicInfoPage";
import { publicPageMetadata } from "@/lib/seo/metadata";

const features = {
  "recruiter-outreach": {
    title: "Recruiter Outreach: HR Contacts & Cold Email Drafts", heading: "Recruiter outreach and cold emails for job seekers",
    description: "Browse 3,000+ HR and recruiter contacts in JobTrackOS. Explore names and companies for free; Pro unlocks work emails and personal outreach drafts.",
    steps: ["Sign in and search the recruiter directory by name or company.", "Read the available profile details to choose a relevant contact.", "With Pro, unlock the work email and prepare an introduction using your target role and real experience.", "Review and edit your draft, open it in Gmail or copy it to your email app, attach your resume and send it yourself."],
    section: "Make your cold email useful to the person reading it", detail: "Mention the role or team you are interested in and explain one relevant skill or achievement. Keep your introduction concise, add a clear question, and attach a resume tailored to the opportunity. Directory access is not a job referral or a promise that someone is hiring. Check the company and role before approaching a contact. Work email access and outreach drafts are part of Pro; you stay in control of each message, and JobTrackOS does not send a mass campaign on your behalf.",
    action: "Explore Recruiter Outreach", href: "/recruiters",
    exampleTitle: "Sample cold email to a recruiter for a data analyst role",
    example: [
      "Subject: Junior data analyst opportunities at [Company]",
      "Hi [Recruiter name], I’m looking for junior data analyst roles. In a recent project, I used SQL to group customer orders and built an Excel report to explain the results. If your team is hiring for a similar role, could you point me to the right posting? I’ve attached my resume. Thank you, [Your name]",
    ],
    guide: "/job-search/data-analyst",
    guideLabel: "Find Data Analyst jobs",
  },
  "resume-match": {
    title: "Match Your Resume to a Job Description", heading: "Match your resume to a job description",
    description: "Compare your resume with a job description. Review matching skills, weak evidence and relevant improvements before tailoring your application.",
    steps: ["Sign in and select or upload your resume.", "Paste the job description you want to evaluate.", "Review the match explanation, matching skills and gaps.", "Prepare a tailored resume or cover letter, review the facts, then export."],
    section: "A useful score needs an explanation", detail: "Resume Match helps you compare the evidence in your document with a particular role. A missing keyword can mean the skill is not documented; it does not prove you lack the skill. The score is not a probability of getting hired or shortlisted.",
    action: "Open Resume Match", href: "/resumes",
    exampleTitle: "Resume match example for a fresher Data Analyst role",
    example: [
      "Example job requirement: Use SQL to summarise sales and build reports in Excel.",
      "Before: Completed a sales data project.",
      "After, if accurate: Wrote SQL queries to group orders by month and used Excel pivot tables to compare sales by product.",
      "If the job also asks for Power BI and you haven’t used it, leave that gap visible. List tools you can explain in an interview.",
    ],
    guide: "/guides/tailor-resume-to-job-description",
    guideLabel: "Read the resume tailoring guide",
  },
  "resume-builder": {
    title: "ATS-Friendly Resume Templates & Resume Builder", heading: "Resume templates for freshers and experienced applicants",
    description: "Explore JobTrackOS resume templates, edit your information and formatting, preview your document, and export a resume as PDF or DOCX.",
    steps: ["Sign in and choose a resume design from the template gallery.", "Enter your details or use the available resume import workflow.", "Edit your content, section order and document formatting.", "Review the preview and export your document as PDF or DOCX."],
    section: "Choose a design that supports your content", detail: "The gallery includes 60 original visual designs across multiple layout families. For a straightforward application, choose a clear single-column layout with readable headings and selectable text. Review the exported file before applying; no template guarantees ATS acceptance or a shortlist.",
    action: "Open Resume Builder", href: "/resume-builder",
    exampleTitle: "A simple ATS-friendly fresher resume template",
    example: [
      "[Full name] · [City] · [Email] · [Portfolio or LinkedIn]",
      "Education: [Degree], [College], [Graduation year]",
      "Projects: [Project name] — [What you did], [tools you used] and [result you can explain]",
      "Experience: [Internship or volunteer role], [Organisation], [Dates] — [What you contributed]",
      "Skills: [Tools, languages or methods you can demonstrate]",
    ],
    guide: "/guides/fresher-resume-without-work-experience",
    guideLabel: "See how to write a resume without work experience",
  },
  "cover-letter": {
    title: "Cover Letter Builder & Job Application Examples", heading: "Write a cover letter tailored to a job",
    description: "Create and edit a cover letter in JobTrackOS, or prepare a tailored draft from your resume and a job description in Resume Match.",
    steps: ["Sign in and open the cover letter tool to create an editable letter.", "Use your real experience, skills and motivation for the role.", "For a job-specific draft, use your resume and the JD in Resume Match.", "Check the employer, role, candidate facts and formatting before exporting."],
    section: "A cover letter complements your resume", detail: "Explain why your experience is relevant to the employer and give a clear example. JobTrackOS supports general letters and tailored drafts. Review generated text carefully and remove anything you cannot substantiate.",
    action: "Open Cover Letter", href: "/cover-letter",
    exampleTitle: "Sample cover letter opening for a customer support role",
    example: [
      "Dear [Hiring manager], I’m applying for the Customer Support Associate position at [Company]. In my college help desk role, I answered student queries, logged recurring issues and escalated requests I couldn’t resolve. I’d bring the same approach to handling customer requests on your team.",
      "Replace the example with a responsibility you’ve actually handled. Use one detail from the job description to explain why it matters to this employer.",
    ],
    guide: "/jobs",
    guideLabel: "Find a job to write your cover letter for",
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
  return (
    <PublicInfoPage>
      <p className="seo-kicker">JOBTRACKOS CAREER TOOLS</p>
      <h1>{item.heading}</h1>
      <p className="seo-lead">{item.description}</p>
      <div className="seo-actions">
        <Link className="seo-button" href={item.href}>{item.action}</Link>
        <Link className="seo-link" href="#example">See an example</Link>
      </div>
      <section className="seo-card" id="example">
        <h2>{item.exampleTitle}</h2>
        {item.example.map(line => <p key={line}>{line}</p>)}
        <div className="seo-actions">
          <Link className="seo-button" href={item.href}>{item.action}</Link>
          <Link className="seo-link" href={item.guide}>{item.guideLabel}</Link>
        </div>
      </section>
      <section className="seo-card">
        <h2>How it works</h2>
        <ol>{item.steps.map(step => <li key={step}>{step}</li>)}</ol>
      </section>
      <section className="seo-card">
        <h2>{item.section}</h2>
        <p>{item.detail}</p>
      </section>
      <h2>Prepare the next part of your application</h2>
      <div className="seo-related">
        {Object.entries(features).filter(([key]) => key !== slug).map(([key, value]) => (
          <Link className="seo-link" key={key} href={`/features/${key}`}>{value.title}</Link>
        ))}
        <Link className="seo-link" href="/job-search">Find jobs by role and city</Link>
      </div>
    </PublicInfoPage>
  );
}

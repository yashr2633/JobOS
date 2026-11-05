import Link from "next/link";
import Brand from "./Brand";
import type { ReactNode } from "react";
import "../public-info.css";

export function PublicInfoLinks() {
  return <nav className="seo-info-links" aria-label="Learn about JobTrackOS"><Link href="/features/resume-match">How Resume Match works</Link><Link href="/features/resume-builder">Resume templates &amp; builder</Link><Link href="/features/cover-letter">Cover letter tools</Link><Link href="/about">About JobTrackOS</Link><Link href="/contact">Contact</Link><Link href="/refund-policy">Cancellation &amp; refunds</Link></nav>;
}
export default function PublicInfoPage({ children }: { children: ReactNode }) {
  return <div className="seo-page"><header className="seo-header"><Brand /><nav aria-label="Main navigation"><Link href="/jobs">Find jobs</Link><Link href="/login">Candidate login</Link><Link href="/employer/login">Employer login</Link></nav></header><main id="main-content" className="seo-main">{children}</main><footer className="seo-footer"><PublicInfoLinks /><p><Link href="/privacy-policy">Privacy &amp; contact</Link> · <Link href="/terms">Terms</Link> · <a href="mailto:support@jobtrackos.online">Contact support</a></p><p>© {new Date().getFullYear()} JobTrackOS · Built for job seekers in India.</p></footer></div>;
}

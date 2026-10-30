import Link from "next/link";
export default function ResumeToolsNav({ active }: { active: "match" | "builder" | "letter" }) {
  return <nav className="resume-tools-nav" aria-label="Resume and application documents">
    <Link href="/resumes" aria-current={active === "match" ? "page" : undefined}>Resume Match</Link>
    <Link href="/resume-builder" aria-current={active === "builder" ? "page" : undefined}>Resume Builder &amp; Templates</Link>
    <Link href="/cover-letter" aria-current={active === "letter" ? "page" : undefined}>Cover Letter &amp; Templates</Link>
  </nav>;
}

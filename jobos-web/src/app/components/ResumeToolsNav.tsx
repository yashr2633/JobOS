import Link from "next/link";
export default function ResumeToolsNav({ active }: { active: "match" | "builder" | "letter" }) {
  if (active === "match") return null;
  return <nav className="resume-tools-nav" aria-label="Resume and Cover Letter templates">
    <Link href="/resume-builder" aria-current={active === "builder" ? "page" : undefined}>Resume Builder &amp; Templates</Link>
    <Link href="/cover-letter" aria-current={active === "letter" ? "page" : undefined}>Cover Letter &amp; Templates</Link>
  </nav>;
}

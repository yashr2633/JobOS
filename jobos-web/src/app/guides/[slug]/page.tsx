import Link from "next/link";
import { notFound } from "next/navigation";
import PublicInfoPage from "../../components/PublicInfoPage";
import { GUIDES } from "@/lib/seo/guides";
import { publicPageMetadata, SITE_ORIGIN } from "@/lib/seo/metadata";
export function generateStaticParams() { return GUIDES.map(({ slug }) => ({ slug })); }
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const selected = GUIDES.find(g => g.slug === slug);
  if (!selected) notFound();
  return publicPageMetadata(`/guides/${slug}`, selected.title, selected.description);
}
export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params, guide = GUIDES.find(g => g.slug === slug);
  if (!guide) notFound();
  const schema = { "@context": "https://schema.org", "@type": "Article", headline: guide.title, description: guide.description, author: { "@type": "Organization", name: "JobTrackOS", url: SITE_ORIGIN }, mainEntityOfPage: `${SITE_ORIGIN}/guides/${slug}` };
  return <PublicInfoPage><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, "\\u003c") }} /><nav aria-label="Breadcrumb"><Link className="seo-link" href="/guides">← All career guides</Link></nav><article><p className="seo-kicker">JOBTRACKOS · PRACTICAL APPLICATION ADVICE</p><h1>{guide.title}</h1><p className="seo-lead">{guide.description}</p><p>By JobTrackOS · Published 12 November 2026</p>{guide.sections.map(section => <section className="seo-card" key={section.title}><h2>{section.title}</h2>{section.paragraphs.map((p, i) => <p style={{ whiteSpace: "pre-line" }} key={i}>{p}</p>)}</section>)}<section className="seo-card"><h2>Try it with your own application</h2><Link className="seo-button" href={guide.tool}>{guide.toolLabel}</Link></section></article><section className="seo-card"><h2>Keep preparing</h2>{GUIDES.filter(g => g.slug !== slug).map(g => <p key={g.slug}><Link className="seo-link" href={`/guides/${g.slug}`}>{g.title}</Link></p>)}</section></PublicInfoPage>;
}

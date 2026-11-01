import type { Metadata } from "next";

export const SITE_ORIGIN = "https://www.jobtrackos.online";
export const HOME_TITLE = "JobTrackOS | Find Jobs in India, Resume Match & Templates";
export const HOME_DESCRIPTION = "Explore jobs in India, compare your resume with a job description, and prepare tailored resumes and cover letters with JobTrackOS.";
export const PRODUCT_DESCRIPTION = HOME_DESCRIPTION;

/** Only these anonymous, public pages belong in the sitemap. */
export const PUBLIC_PATHS = ["/", "/jobs", "/features/resume-match", "/features/resume-builder", "/features/cover-letter", "/about", "/privacy-policy", "/terms"] as const;

export const PRIVATE_ROBOTS: Metadata["robots"] = {
  index: false,
  follow: false,
  noarchive: true,
  googleBot: { index: false, follow: false, noimageindex: true },
};

export function publicPageMetadata(path: string, title: string, description: string): Metadata {
  const url = new URL(path, SITE_ORIGIN).href;
  return {
    title: path === "/" ? { absolute: title } : title,
    description,
    alternates: { canonical: url },
    robots: { index: true, follow: true },
    openGraph: { type: "website", siteName: "JobTrackOS", title, description, url,
      images: [{ url: `${SITE_ORIGIN}/opengraph-image`, width: 1200, height: 630, alt: "JobTrackOS — Find jobs and prepare your application" }] },
    twitter: { card: "summary_large_image", title, description,
      images: [{ url: `${SITE_ORIGIN}/opengraph-image`, alt: "JobTrackOS — Find jobs and prepare your application" }] },
  };
}

/** Privacy hint only: never validate, read, change or log an auth token here. */
export function hasSessionCookie(cookieNames: string[]): boolean {
  return cookieNames.some(name => /^sb-.+-auth-token(?:\.\d+)?$/.test(name));
}

export function homepageMetadata(cookieNames: string[], params: Record<string, unknown> = {}): Metadata {
  const metadata = publicPageMetadata("/", HOME_TITLE, HOME_DESCRIPTION);
  if (hasSessionCookie(cookieNames)) return { ...metadata, robots: PRIVATE_ROBOTS };
  return Object.keys(params).some(key => !/^(utm_|gclid$|fbclid$)/.test(key)) ? { ...metadata, robots: { index: false, follow: true } } : metadata;
}

/** Only the unfiltered anonymous listing is an indexing destination. */
export function jobsPageMetadata(cookieNames: string[], params: Record<string, unknown>): Metadata {
  const metadata = publicPageMetadata("/jobs", "Jobs in India", "Browse India job opportunities from connected employer sources. Check the role, location and source before preparing your application.");
  if (hasSessionCookie(cookieNames)) return { ...metadata, robots: PRIVATE_ROBOTS };
  return Object.keys(params).length ? { ...metadata, robots: { index: false, follow: true } } : metadata;
}

/** Public product identity only; no offers, ratings, statistics or user data. */
export const PUBLIC_STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", "@id": `${SITE_ORIGIN}/#organization`, name: "JobTrackOS", url: `${SITE_ORIGIN}/`, description: PRODUCT_DESCRIPTION, logo: `${SITE_ORIGIN}/brand-mark.svg` },
    { "@type": "WebSite", "@id": `${SITE_ORIGIN}/#website`, name: "JobTrackOS", alternateName: ["Job Track OS", "jobtrackos.online"], url: `${SITE_ORIGIN}/`,
      description: PRODUCT_DESCRIPTION, publisher: { "@id": `${SITE_ORIGIN}/#organization` } },
  ],
};

export const PUBLIC_STRUCTURED_DATA_JSON = JSON.stringify(PUBLIC_STRUCTURED_DATA).replace(/</g, "\\u003c");

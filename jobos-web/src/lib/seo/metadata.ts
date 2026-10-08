import type { Metadata } from "next";

export const SITE_ORIGIN = "https://www.jobtrackos.online";
export const HOME_TITLE = "JobTrackOS | Job Application Tracker & Resume Match";
export const HOME_DESCRIPTION = "Track job applications, organize Gmail job updates, match your resume with job descriptions, and tailor resumes with JobTrackOS.";
export const PRODUCT_DESCRIPTION = "JobTrackOS helps job seekers organize job applications, track application-related Gmail updates, view their application journey and use resume matching and tailoring tools.";

/** Only these anonymous, public pages belong in the sitemap. */
export const PUBLIC_PATHS = ["/", "/privacy-policy", "/terms"] as const;

export const PRIVATE_ROBOTS: Metadata["robots"] = {
  index: false,
  follow: false,
  noarchive: true,
  googleBot: { index: false, follow: false, noimageindex: true },
};

export function publicPageMetadata(path: typeof PUBLIC_PATHS[number], title: string, description: string): Metadata {
  const url = new URL(path, SITE_ORIGIN).href;
  return {
    title: path === "/" ? { absolute: title } : title,
    description,
    alternates: { canonical: url },
    robots: { index: true, follow: true },
    openGraph: { type: "website", siteName: "JobTrackOS", title, description, url,
      images: [{ url: `${SITE_ORIGIN}/opengraph-image`, width: 1200, height: 630, alt: "JobTrackOS — Job Application Tracker & Resume Match" }] },
    twitter: { card: "summary_large_image", title, description,
      images: [{ url: `${SITE_ORIGIN}/opengraph-image`, alt: "JobTrackOS — Job Application Tracker & Resume Match" }] },
  };
}

/** Privacy hint only: never validate, read, change or log an auth token here. */
export function hasSessionCookie(cookieNames: string[]): boolean {
  return cookieNames.some(name => /^sb-.+-auth-token(?:\.\d+)?$/.test(name));
}

export function homepageMetadata(cookieNames: string[]): Metadata {
  const metadata = publicPageMetadata("/", HOME_TITLE, HOME_DESCRIPTION);
  return hasSessionCookie(cookieNames) ? { ...metadata, robots: PRIVATE_ROBOTS } : metadata;
}

/** Public product identity only; no offers, ratings, statistics or user data. */
export const PUBLIC_STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", "@id": `${SITE_ORIGIN}/#organization`, name: "JobTrackOS", url: `${SITE_ORIGIN}/` },
    { "@type": "WebSite", "@id": `${SITE_ORIGIN}/#website`, name: "JobTrackOS", url: `${SITE_ORIGIN}/`,
      description: PRODUCT_DESCRIPTION, publisher: { "@id": `${SITE_ORIGIN}/#organization` } },
  ],
};

export const PUBLIC_STRUCTURED_DATA_JSON = JSON.stringify(PUBLIC_STRUCTURED_DATA).replace(/</g, "\\u003c");

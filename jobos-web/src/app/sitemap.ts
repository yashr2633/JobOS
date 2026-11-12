import type { MetadataRoute } from "next";
import { PUBLIC_PATHS, SITE_ORIGIN } from "../lib/seo/metadata.ts";
import { GUIDES } from "../lib/seo/guides.ts";

export default function sitemap(): MetadataRoute.Sitemap {
  // No invented lastModified timestamps or authenticated/user-specific URLs.
  return [...PUBLIC_PATHS.map(path => ({ url: new URL(path, SITE_ORIGIN).href })), { url: `${SITE_ORIGIN}/opportunities` }, { url: `${SITE_ORIGIN}/guides` }, ...GUIDES.map(g => ({ url: `${SITE_ORIGIN}/guides/${g.slug}` }))];
}

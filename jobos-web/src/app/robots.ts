import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "../lib/seo/metadata.ts";

export default function robots(): MetadataRoute.Robots {
  // Let crawlers read noindex on excluded pages. Blocking them here would hide
  // that directive; existing authentication still protects all personal data.
  return { rules: { userAgent: "*", allow: "/" }, sitemap: `${SITE_ORIGIN}/sitemap.xml` };
}

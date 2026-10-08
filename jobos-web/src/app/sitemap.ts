import type { MetadataRoute } from "next";
import { PUBLIC_PATHS, SITE_ORIGIN } from "../lib/seo/metadata.ts";

export default function sitemap(): MetadataRoute.Sitemap {
  // No invented lastModified timestamps or authenticated/user-specific URLs.
  return PUBLIC_PATHS.map(path => ({ url: new URL(path, SITE_ORIGIN).href }));
}

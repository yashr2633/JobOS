import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Indexing headers only: no redirects, rewrites, caching or API/auth changes.
  async headers() {
    return ["api", "auth", "admin", "applications", "jobs", "resume-match", "resumes", "settings", "track-my-jobs", "login", "signup"].map(segment => ({
      source: `/${segment}/:path*`,
      headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }],
    }));
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Public job browsing opts in via page metadata. Personal and API routes stay closed.
  async headers() {
    return ["api", "auth", "admin", "applications", "jobs/internal", "jobs/applied", "resume-match", "resumes", "resume-builder", "cover-letter", "settings", "track-my-jobs", "login", "signup", "profile", "employer", "gmail"].map(segment => ({
      source: `/${segment}/:path*`,
      headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }],
    }));
  },
  async redirects() {
    // Consolidate only public pages on the old hostname. Leave API, OAuth,
    // signed-in workspaces and root code exchange under their existing handlers.
    return ["/", "/privacy-policy", "/terms", "/jobs", "/about", "/features/:slug", "/opportunities/:id", "/locations/:city"].map(source => ({
      source,
      has: [{ type: "host" as const, value: "jobtrackos.vercel.app" }],
      missing: [{ type: "query" as const, key: "code" }, { type: "query" as const, key: "error" }, { type: "header" as const, key: "cookie", value: ".*sb-[^=;]+-auth-token.*" }],
      destination: `https://www.jobtrackos.online${source}`,
      permanent: true,
    }));
  },
};

export default nextConfig;

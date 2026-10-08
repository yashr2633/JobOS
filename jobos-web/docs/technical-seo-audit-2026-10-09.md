# JobTrackOS technical SEO audit — October 9, 2026

## Review state

**Implemented and validated locally. No deployment or Git push was performed.**

- Review branch: `codex/technical-seo-2026-10-09`.
- Preserved production baseline: `cedaf85bd5110195df85d5c384bfba73fd142050`.
- Rollback branch: `codex/seo-rollback-2026-10-09`, pointing to that baseline.
- Production URL: https://www.jobtrackos.online/.
- Remote `main` still pointed to the baseline when checked after implementation.
- Unrelated untracked chart data, investor-deck and promo-video assets were left untouched.

## 1. Existing SEO status and route inventory

Anonymous HTTP responses from the actual production origin were inspected without cookies. Source routes, metadata, middleware and installed Next.js documentation were inspected separately.

| Route | Existing production observation | Intended indexing |
| --- | --- | --- |
| `/` | 200; server-rendered public marketing content, existing brand/tagline title and description | Index anonymous public content only |
| `/privacy-policy` | 200; distinct title and factual description; server-rendered legal content | Index |
| `/terms` | 200; distinct title and factual description; server-rendered legal content | Index |
| `/login`, `/signup` | 200; inherited homepage metadata, no explicit exclusion | Exclude |
| `/applications`, `/jobs`, `/admin/*`, `/resumes/*`, `/resume-match`, `/settings/*`, `/track-my-jobs` | Authenticated application routes; existing auth guards protect personal content | Exclude |
| `/auth/*`, `/api/*` | Authentication callbacks and API endpoints | Exclude |
| `/robots.txt`, `/sitemap.xml` | Both returned 404 on production | Publish discovery endpoints after approved deployment |

The homepage also serves the signed-in dashboard at the same `/` URL. That shared route requires conditional indexing metadata; making every response to `/` indexable would be inappropriate.

The non-www HTTPS homepage returned **308** to `https://www.jobtrackos.online/`. Canonicals therefore use the existing www HTTPS origin. No redirect or domain configuration was changed.

## 2. Issues found

- Missing robots.txt and XML sitemap.
- Missing canonical links on the three public pages.
- Homepage title could describe the existing product more directly.
- Missing explicit Open Graph/Twitter sharing metadata and product identity structured data.
- Login/signup and the signed-in homepage lacked explicit noindex directives.
- Private routes and API responses lacked a consistent indexing header.

No broken internal links were found among the links rendered on the three public pages: `/`, `/login`, `/signup`, `/privacy-policy`, `/terms` all returned 200. Each public page had one H1 followed by H2 sections; the existing headings and link structure were retained.

Public content was present in the initial server HTML rather than requiring client rendering. The homepage's existing private/no-store caching reflects its shared authenticated route. Legal pages remain static. Fonts, caching, routing and bundles were not refactored for speculative performance gains. Core Web Vitals, field performance and Lighthouse scores were not measured; basic HTTP timing would not establish those metrics.

## 3. Changes implemented

- Homepage SEO title: **JobTrackOS | Job Application Tracker & Resume Match**.
- Homepage description: **Track job applications, organize Gmail job updates, match your resume with job descriptions, and tailor resumes with JobTrackOS.**
- Centralized public canonical and sharing metadata; existing legal titles/descriptions retained.
- Public pages explicitly opt into index/follow. Other pages inherit noindex/nofollow; private route prefixes, login/signup, callbacks and APIs also receive `X-Robots-Tag: noindex, nofollow, noarchive`.
- Homepage metadata checks only Supabase session cookie **names**, including chunked cookies, to conservatively return noindex for the dashboard response. It does not validate/read token values, request authentication, mutate cookies or change existing access guards. Expired session cookie names also conservatively produce noindex.
- Added a sitemap containing only the three public canonical pages. No fabricated modification dates, response counts or priority values.
- Added robots.txt advertising the sitemap. Crawling is allowed so crawlers can read noindex on excluded pages. Existing authentication still protects actual user data: indexing directives are not access control.
- Added public-only Organization and WebSite JSON-LD with supported product facts. No ratings, offers, pricing, statistics, personal data, search action, job aggregation or interview preparation claims.
- Added a static 1200 × 630 social share image using Next.js's existing image renderer and product colors. No dependency installation or visible UI change.
- Preserved the existing Google verification metadata exactly.

Google explains why blocked crawling can prevent noindex from being read in its [noindex documentation](https://developers.google.com/search/docs/crawling-indexing/block-indexing). This is why robots.txt does not disallow the private paths.

## 4. Exact files changed

All paths below are relative to the repository root.

| File | Change |
| --- | --- |
| `jobos-web/next.config.ts` | Indexing headers only |
| `jobos-web/src/app/layout.tsx` | Metadata base, descriptive defaults, default private indexing directive |
| `jobos-web/src/app/page.tsx` | Conditional homepage metadata and anonymous public JSON-LD |
| `jobos-web/src/app/privacy-policy/page.tsx` | Canonical, indexing and sharing metadata |
| `jobos-web/src/app/terms/page.tsx` | Canonical, indexing and sharing metadata |
| `jobos-web/src/app/robots.ts` | New robots.txt route |
| `jobos-web/src/app/sitemap.ts` | New public-only sitemap route |
| `jobos-web/src/app/opengraph-image.tsx` | New static social image route |
| `jobos-web/src/lib/seo/metadata.ts` | Shared SEO metadata and supported public structured data |
| `jobos-web/src/lib/seo/metadata.test.ts` | Four SEO regression tests |
| `jobos-web/src/app/uiIntegrity.test.ts` | Update existing title/description assertion for the requested SEO title |
| `jobos-web/docs/technical-seo-audit-2026-10-09.md` | This review report |

## 5. Validation results

| Check | Result |
| --- | --- |
| TypeScript: `npx tsc --noEmit` | PASS |
| ESLint on all changed TypeScript/TSX files | PASS, no errors/warnings |
| Production build: `npm run build` | PASS, 43 generated routes/pages |
| Existing AI tests | 99 PASS |
| Existing resume/upload/extraction/export tests | 65 PASS |
| Existing Gmail/OAuth/token/security/pipeline tests | 442 PASS |
| Existing application tests | 40 PASS |
| Existing dashboard tests | 65 PASS |
| Existing UI/account tests | 114 PASS |
| New SEO tests: `node --test src/lib/seo/metadata.test.ts` | 4 PASS |
| Built production server HTTP checks | 18 groups PASS |
| Source invariance checks | PASS |
| `git diff --check` | PASS |

Total automated unit/regression tests: **829 passed, zero failures** across the listed suites. Known unrelated Job Discovery tests and repository-wide historical lint were outside this scope and were not represented as passing. The build's existing middleware deprecation and multiple-lockfile warnings remain; no migration or cleanup was attempted.

The final built server was tested at localhost, with anonymous Googlebot requests:

- Three public pages: 200, one H1, correct canonical, index/follow, no inherited Googlebot noindex, Open Graph/Twitter metadata, public homepage JSON-LD and preserved Google verification tag.
- A synthetic session-cookie name (not a real credential): homepage noindex.
- Seven protected route checks: original 307 login redirects preserved, with noindex headers.
- Login and signup: 200 and noindex in both metadata and headers.
- Representative API checks: existing admin 401 and deprecated Gmail status 410 preserved, both with noindex headers. The 410 is existing behavior, not a new error.
- robots.txt and sitemap.xml: 200; sitemap contains exactly three public URLs.
- Social image: 200 image/png, 1200 × 630; visually inspected for correct text and layout.

Browser layout checks at observed **391 × 844** and **1279 × 800 CSS pixels** found no horizontal document overflow. A further default-width check also passed. Browser console inspection found no warnings/errors on the local anonymous homepage. The browser screenshot service cropped captures under Windows scaling; screenshots alone were not treated as proof of full-page mobile rendering. Layout measurements and source invariance provide the additional evidence. No responsive CSS was changed.

Source comparisons confirmed that the authenticated homepage function, visible public JSX (apart from non-visible JSON-LD), legal text, RootLayout body/providers/theme, and all protected feature implementation files were unchanged from the baseline. Authentication, OAuth, Gmail, tracking, Resume Match, tailoring, exports, billing, environment, database/schema/RLS and user data were not modified.

These are automated/source and anonymous built-server regression checks, **not a claim that live signed-in Google/Gmail/resume flows were rerun on the new version**. The new version has not been deployed. No destructive production tests were run.

## 6. Remaining risks and limitations

1. Production still serves the preserved version; the new SEO endpoints and metadata are available only in the validated local build until approved deployment and production verification.
2. Google Search Console indexing status, chosen canonical and Core Web Vitals were not verified. No claim is made that Google has indexed the site or that adding a sitemap guarantees indexing.
3. A browser with an expired Supabase session-cookie name conservatively receives homepage noindex until that cookie is cleared by the existing auth flow. Fresh anonymous crawlers receive index/follow. Actual signed-in metadata should be smoke-tested after an approved deployment; the synthetic cookie check is not a live auth test.

## 7. Exact sitemap URL

**https://www.jobtrackos.online/sitemap.xml**

At audit time this production URL returned 404. The final local production build returns valid XML with:

- https://www.jobtrackos.online/
- https://www.jobtrackos.online/privacy-policy
- https://www.jobtrackos.online/terms

## 8. Manual Google Search Console actions

The domain property `jobtrackos.online` already exists. No DNS-verification changes are assumed or requested.

After approving and completing deployment:

1. Open the existing domain property. Under **Sitemaps**, submit `https://www.jobtrackos.online/sitemap.xml` and confirm that Google can fetch it.
2. Use **URL Inspection → Test live URL** for the homepage and the two legal URLs. Confirm public crawl access, indexability and the www HTTPS canonical; request indexing where appropriate.
3. Check the sitemap and Page indexing reports after Google processes them. Use URL Inspection to confirm Google's selected canonical and actual indexing status; requests alone do not prove indexing.
4. Confirm login/signup/private routes are excluded after recrawling. Do not request indexing for dashboards, application/resume data, callbacks or APIs.

See Google's [sitemap submission guidance](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap). Sitemap submission does not guarantee crawling or indexing. No Search Console setting or indexing request was changed during this audit.

## 9. Rollback procedure

Nothing needs rolling back in production now because nothing was deployed.

The preserved point is `codex/seo-rollback-2026-10-09` at `cedaf85bd5110195df85d5c384bfba73fd142050`. The prior Gmail recovery branch also retains that commit.

If this SEO commit is later approved and deployed, use the project's existing Vercel rollback process to restore the previously successful deployment of that exact baseline. Alternatively, revert the SEO commit on the deployment branch and run the existing normal deployment process. Do not reset/force-push shared history or change DNS, domains, OAuth settings, credentials or database configuration. Recheck public access and the critical signed-in path after a rollback.

## 10. Deployment confirmation

**NO deployment was performed. NO branch was pushed.** The SEO work is a local review commit on its separate branch. Development stops here pending explicit production deployment approval.

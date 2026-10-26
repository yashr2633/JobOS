# India discovery: coverage, reliability and navigation

## Scope and evidence

Base: `2d137014cf09dcb42b37e73d616dd352d6bb93ea`; branch: `codex/india-discovery-2026-10-26`.
No database migration, user-data mutation, dependency change, OAuth change or Gmail pipeline change is required.

The old default registry connected one India employer (Razorpay), plus Palantir and Ashby global boards. A live check found no India jobs in those two global feeds. They are now disabled in the default India registry; both adapters and explicitly configured sources remain supported. The previous feed also applied recommendation eligibility to Latest and manual searches, hiding available vacancies when their fit fell below the user's saved preferences.

The jobs route awaited all external providers before rendering its application shell. Its only catalog cache was process-local. Resume Match downloaded full saved resume rows, including text and parsed documents, just to populate a name/ID dropdown.

## Changes

- `src/lib/jobs/smartrecruiters.ts`: documented public Posting API adapter, India country restriction, PUBLIC destination, complete bounded pagination (100/page; maximum 3,000 per board), six concurrent requests and 150 ms request-launch pacing per server process. Rate limits also apply upstream across instances; HTTP errors remain explicit failures. No internal postings, credentialed feeds or arbitrary URL fetches.
- `src/lib/jobs/sources-india.ts`: four employer boards identified through real employer ATS listings, not guessed IDs. No universal job search is claimed.
- `src/lib/jobs/providers.ts`, `ats.ts`: shared provider registry and live rechecks; report every source failure, not just majority failures; respect explicitly empty optional-provider configuration. Five-minute process cache, one-minute failure cache. Known closed listings are excluded from subsequent cached reads in that process.
- `src/lib/jobs/cachedCatalog.ts`: Next persistent cache contains public India listings only. Cache keys include source configuration; revalidation is five minutes and process caching can add another five minutes. Original check timestamps are retained. Listings whose successful checks exceed 20 minutes are removed from active results even if the cache serves old data during a failure. No profile/resume/session data is cached globally.
- `src/app/jobs/page.tsx`, `loading.tsx`, `components/WorkspaceLoading.tsx`: stream the application shell and use a consistent placeholder while providers load; internal employer jobs load independently.
- `JobsWorkspace.tsx`, `browsing.ts`, `JobCard.tsx`: Latest is the initial general view; profile cutoff applies only to For You without a manual query. India browsing requires India location evidence (unproven worldwide remote jobs are excluded). Free-text city search supports locations beyond the preset list, with aliases and Delhi NCR handling. Added category/employment filters and 90/180-day date windows. Results count comes from actual filtered records. Full descriptions load on opening a job rather than issuing thousands of detail requests during feed loading.
- `src/app/api/jobs/detail/route.ts`: authenticated, fixed-source live detail endpoint. Existing save/apply actions still recheck source membership, retain the full description and use the existing Applications confirmation flow. Opening an external listing does not submit an application.
- `src/lib/resumes/options.ts`, Resume Match component/loading route: query IDs/labels only for the dropdown, retaining owner RLS and existing ordering. Analysis, tailoring and export still retrieve the selected resume through their existing paths.

## Publication and freshness semantics

SmartRecruiters `releasedDate` is retained separately as `releasedAt`. It may reflect republication. `postedAt` remains null unless the original publication date is actually supplied; neither synchronization time nor release time is substituted for it. Cards label source release dates; details explain that the original date is unavailable. The date filter is explicitly labelled "Posted or source released" and prefers the original date when known. Full fit scores are withheld for metadata-only cards until the employer description has loaded. Older source-listed vacancies remain available without being described as new.

The initial view and dashboard recommendations use the last 30 days by known posting date or explicitly labelled source release date. Older active jobs remain accessible by expanding the date window; they do not mix into the initial recent results. Metadata-only feeds do not supply numeric experience or every skill requirement: filters use known information, and full matching becomes available after opening the job. Missing details are not guessed.

Role/company search uses whole words instead of matching short title fragments inside longer search words (for example, `IT` inside `security`). Explicit skill searches can also inspect the available role requirements. Full details already loaded in the current browser session are reused in cards and filters. Saved/pending/hidden views retain their full date range on entry rather than inheriting the recent-discovery default. After a long idle period, the first visitor joins a bounded live refresh instead of being left with an expired empty feed while background cache refresh finishes.

Refresh is on demand through normal cache revalidation; this change does not create a daily background ingestion service. Closing a job is rechecked on detail/save/apply, with feed refresh providing the next full reconciliation. Source availability is visible in the UI. A failed source supplies no silently recycled fresh-looking jobs.

## Actual source observation

Observed 2026-10-26 at 15:30 UTC (21:00 IST); counts are a moment-in-time source snapshot, not a promised daily volume. Machine-readable evidence: repository-root `output/india-discovery-live-2026-10-26.json` (local, not committed).

| Employer | Access/coverage | Public feed rows | Limitations |
|---|---|---:|---|
| Razorpay | Greenhouse public board API, fintech/business/engineering | 26 worldwide, 22 India | Employer-specific; original publication dates available |
| Bosch Group | SmartRecruiters public Posting API, India only | 631 | Employer-specific; release date can be republication |
| Accor | Same public API, India hospitality/operations/sales | 803 | Employer-specific; release date can be republication |
| SGS | Same public API, India testing/inspection/finance/support | 26 | Employer-specific; release date can be republication |
| Eurofins | Same public API, India science/quality/software/support | 336 | Employer-specific; release date can be republication |

After normalization/deduplication: **1,818 India listings**, 27 source function categories. Examples include Agra, Guwahati, Gandhidham, Gangaikondan, Tiruppur, Udaipur and Vijayawada as well as metros. Category/city presence is not a claim of complete national coverage. Only three jobs had known original posting dates in the preceding 24 hours; another 24 had recent source release dates. These two measures must never be combined and called "27 new jobs".

Individual public descriptions and official application URLs were fetched successfully for a sample from each of the four new employers. No applications were submitted. One observed local provider cold run took 5,483 ms; the immediate process-cache read took 1 ms. An earlier run including the two irrelevant global sources took 32,823 ms. These are local source-catalog timings, not a controlled benchmark or production navigation measurements.

## Source documentation and access dependencies

- [SmartRecruiters public postings](https://developers.smartrecruiters.com/reference/v1listpostings), [endpoints](https://developers.smartrecruiters.com/docs/endpoints), [customer API overview and limits](https://developers.smartrecruiters.com/docs/customer-overview). Only public GET data is used. Boards: [Bosch India](https://careers.smartrecruiters.com/BoschGroup/india), [Accor employer listing](https://jobs.smartrecruiters.com/AccorHotel/744000157752526), [SGS employer listing](https://jobs.smartrecruiters.com/SGS/744000156747119), [Eurofins employer listing](https://jobs.smartrecruiters.com/Eurofins/744000157805820). No API keys required for the implemented public endpoints.
- [Jooble API](https://jooble.org/api/about): potentially broader aggregation, but requires an issued key and confirmation of permitted usage/coverage. User confirmed no existing access. Not configured or claimed verified.
- [Adzuna overview](https://developer.adzuna.com/overview), [terms](https://developer.adzuna.com/docs/terms_of_service): app ID/key and applicable commercial licensing/attribution required. Do not treat evaluation access as an unrestricted free production license. Not configured.
- [Indeed job posting and publisher integrations](https://docs.indeed.com/job-postings): publisher functionality exists, subject to provisioned partner access. Job posting/ATS APIs are not unrestricted global search APIs. Not configured.
- [LinkedIn ATS partners](https://business.linkedin.com/hire/ats-partners/partner-application): approved integrations and agreements are required; there is no verified unrestricted LinkedIn vacancy feed here. No restricted scraping, access bypass or universal direct-application claim.

Broader nationwide, cross-employer coverage remains a product phase requiring more independently verified direct sources and/or licensed aggregation/publisher access. The four added employers provide a substantial usable feed, not every Indian vacancy. No paid account or contractual terms have been accepted on the user's behalf.

## Acceptance checks

- Provider fixtures: public/private separation, strict India evidence, exact source URLs, no invented salary/deadlines/original dates, complete pagination, safe failure on truncation, closure and unconfigured boards.
- Browsing fixtures: unrelated profile does not hide manual searches/Latest; For You retains its relevance threshold; unknown/future dates are excluded from dated windows; old active listings are not automatically expired.
- Resume selection fixture: only ID/label fields and default-first ordering.
- Existing discovery, UI, resume flow, document/export and extraction regression suites; TypeScript; changed-file lint; production build.
- Actual live public feed and detail verification as recorded above. Signed-in browser checks and deployment status are recorded in the final response after they are actually performed.

Observed local verification: final production build and its TypeScript phase passed; changed-file lint passed. The combined UI/resume/export/discovery run passed 147 tests with one optional live Greenhouse test skipped; the later discovery run including the additional search regression passed 28 tests with one optional integration skipped. These runs overlap and their totals must not be added. Actual public feed checks above were run separately, so the skipped optional fixture is not a claim that all live sources were untested.

Signed-in browser verification loaded 781 results in the default 30-day window, 37 personalized recommendations, and one Security Guard result when searching beyond the saved analyst profile. An earlier loose substring implementation returned 93 mixed results for that query; the final whole-word search removed those irrelevant results. Tiruppur had seven source-listed jobs across all dates and one within the recent window. A real employer description and its fit explanation loaded successfully. Existing Resume Match application/resume dropdowns loaded with the reduced selection query. No console errors were observed in the final test tab. No save/apply confirmation, resume analysis request, Gmail scan or production user-data mutation was performed as part of these browser checks.

## Rollback and rollout

The initial production smoke test of `1b06f8a` loaded 781 recent results, all five sources responded, and a real Accor description/fit loaded. It also exposed a React text hydration error caused by timezone-dependent verification labels (Vercel UTC versus the candidate's timezone). The follow-up fix formats these labels deterministically as explicit IST, with regression coverage for UTC, India, US and date rollover. Final deployment and post-fix console verification are reported separately; initial deployment success alone is not considered the final pass.

A later real refresh of `a8445b1` returned 81 recent results because Bosch and Accor were unavailable; the UI displayed the partial-source warning. This is an observed upstream synchronization failure, not a confirmed HTTP failure code: the connected Vercel account cannot read the owning `homie7` project's logs. The adapter now exposes sanitized failure categories, retries HTTP 429/5xx once within the existing total deadline (respecting short numeric or HTTP-date Retry-After; longer requests are not retried early), and handles changing source totals during offset pagination. A shrinking feed no longer fails merely because its latest total differs from its first page, and newly discovered extra pages are followed within the 3,000-row cap. These cases are reproduced in fixtures; the exact historical upstream failure must not be invented.

The shared cache now accepts only complete successful source snapshots. A temporary partial refresh cannot replace a previously healthy shared snapshot. Reused data keeps its original verification/publication/release times, displays a previously-checked warning after five minutes and expires from active display after 20 minutes. When no healthy snapshot exists, actual partial results remain visible with their failure warning and are not persisted as a healthy five-minute catalog. No source count or verification date is fabricated. The focused discovery run covering retries, mutable pagination and this cache policy passed 32 tests with one optional integration skipped; final production results must still be observed after release.

The deployed baseline remains recoverable at `2d137014cf09dcb42b37e73d616dd352d6bb93ea`. No irreversible database step is part of this change. If approved for production, use the existing Git-to-Vercel production workflow; inspect the real production feed and detail route afterward. Do not call this deployed or claim production performance until that happens.

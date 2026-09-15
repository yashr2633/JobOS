# Public job sources

The source engine keeps Greenhouse and adds the documented public Lever and Ashby job-posting APIs. No key, fee, user data transfer or new OAuth scope is needed.

- `JOB_DISCOVERY_GREENHOUSE_BOARDS`: unchanged; default `canonical`.
- `JOB_DISCOVERY_LEVER_BOARDS`: default `palantir`.
- `JOB_DISCOVERY_ASHBY_BOARDS`: default `ashby` (board names are case-sensitive).

Each accepts comma-separated official board tokens, maximum five. An empty value disables that provider. `additionalSources()` in `src/lib/jobs/ats.ts` provides provider, board, company label, official board URL and enabled status. Extend that registry for additional verified company labels; never add fabricated listings. This is a bounded set of public employer boards, not a market-wide search engine. Lever uses at most ten 100-item pages and omits a board with a warning if it exceeds that bound. Ashby excludes `isListed: false` jobs.

The existing catalog cache and failure isolation aggregate all three providers. Apply/Resume Match verify live membership again; Ashby re-reads its public board because this API has no single-posting endpoint. Only fixed provider hosts are fetched and redirects are refused. Original official apply URLs, including queries, survive normalization; tracking parameters are removed only from internal deduplication keys. No new schema or application storage is introduced.

Age alone no longer excludes a published job, even if the posted date is absent. Recent provider confirmation and non-expiry are still required. Relevance precedes freshness in Best Matches; explicit Date Posted filters still work. Public publication confirms listing availability, not recruiter activity or a guarantee that the vacancy is being filled. Existing UI freshness wording was deliberately not edited in this source-only pass and requires a separate copy update.

Generic career-page crawling is intentionally deferred. No unauthorized scraping, paid aggregators, or new dependencies are used.

Official documentation: https://github.com/lever/postings-api and https://developers.ashbyhq.com/docs/public-job-posting-api

Focused verification: `node --test src/lib/jobs/discovery.test.ts src/lib/jobs/sources.test.ts`. Set `JOB_DISCOVERY_LIVE_TEST=1` to include public-network list/detail checks.

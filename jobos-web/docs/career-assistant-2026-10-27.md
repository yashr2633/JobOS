# Guided Career Assistant and submitted company search

## Scope

The authenticated home now starts with the approved role → location → experience
→ review flow. Existing Gmail scanning, Applications, Resume Match, tailoring and
export remain reachable through the same components and routes. Application totals
and reports are in the expandable overview; Gmail controls remain outside it.

An optional saved/uploaded resume uses the existing resume library. Only its owned
identifier enters the jobs URL; server-side library ownership is checked before
using its evidence. Resume text is never sent to public job search. Public free-text
preferences use the existing AI gateway to interpret filters, followed by an editable
review. This endpoint requires authentication, same-origin requests, bounded public
input, schema validation and a per-instance burst guard. It does not create jobs.

## Search reliability

- Role, company and location inputs have suggestions, including a company-name
  directory independent of successful feeds. Names/aliases are search vocabulary;
  suggestions never claim that a company's jobs have been imported.
- Draft text does not filter the visible feed until Search jobs is submitted.
- Unknown experience is labelled and retained unless specifically filtering for
  specified experience. It is not represented as proven candidate eligibility.
- Personal-data failures no longer blank employer results. Account actions and
  preference edits are paused during that failure to avoid overwriting saved data.
- Public employer snapshots are cached separately per configured employer. A single
  aggregate near Next's 2 MB cache-entry limit is no longer required. Each snapshot
  keeps its original source-check timestamps; failures and expired checks remain
  explicit. The employer refresh window remains five minutes, with a maximum
  20-minute display age. Public source data only enters this cache.
- Ranking uses the newest observed source check as its comparison clock. The
  conservative aggregate check can be older than another employer's fresh jobs;
  using it as the clock incorrectly hid those jobs until the next client update.
  A regression test reproduces that first-render failure and verifies both source
  timestamps remain unchanged. Dashboard recommendations use the same comparison.

## Additional public sources

A deliberately submitted role/company search automatically invokes the existing
Google-grounded search integration within Find Jobs. This removes the separate
manual web-search step while preserving the complete response, citations and Google
Search Suggestions. These are labelled hiring leads, not independently confirmed
vacancies, and are not added to the employer-feed count, database or match scores.
The original source remains the destination for checking details and applying.

This restriction follows the grounded-result terms documented in the existing
location/web-search work: https://ai.google.dev/gemini-api/terms . Public visibility
alone does not authorize scraping/republication of every company's careers portal.

The existing 15 employer feeds and Himalayas integration remain the card sources.
Google, Amazon, Deloitte, Wipro and Infosys are searchable names with official career
links, **not newly implemented direct feed adapters**. Search can surface their
cited public hiring pages. No universal or unlimited all-company coverage is claimed.
No new paid service, credential, database migration or OAuth change is introduced.
Refresh remains request-driven while the page is open, not an unattended crawler.
Existing public search quotas still apply; per-process guards are not a distributed
billing cap. Provider quota errors are displayed explicitly.

## Checks

Focused tests cover aliases without invented coverage, Hindi/public intent validation,
invalid AI outputs, filter/resume URL validation, unknown experience and isolated
provider failure/expiry. Existing discovery, source, freshness, matching and apply
tests run alongside them. Record final build, browser and production observations
after they occur; this document alone is not evidence of deployment.

Rollback target before this change: `8e0233bb5cd6c2e57098c58d3c9e2e728605a3ba`.
Release uses the existing Git-to-Vercel production workflow. If rollback is needed,
restore that established production deployment or revert this focused release and
push through the same workflow; do not alter DNS, OAuth or stored account data.

### Observed local release checks

- Production build and TypeScript passed. Changed-file lint passed.
- Discovery/search: 52 passed, one optional live Greenhouse test skipped.
- UI integrity/dashboard status consistency: 70 passed. The strengthened web-count
  guard's seven-test file was rerun successfully after that final fix.
- Authorized Google sign-in and authenticated refresh succeeded once the local
  server had network access. Anonymous jobs redirected to login; intent and grounded
  search endpoints returned 401 without a session.
- Actual local employer snapshot contained 2,477 India records during inspection.
  Data Analyst returned 24 feed matches after the additional source completed;
  ServiceNow company-only search returned 46 in the selected 30-day source window.
  These are observations at that time, never configured or guaranteed job counts.
- A live ServiceNow Software Engineer description loaded and the existing resume
  matcher showed 33/100 with evidence and gaps. Guided choices and AI interpretation
  of public Deloitte/Data Analyst/India terms reached the correct filter review/URL.
- Company-prefix suggestions retained Infosys while results stayed visible during
  input. Approximately 390-pixel mobile layout had no document horizontal overflow.
- Google-grounded Deloitte leads and citations rendered in the real authenticated
  browser. Separate attempts also returned upstream/unusable-response errors; those
  remain explicit, without fabricating replacement jobs. One response included
  qualified platform counts, prompting the strengthened count guard and regression
  tests. Responses containing those counts are now rejected rather than edited.
- Local Gmail live verification was unavailable because its server-only service key
  is absent locally. No Gmail/auth/provider credentials were added or changed.

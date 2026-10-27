# Career Assistant search reliability — 27 October 2026

## Scope

The Bokaro search failure was reproduced: normalized aliases for Bokaro and
Bokāro inserted the same location twice, falsely making the short city name
ambiguous. Deduplicate aliases by city identity, retaining genuine ambiguity
between different cities. Add the established Bokaro Steel City / बोकारो aliases.

Explicit role, city/state, company, degree, experience, mode and supported date
preferences now use a bounded local parser before the existing AI gateway.
Confirmed earlier preferences survive follow-ups; explicit nationwide requests
replace the location. Clarification choices work without requiring an AI call.
Product/skill roles such as ServiceNow developer or AWS engineer do not become
employer restrictions; an explicit “at ServiceNow” still restricts the employer.
Unclear places, unsupported interpretation and multi-city ambiguity are not
silently relabelled as another location. This is a common-preference parser,
not a claim to understand every possible conversation offline.

## Results and accuracy

Retain existing authorized feeds, original source/application links and freshness
policies. Show regional alternatives separately when fewer than three exact-city
matches exist. Regional means the same state, not a measured distance. Preserve
role/employer/experience/date filters; never call remote jobs local. Provide
explicit state and India widening actions. No new provider or artificial jobs
were added. Existing company/city coverage remains incomplete.

Customer-support searches no longer match unrelated titles just because their
descriptions mention customer support. Read bounded discipline-specific experience
phrases, including “2+ years of customer support experience”, and invalidate
public normalized snapshots so those roles stop appearing as unknown-experience
fresher recommendations. Unknown experience remains labelled unknown.

Show original source-check time on cards. Label previous results when a new
interpretation fails rather than showing an acknowledgement for the wrong query.
Source notes are expandable; an unavailable additional provider is distinct from
failed employer search. Feed refresh does not restart paid/public web search.
Remember provider Retry-After metadata in the current browser module to avoid
automatic retries on subsequent role/location changes; explicit retries remain.
No grounded text, citations or URLs enter a shared response cache/job database.

## Observed verification before deployment

- Targeted search/discovery/UI suite: 130 tests, 129 passed, 1 optional live
  Greenhouse integration skipped, zero failures. Final clarification adjustment:
  21 affected tests rerun and passed (these are a subset, not extra unique tests).
- Changed-file lint, final production build and TypeScript passed, including the
  final clarification adjustment.
- Built application signed-in browser: BBA fresher/Bokaro immediately resolved
  correctly without an intent-model call. Four actual India-eligible remote roles
  were available after filtering; Show more expanded three to four. No exact
  Bokaro listing was returned by these feeds. Do not report that as proof that
  Bokaro has no jobs. Nationwide widening retained BBA/fresher filters.
- Rechecked Weekday Talent Operations Associate at its original provider: full
  requirements explicitly say fresh graduates / 0–1 year, Remote India; original
  application destination and existing resume-fit explanation were present.
- Real Google additional-source requests returned quota HTTP 429. This external
  search is NOT verified successful in this release. The catalog search remained
  functional, and subsequent role changes skipped automatic provider retries.
- Local built-tab captured no browser error logs. Earlier dev-only HMR/router
  errors were observed during source edits, so release QA uses a fresh built tab.
- Anonymous intent/results/web-search requests returned JSON 401; foreign-origin
  results request returned 403. Existing authentication/origin checks remain.
- Local Gmail token access cannot be tested without its service-role credential;
  Gmail/auth/tracker/resume-tailoring/export logic was not modified.

## Deployment and rollback

Use the existing non-force Git main push to Vercel only after final checks.
Production baseline: 312e9ce9b1fc9cc918cf337bb263a6f09c7d83b2.
Preserve codex/search-reliability-rollback-2026-10-27 at that commit.
Production smoke results and deployed commit are reported in the final response.

No billing, auto-reload, premium access, provider keys, schema/RLS, DNS, OAuth,
dependency or job-submission changes. The owner's decision remains free quota
only. Unrelated untracked assets remain untouched.

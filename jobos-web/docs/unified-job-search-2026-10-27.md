# Unified India job search

## Implemented scope

- Role/skill/company combobox: typed prefixes, arrow keys, Enter, Escape,
  mouse selection and manual keywords. Curated role names are search vocabulary,
  not invented vacancies. Actual listed titles, companies and skills extend it.
- One Search jobs action queries additional sources after submission, not on every
  keystroke. Normal employer cards remain usable during background source requests.
- Refresh runs approximately every five minutes while the page is visible and on
  returning to a stale tab. Search/filter state is preserved; source cache schedules
  are respected. This is request-driven refresh, not a scheduled background crawler.
- Existing verified employer adapters are reused. SikaAG and METROMAKRO were enabled
  only after checking actual public India endpoints on October 27, 2026. Each
  returned 55 listings. Sika includes Kolkata, Durgapur, Gandhidham and other cities.
  Sutherland1 returned only an old 2017 listing and was deliberately not enabled.

## Himalayas integration

References: https://himalayas.app/api, https://himalayas.app/docs/remote-jobs-api,
https://himalayas.app/terms (API terms, clauses 113(a)-(f)). The public API explicitly
permits display in the operator's own job board/app, with attribution, original
applicationLink, expiration removal and no onward syndication/JobPosting markup.

- No signup, key, paid plan or billing change. Public server-side requests only.
- `country=IN&exclude_worldwide=true&sort=recent`, with submitted role keywords.
- Local normalization also requires explicit India country eligibility and IST
  timezone eligibility; unknown/foreign/worldwide-only records are excluded.
- A bounded recent/search slice: five pages, up to 100 records, deduplicated by
  source identity, and at most 1.5 MB of normalized data. Coverage is labelled. The
  API's estimated totalCount is never used as a job count or stopping condition.
- Daily cache follows the provider's documented 24-hour refresh schedule. A bounded
  daily source-check window does not weaken the existing employer 20-minute window.
  Each provider request has a 12-second timeout, the walk a 25-second budget, and
  public errors leave employer cards available. Pending requests for the same
  query share work; at most eight distinct uncached queries per process run together.
- Provider `pubDate` means last updated. It is stored as updatedAt, never postedAt
  or releasedAt. Cards distinguish source updates and unavailable original dates.
  Date filters and ordering can use this explicitly labelled activity evidence.
- India-eligible remote roles can appear in recognized Indian city searches, with
  their location still labelled Remote / India eligible, never as city-based jobs.
- Every card and detail shows visible linked Himalayas attribution. Apply keeps
  the provider's exact applicationLink, including its attribution parameters.
- Detail/Apply/Resume Match resolve the source's documented single-job endpoint.
  A SHA-256 ID binds the validated official source path to the request. This stays
  within the existing 150-character tracker ID constraint. No schema/RLS change.
  User-provided URLs never become arbitrary server fetch destinations.
- Real full descriptions feed the existing score/matching and tracker workflow.
  No new scoring model, hiring probability, AI-generated vacancies or resume facts.
- An Indian city explicitly present in a role title is retained as a city restriction;
  it does not become a nationwide remote result. Selected known roles match listing
  identity rather than incidental description words. Explicit technical-skill
  searches still inspect requirements. Role suggestions precede skill suggestions.

## Limits and operating behavior

This does not provide every Indian vacancy, universal LinkedIn/Indeed access, or
guaranteed same-day publication dates. It adds seven connected employers in total
plus a permitted India-remote aggregator. More nationwide on-site coverage still
requires more supported sources or a licensed broad provider. Public rate limits
can change; no free unlimited production quota is promised.

Google-grounded responses remain separate optional search leads. Their results
are not converted into job records, scored, indexed, stored or mixed into the feed.
Only independently permitted employer/API data enters the unified job cards.

## Observed verification before final browser QA

- Real public Himalayas Sales Executive walk returned 100 source records; 57
  matched the then-current keyword/city eligibility filter. These were India-eligible
  remote matches, not 57 on-site Kolkata jobs. A sample detail recheck succeeded and
  preserved applicationLink. The uncached five-page walk took about 10.3 seconds;
  it was moved behind the employer results rather than holding up their display.
- Focused tests cover suggestions, explicit country/timezone evidence, update-date
  provenance, expiry rejection, fixed-host/hash-bound lookups, existing ID length,
  pagination/estimated-count behavior, source errors and distinct freshness windows.
- Do not infer deployment or final visual verification from this document. Record
  the observed final checks and deployment status after they actually complete.

### Final local browser checks observed

The signed-in browser loaded the expanded feed, selected Sales Executive and
Kolkata from their respective comboboxes, and completed the single search action.
A real Avantor Sales Executive listing opened with a prominent 44/100 resume-fit
badge, actual source link and Apply via Himalayas action. Open Resume Match
retained that job's identity and the existing saved-resume selection. Back to job
reopened the same source-checked listing. No new resume was transmitted to an AI
provider and no application was submitted during these checks. Screenshot artifacts
are outside the tracked source tree. A stale daily-snapshot warning and incidental
role/city matches discovered during QA were addressed with focused regression checks.

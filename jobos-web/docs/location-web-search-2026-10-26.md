# India location search and optional public web discovery

## Location data and attribution

`src/lib/jobs/india-locations.json` contains 7,282 Indian settlement records from
[GeoNames cities500](https://download.geonames.org/export/dump/cities500.zip),
with state names from [admin1CodesASCII](https://download.geonames.org/export/dump/admin1CodesASCII.txt),
retrieved October 26, 2026. GeoNames data is licensed under
[Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).
Copyright GeoNames contributors. The selector also displays attribution.

The derived dataset selects India settlements and retains GeoNames ID, city,
state, native-name aliases and population for suggestion ordering. Population
is geographic data, never a job count. All 36 states/UTs are represented; this
is not a guarantee that every locality or spelling is present. Manual location
input remains supported. Common renamed-city and state-code aliases are handled
in `locations.ts`. Suggestions are independent of employer-feed availability.

## Two distinct discovery paths

The connected employer feed keeps its existing source verification, date filters,
matching, saved jobs and tracker workflow. Its current source coverage is still
Razorpay, Bosch, Accor, SGS and Eurofins at that stage. The subsequent
`unified-job-search-2026-10-27.md` documents the expanded source coverage.
A zero-result city filter means no matching
connected listings, not that there are no vacancies in that city.

Search the web is a separate, explicit, signed-in action for any Indian city/state
and role. It uses the existing server-side Gemini key with Google Search grounding.
It sends public keywords, location, country and date only. It never includes a
resume, profile, email history or account identifier. There is no offline model
fallback. Missing grounding, missing required Search Suggestions, unsafe markup,
provider errors and incomplete responses fail visibly rather than invent results.

Public search leads are not independently verified vacancies. Source pages may
be platform search pages rather than direct application destinations. Users must
check dates, availability and application instructions on the original source.
No guaranteed lead count, nationwide complete coverage, or new-posting claim.

## Grounding display and operating constraints

Follow [Gemini API terms](https://ai.google.dev/gemini-api/terms) and
[Google Search grounding documentation](https://ai.google.dev/gemini-api/docs/google-search).
The response text is displayed with its original wording, source links and original
associated Google Search Suggestions. Suggestion markup is validated and rendered
inline in a shadow root to scope its styles. No iframe, scripts or external embedded
resources. Source links navigate directly; no click tracking or link crawling.

Grounded responses/links are not stored in a catalog, database, cache, local storage,
logs, matching index or training dataset. They are ephemeral in the requesting
user's browser and clear when search inputs change. They are not converted to
verified Jobs, scored, saved or used to inflate employer-feed counts.

Existing Gemini project quotas and pricing apply; no billing or provider quota
configuration is changed. The endpoint has per-instance burst guards: two concurrent
requests, 30 seconds between requests per user, 20 requests/user/day and 100 total
requests/day/instance. These in-memory guards are not a distributed billing cap.
Missing configuration or exhausted provider quotas leave the connected feed usable.

## Scope and verification

No schema, RLS, authentication flow, Gmail processing, resume scoring, tailoring or
export behavior is changed. Resume-fit presentation and links to the existing
Resume Match workspace are made more prominent. Regression coverage includes
geographic aliases, state mismatch rejection, provider request data minimization,
grounding/HTML validation and provider failure handling. Visual QA must also cover
the location combobox, Dhanbad web search, fit highlights and narrow viewports.

### Observed verification

- Initial combined regression run: 126 passed, 1 optional integration skipped.
- After tightening search quality and citation handling: all 7 focused tests passed.
- Changed-file lint and production build (including TypeScript) passed.
- Real existing-key Dhanbad search passed the final response contract, with 6
  sources, 6 grounding citations and associated Google Search Suggestions. No
  private candidate data was sent. Responses were not added to the job catalog.
- First-letter D suggestions and Dhanbad selection were observed in the signed-in
  local browser. An initial broad search exposed an expired deadline; this prompted
  stricter requests and deterministic rejection of explicit past deadlines,
  numeric vacancy-count claims and overlong numbered lists. This is not an
  independent verification of every public search lead.
- Final desktop/mobile visual review remains incomplete: the browser-control
  connection repeatedly timed out, including on inventory. Do not claim that the
  final score/citation layouts have passed visual review or that this branch has
  been deployed. Production remains at the prior release until review completes.

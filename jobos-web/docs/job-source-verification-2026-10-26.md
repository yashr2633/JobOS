# India feed source verification — 26 October 2026

The old default registry contained only Palantir (Lever) and Ashby (Ashby).
Neither supplied India results during the signed-in review. It was therefore
impossible for an India location filter to produce useful coverage from that
catalog. This release adds a verified employer to the existing provider engine;
it does not implement universal web search or promise 50 new jobs every day.

## Razorpay / Greenhouse

- Official discovery page: https://razorpay.com/careers/
- Its actual “See all jobs” destination:
  https://job-boards.greenhouse.io/razorpaysoftwareprivatelimited
- Public read endpoint:
  https://boards-api.greenhouse.io/v1/boards/razorpaysoftwareprivatelimited/jobs?content=true
- Existing Greenhouse normalizer successfully returned 26 listings, including
  22 India locations, at `2026-10-26T14:06:31.327Z`. All supplied publication dates.
  The newest publication was `2026-10-26T09:13:37Z`. These are verification-time
  observations, not constants displayed as live counts.
- Coverage includes analyst, finance, engineering, design and business roles;
  some overseas listings also exist and are filtered using candidate location.
- Listing detail and employer application destinations are retained. External
  submissions continue at the employer's site; JobTrackOS does not auto-submit.
- Greenhouse documents public GET access without authentication:
  https://docs.greenhouse.io/job-board.html#authentication
- No credential is needed for these public reads. Application POST would need
  employer authorization and is not implemented. No numerical public GET quota
  was established from the documentation; existing bounded requests, 15-minute
  successful catalog cache and source error handling remain in use.
- A new fetch sets the job's verification timestamp; it never replaces the
  supplied publication date. Older listings still present on the official source
  remain visibly older. Missing dates remain unknown. A failed preview is labelled
  unavailable, not a verified zero-job result.

## Boundaries

The existing Palantir/Lever and Ashby sources remain supported. The registry's
verified membership is not evidence that every role is suitable for India.
Groww's official page currently points to a regional Greenhouse host; it was not
added to the US-host-only adapter without regional API verification. Postman has
moved its current careers flow toward Workday and was not treated as a verified
Greenhouse board. No board IDs were guessed, restricted platforms scraped, or
credentials/OAuth/deployment configuration changed for this feed addition.

Broader India coverage, authorized public-web search, hiring leads, configurable
source-level sync health and advanced recommendations still require their own
validated implementation phase.

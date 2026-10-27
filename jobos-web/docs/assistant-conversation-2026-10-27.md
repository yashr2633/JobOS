# Career Assistant conversation release — 27 October 2026

## Approved behavior

The approved screen now replaces the separate guided form and redirect-only
assistant with one conversation. Broad requests such as `I'm a BBA fresher.
Find jobs in Kolkata.` search immediately; role suggestions refine the request
without blocking it. Unclear words such as `BBF Racer` still need clarification.
Earlier public preferences accompany model follow-ups. New search clears them.

The authenticated, same-origin, bounded assistant-results route uses existing
public employer/India-remote adapters and freshness policies. It returns nine
real records per page; the interface initially shows three, then expands six
at a time. Source failures are isolated, deduplicated records are filtered by
location/role/experience/date, and city results precede India-eligible remote
roles. Remote jobs and unstated experience remain explicitly labelled. Business
graduate searches do not silently include technical engineer/technician roles.
All filters preserves the qualification and the existing owner-checked resume.

Job details are rechecked through the existing fixed-source detail route before
showing the current full JD and original application link. Existing Resume Match,
tailoring/export and application-confirmation destinations are reused. Upload and
saved-resume selection reuse the existing library. Fit percentages compare the
existing evidence model with job requirements; they are not hiring probabilities.
No external search request includes resume text, account IDs or application data.

Google-grounded public hiring leads also run in the conversation, independently
of the catalog, with original text, citations, links and Search Suggestions.
They are not imported into a job database or falsely attributed to an HR account.
Provider rules: https://ai.google.dev/gemini-api/terms#grounding-with-google-search
The existing daily app allowances remain 20 per user / 100 per process. A bounded
four-turn minute window replaces the compulsory 30-second wait after every turn.
Requests and authentication have deadlines and readable JSON errors.

## Actual external limit observed

Two real BBA/Kolkata searches returned source-linked leads beyond connected feeds.
A later request returned Google HTTP 429 RESOURCE_EXHAUSTED. A diagnostic request
confirmed the configured gemini-2.5-flash free-tier request quota of 20 and a retry
delay of about 16 hours. No credentials or provider error body were exposed. The
documented Flash-Lite fallback returned HTTP 404 in this account and was not
enabled. Quota delays are bounded, passed as Retry-After and shown clearly; a
per-process cooldown prevents repeated calls during the provider's delay.
No billing setting, provider account, key or paid plan was changed.

The visible conversation automatically refreshes its public feed results every
five minutes; it does not automatically repeat paid web searches. Unattended
background synchronization is NOT configured: the existing Vercel CLI identity
returned forbidden for the production team. Git-to-Vercel deployment remains
available and does not require changing project settings. No dead cron job or
unconfigured scheduler has been deployed.

## Coverage and preservation

Existing fifteen employer feeds and Himalayas remain the connected catalog.
Deloitte's visible USI careers portal showed 683 jobs during the source review;
those 683 records have NOT been imported. Company search vocabulary is not import
coverage. No full commercial republication feed/access has been confirmed for
that portal. Its linked terms restrict content reuse to informational,
noncommercial purposes: https://www.deloitte.com/us/en/legal/terms-of-use.html
Universal company coverage and unattended ingestion remain incomplete.

Authentication/OAuth, Gmail tracking, existing applications, employer permissions,
resume scoring/tailoring/export logic, schema/RLS and deployment architecture are
unchanged. No unrelated untracked assets enter the release.

## Observed checks

- Targeted discovery, conversation, UI integrity, resume export/security tests:
  165 total, 164 passed, zero failed, one optional live Greenhouse test skipped.
- Changed-file lint and final production build/typecheck passed before
  publishing and production completion is reported after the actual deployment.
- Signed-in local app: broad BBA/Kolkata search, optional suggestions, same-page
  Show more, real Accor Kolkata full JD/source link and existing-resume fit/gaps.
- Natural-language `Only operations roles` retained Kolkata, fresher and BBA.
  Existing provider fallback handled intent interpretation; subsequent public
  source search hit the genuine quota above and displayed a readable failure.
- Local Gmail testing is unavailable without its server-only service key; no new
  Gmail live PASS is claimed by this release.

Rollback code: `0eed0726965764f0d20f57718afe70045c50ae9a`. Preserve its deployment
and the release rollback branch before pushing to the existing production main.

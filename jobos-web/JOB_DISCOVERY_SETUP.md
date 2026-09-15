# Personalized Job Discovery V1

NO NEW PAID SERVICE REQUIRED.
NO NEW GOOGLE OAUTH SCOPE REQUIRED.

## Activate

1. Apply `supabase-schema-job-discovery.sql` in the Supabase SQL Editor against the same project as this app. It depends on the existing application/resume schemas, including Sprint 5, Sprint 10 status history and Sprint 12 application source. Do not rerun older migrations unnecessarily. This change has not been applied to the live database by the coding agent.
2. Deploy this app normally. Existing Supabase configuration is sufficient for discovery. No service-role key is used.
3. Open **Discover Jobs**, set preferences or choose an existing resume and review its evidence. Save the profile to rank the feed.

Optional server environment variable:

```dotenv
# Public Greenhouse board tokens, comma-separated, maximum five. Default: canonical.
JOB_DISCOVERY_GREENHOUSE_BOARDS=canonical
```

No feed key is required. Only configure genuine employer board tokens you have verified. Greenhouse documents public job-board GET requests as unauthenticated: https://docs.greenhouse.io/job-board.html. This is public employer ATS data, not scraped LinkedIn/Indeed content. Canonical's public board is the working initial source. This is deliberately limited employer coverage, not a market-wide jobs index.

## Data and behavior

- `career_profiles`: owner-only career preferences and a reference to an existing resume. Existing parsed resume evidence/text is reused; browsing does not call AI.
- `discovery_job_states`: owner-only saved/hidden/pending state and a normalized public-job snapshot. Public listings are cached per server process for up to 15 minutes, with concurrent fetches shared. A failing board is omitted with a warning; no indefinite stale fallback.
- Existing `applications`: adds discovery identity, original application URL and source metadata. **Apply on employer site** checks the current employer listing and saves pending context. The subsequent external link opens the employer form; it does not submit anything.
- **Yes, I applied** invokes an atomic, owner-scoped database function. A row lock and unique discovery identity make confirmation idempotent across retries/tabs. Only this confirmation creates an Applied record and status-history entry in the existing tracker.
- **Check Resume Match** opens the existing analysis component, reuses an existing resume or upload pipeline, and retrieves the employer's current JD. Analysis runs only on the user's click and uses the existing AI providers and daily allowance. Pre-apply results use nullable `match_results.application_id` plus `discovery_job_id`; no fake application is created.
- Existing dashboard, tracking and Gmail reset continue to use their current application records. Discovery origin is distinct from Gmail origin. Gmail code, scopes and tokens are unchanged.

## Ranking and source limitations

Fit is deterministic alignment, not a hiring probability: role (35), recognized skill mentions (35), explicit experience (15), location (8), work mode (7), optional keywords (5), and selected-resume evidence (10). Available components are normalized to 100. Components, matched skills, un-evidenced mentions and data gaps are shown. Sparse evidence is labelled. Unknown salary periods/currencies are not compared, and unknown dates are not invented from update timestamps.

The initial skill vocabulary and title matching are conservative heuristics. Mentions can be optional skills; location matching does not establish visa eligibility. Remote listings may be region-limited. Salary, dates, employment type and minimum experience are frequently absent. Missing fields remain explicit. Published listings with an expired provided deadline are excluded; listings still published without a deadline cannot be guaranteed actively hiring. Apply and Resume Match recheck the source. Saved jobs remain labelled snapshots when absent from the current feed.

V1 uses a small, per-process catalog, renders 30 results at a time, and loads up to the latest 1,000 personal job states. It has no scheduler, application automation, new job marketplace, notifications or background AI. Opening a job requires a second, explicit link after context is saved to avoid blocked async popups. Pre-apply analysis results are persisted, but this screen does not yet restore previous runs or tailor/export before application confirmation. Tailoring remains available in the existing application workflow. Repeated explicit analysis reparses the discovery JD using the existing daily allowance; feed browsing never does.

## Costs

Public feed: no new key or paid provider. Profiles/state use existing Supabase and hosting quotas. Explicit Resume Match runs use existing AI keys and may consume their existing quota/billing. No new Google permission, OAuth client or CASA-related change is introduced.

## Focused validation

Automated: `npm run test:jobs`, existing application/AI/UI regression suites, TypeScript and production build. The optional live source check is `JOB_DISCOVERY_LIVE_TEST=1 node --test src/lib/jobs/discovery.test.ts` (set the environment variable using your shell's syntax).

After migration, manually verify with two test accounts:

1. Save/edit a career profile, choose a saved resume, reload, and verify feed ranking and filters. Check desktop and narrow mobile layouts.
2. Save/hide/restore a job, reload, and verify persistence. The other account must not see those preferences or job states, including direct table requests under that account.
3. Open a job, start Apply, follow its employer link and return. Verify the Applications count is unchanged before confirmation. Choose Not yet and verify no application is created.
4. Confirm Yes, I applied with the real date; verify one existing tracker row with original URL, source and Applied status. Repeat confirmation in another tab; verify no duplicate or extra history event.
5. Run Check Resume Match with an existing resume. Verify normal analysis/errors/quota behavior, and that pre-apply matching does not change application counts. Verify ordinary Resume Match still works.
6. Test provider outage/closed-job responses, a profile with no matches, and unknown salary/location/date fields. Confirm clear errors and no fabricated listings.

Live database execution, RLS isolation and authenticated browser flows must be checked after migration; source-level tests are not a substitute for those checks.

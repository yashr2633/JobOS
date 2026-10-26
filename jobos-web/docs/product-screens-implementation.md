# JobTrackOS product screen implementation

This implementation uses the approved 18-screen blue/white design direction in
the existing Next.js application. Screen numbers describe user states, not 18
disconnected routes. Existing authentication, application records, Gmail scan
logic, AI matching, tailoring and document generation remain the working engines.

## Screen map

| Approved screen | Application implementation |
| --- | --- |
| 1. Public homepage | Anonymous `/`, `components/PublicLanding.tsx` |
| 2. Candidate authentication | `/login` and `/signup`, existing Supabase password, OTP and Google handlers |
| 3. Dashboard | Authenticated `/`, existing report and Gmail module; `RecommendedJobs` adds real-data recommendations |
| 4. Find jobs | `/jobs`, restored existing `JobsWorkspace`, supported source catalog and saved state |
| 5. Applications | `/applications`, existing tracker, forms and status history |
| 6. Resume Match | `/resumes`, existing selection/upload/JD flow with a visible three-step overview |
| 7. Match results | Existing `IntelligencePanel` inside Resume Match |
| 8. Tailor workspace | Existing `TailorResumePanel`, inside Resume Match |
| 9. Resume preview/export | Existing reviewed draft, preview and PDF/DOCX/TXT export controls inside tailoring |
| 10. Candidate profile | `/profile`, existing personal profile form plus saved career preferences and resume/integration links |
| 11. Job detail | Existing external-job detail dialog in Find jobs; `/jobs/internal/[id]` for employer-posted jobs |
| 12. Application confirmation | Existing external-application confirmation and `/jobs/applied/[id]` for internal submissions |
| 13. Gmail review | `/gmail/review`, actual linked applications, source email links and unresolved-employer component |
| 14. Employer login | `/employer/login`, same auth provider with employer destination preserved |
| 15. Employer dashboard | `/employer`, real company/jobs/applicant queries and empty/error states |
| 16. Job editor | `/employer/jobs/new` and `/employer/jobs/[id]/edit` |
| 17. Applicant list | `/employer/applicants`, scoped to owned company jobs with search/stage/job filters |
| 18. Applicant detail | `/employer/applicants/[id]`, submitted resume text, contact, stage, timestamps and private notes |

## Design and behaviour

- Shared blue/white semantic tokens, original SVG case/tracking brand mark,
  consistent form controls and cards; explicit dark mode remains available in
  Settings. New visitors default to light.
- Desktop candidate navigation is at the top; the existing mobile bottom bar
  uses the same destination list. Tailoring is never a separate main-nav item.
- Public homepage job examples are queried from supported sources, not seeded
  mockup companies/counts. That section streams independently of the hero.
- Existing Gmail automatic updates remain automatic. The new review page does
  not introduce the mockup's artificial approval queue or fake scan statistics.
- Existing match scores and exports use the original implementations. The
  visual workflow does not gate tailoring on completing an analysis.
- Job discovery coverage is still the existing bounded provider registry.
  Restoring the UI is not a claim of market-wide coverage or 50 fresh jobs daily.

## Employer database prerequisite

`supabase-schema-employer-workspace.sql` is an additive migration. Following the
user's explicit approval, it was applied to the existing JobOS Supabase production
project (`cgcvvhumhorqgybwemot`) on 2026-10-26 at approximately 18:45 IST. The SQL
editor returned success for the complete BEGIN/COMMIT transaction. The applied
file SHA-256 is `5c91c557900ee255f8379cd6d22ead44c7ca8620d9fd1e52baf9b93fdeb189a9`.
It was first tested in isolated PostgreSQL and checked against the live existing
tracker/resume column definitions and constraints before execution.

It creates company, job, submission and private-note tables. Company ownership
is checked by server actions and RLS. Candidates can read only their own
submissions; employers can read submissions only to their company's jobs.
Employer access never grants SELECT on candidate resume storage. With explicit
consent, the submission transaction copies the selected candidate-owned resume's
text snapshot, name and account email. It atomically creates one existing tracker
record; per-candidate/job locking prevents retry/tab duplicates. Stage updates
can update only that linked candidate tracker record. Private notes are stored
separately with owner-only policies, not on candidate-readable submissions.

The first version supports one owner per company. It does not claim team invites,
company identity verification, original-file resume downloads, automated messaging
or calendar scheduling. Candidate contact opens the email client. No match score
is fabricated on employer pages.

Local PostgreSQL checks completed before applying the migration:

1. Apply the migration as a transaction to an isolated test database.
2. Two employer accounts must not read/update each other's jobs, applicants or
   notes. Two candidates must not read each other's submissions or resumes.
3. Draft, paused, closed and expired listings must refuse application submission.
4. Consent and a candidate-owned readable resume must be required.
5. Retry and concurrent-tab submission must create only one submission/tracker.
6. Stage changes must affect only the linked tracker and record history.

## Verification evidence and limits

- Production compilation, Next.js TypeScript check and route generation passed.
- Focused UI, employer input/policy guards, OAuth, Gmail security, SEO and resume
  export/flow regression tests: 142 passed.
- Wider focused run: 175 passed, one skipped live integration and one existing
  discovery cache test failed (`4 !== 2` provider request count). The provider
  registry/engine and that test were not modified in this implementation.
- Changed-file lint introduced no new errors. Two existing theme-effect lint
  errors reproduce on baseline `2ad52c1` via ESLint stdin; unrelated historical
  cleanup was not performed. Other changed files pass lint (some existing unused
  imports in the Gmail module remain warnings).
- Browser loaded the actual anonymous homepage and candidate/employer login.
  An employer-login heading inherited hero typography during visual review; the
  selector was narrowed to the actual hero heading.
- The existing Supabase project was paused, causing its hostname not to resolve.
  The public production login bundle references that same project. After the
  user opened the owner account, the paused state was confirmed and the project
  resumed under the user's permission. DNS resolved again and the Auth health
  endpoint returned HTTP 200. No credentials or OAuth configuration were changed.
- Google sign-in completed with the account explicitly selected by the user.
  The authenticated dashboard, saved applications, profile/career preferences,
  Resume Match selection and Gmail review opened successfully. Refresh restored
  the session. Further real integration evidence is recorded below.
- Local server logs report that `SUPABASE_SERVICE_ROLE_KEY` is not configured.
  Server-side Gmail token access therefore cannot be verified in this local
  environment. No secret was retrieved, printed or replaced for this UI update.
- All 21 local HTTP smoke checks passed: 14 private route redirects, six public
  pages and anonymous job-action rejection. The script is
  `scripts/smoke-product-screens.mjs`. It also checks search intent survives login.
- Slow multi-page ATS requests initially prevented the public streamed response
  from finishing promptly. `publicCatalogPreview` now bounds the homepage's wait
  to five seconds; the existing provider engine remains unchanged.
- The actual migration executed in an isolated in-memory PostgreSQL database
  using PGlite. All 13 migration/isolation checks passed, including cross-user
  access, consent, closed jobs, duplicate retries, linked tracker updates and
  private notes. Run `scripts/verify-employer-rls.mjs` with its separate temporary
  PGlite dependency installed under `../tmp/employer-db-check`; app dependencies
  were not changed. After explicit user approval the migration was applied to
  production. Seven live SQL checks passed: all four tables have RLS, ten access
  policies exist, anonymous access is blocked, direct applicant writes are
  blocked, mutation function execution is restricted, the existing application
  and resume counts match their pre-migration values, and the new tables contain
  no fabricated employer/job/applicant records. Employer overview/company form,
  job-list empty state and applicant filters now load against the live database.
  A real employer/candidate browser submission was not performed; no fictional
  company or public vacancy was created for testing.
- The initial India feed had no results because only two global boards were
  configured. A Razorpay board discovered from the official careers page was
  verified through the existing API adapter and added. See
  `job-source-verification-2026-10-26.md`; broader source coverage remains a
  separate phase and no listings or counts are fabricated.
- No DNS, credential or OAuth configuration change was performed. The explicitly
  approved employer schema migration is the only production schema change.

## Local preview and rollback

The app can be reviewed with `npm run dev`, or `npm run build` followed by
`npm run start`. The local production preview uses `http://localhost:3000`, bound
to this computer only, so a LAN firewall exception is not needed. This port is
already permitted by the existing OAuth redirect configuration.

The release branch is `codex/product-screens-2026-10-26`. Baseline `2ad52c1` is
preserved as `codex/product-screens-rollback-2026-10-26`; unrelated untracked
design/media/output assets remain untouched. Deployment uses the existing
non-force push to `main` and Vercel Git integration. Restore the prior successful
Vercel deployment, or normally revert the release commit on `main` if necessary.
An application rollback does not require dropping the additive employer tables.
Preserve those tables and future submissions; never delete user data as rollback.

## Final integration pass

- The live production database ran `scripts/verify-employer-live-rollback.sql`
  successfully with authenticated roles: consent, real submission function,
  duplicate retry, linked tracker/history, employer stage update and private
  resume/note isolation. Every synthetic row was inside a transaction that ended
  in ROLLBACK. No test company, vacancy or application remained committed.
- An actual Gmail scan read 339 messages. Source-email comparison revealed a
  closed/filled requisition misclassified Applied and a public coding-contest
  promotion classified Interview. Narrow evidence fixes cover both; automatic
  rescans may advance a corrected automatic status while preserving manual
  choices and terminal outcomes. Confirmed exclusions are stored as visibility
  metadata, preserving the original local records without deleting them.
- Gmail Review now uses the same server/browser merged application hook as the
  main tracker. It no longer hides browser-only scan results behind a server-only
  query. Ambiguous messages remain reviewable with unknown status.
- A corrected real scan updated the closure to Rejected and excluded the contest.
  It reported four failed requests honestly as partial, not successful zero data.
- A repeat scan completed all 339 messages, added no duplicates, and retained
  unresolved evidence. A second source review caught a public quiz and a clipped
  employer status-update email; tests cover both, and status notices now fetch
  their body before treating introductory confirmation wording as final status.
- The final source comparison showed one Applied and two Rejected records; public
  contest/quiz messages were no longer active applications. That corrected run
  read 336 messages with three failed requests and was labelled partial. No exact
  production timing or universal Gmail accuracy claim is made from these samples.
- Existing Resume Match completed a real analysis. After explicit permission for
  the selected saved resume and configured provider destinations, tailoring also
  returned a source-validated draft. PDF, DOCX and TXT downloads parsed correctly
  with all sections present. Both PDF pages were rendered and inspected with no
  clipping. Uploading that same reviewed PDF succeeded and showed ready for
  analysis; this added one real derived resume to the test account.
- The first tailoring attempt exposed an existing response-body timeout gap.
  `fetchWithTimeout` now consumes the body before releasing its abort deadline;
  stalled-body, normal-body and bodyless-response regression tests pass. Source
  fact validation remains enforced. A synthetic live provider check also passed.
- Match labels and interpretation instructions distinguish absent resume evidence
  from absent skills and explicitly reject interpreting scores as hiring odds.
- The India feed rendered five relevant recommendations for the saved profile,
  including today's Associate Business Analyst role. Fit extraction now prefers
  explicit role sections over company introductions, so an investor's name in
  company boilerplate does not become a required skill gap. The complete original
  description remains visible. Focused regression cases cover this distinction.
- Full Gmail regression suite: 446 passed. Focused UI/resume/security/SEO suite:
  208 passed; affected AI suite: 77 passed (these suites overlap). Final production
  build and 21 anonymous route/API checks passed. The known unrelated discovery
  cache request-count failure remains `4 !== 2` and reproduces without this source
  registry addition; it is not reported as fixed.

Post-deployment URL, commit, Vercel result and production smoke evidence will be
recorded separately after the existing Git deployment completes.

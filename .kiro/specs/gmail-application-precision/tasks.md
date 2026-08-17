# Implementation Plan: Gmail Application Precision

## Overview

Implementation follows the Incremental Rollout order in the design: the Evidence Gate lands pure and unwired, then replaces the keyword/bare-ATS escalation in `heuristics.ts` (which alone delivers the precision fix), then the scan window, the additive Sprint 9 migration and evidence persistence, the Auto_Importer, the Unknown bucket and results-first workspace, real dashboard metrics, the connected mailbox address, and finally reconciliation.

Language and stack: TypeScript on Next.js 16 with Supabase, matching the existing `jobos-web` conventions. All new library tests use `node --test` with `node:assert/strict` and import modules under test by relative path with an explicit `.ts` extension, exactly as `pipeline.test.ts` and `tracking.test.ts` already do. Property-based tests use `fast-check` pinned to an exact version, with `numRuns: 100` and a tag comment naming the property from the design document.

Every task is bounded by the frozen baseline recorded in the design: no change to OAuth, RLS, the AI gateway, Resume Match, the `applications.status` CHECK constraint, or the `UNIQUE(user_id, gmail_message_id)` constraint on the ledger.

## Tasks

- [x] 1. Evidence Gate — the deterministic lifecycle-evidence classifier
  - [x] 1.1 Set up the property-based testing harness
    - Add `fast-check` as a devDependency pinned to an exact version in `jobos-web/package.json`
    - Verify `fast-check` resolves from a `.ts` test file run under `node --test` with the project's current type-stripping setup; if it does not, fall back to a sibling importable entry rather than hand-writing a PBT engine
    - Leave `tsconfig.json` and `eslint.config.mjs` strictness unchanged
    - _Requirements: 15.1, 15.2, 13.3_

  - [x] 1.2 Create `src/lib/gmail/applicationEvidence.ts` with the verdict types and the hard-exclusion tier
    - Define `EvidenceStrength`, `EvidenceReason`, `EvidenceVerdict`, `LIFECYCLE_CATEGORIES`, `isLifecycleCategory`
    - Implement step 1 (Gmail label exclusion for `CATEGORY_PROMOTIONS` / `SPAM` / `TRASH`) and step 2 (hard-exclusion patterns for job alerts and digests, social-network notifications, financial applications, marketing/course/webinar/salary-report mail, and "posted a job" / "is hiring" announcements)
    - Evaluate exclusions against subject + snippet only, never against body footers; pattern-based social exclusion so LinkedIn/Naukri relayed lifecycle mail is not caught by sender
    - Return `none` / `NOT_JOB_RELATED` / `isLifecycleEvent: false` with the reason code naming the matched class
    - No `any`, no `@ts-ignore`, no suppression assertions; pure module with no network, AI, or database access
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 13.1, 13.2_

  - [x] 1.3 Implement the strong lifecycle tier
    - Ordered furthest-along-first detection: `OFFER` → `REJECTION` → `INTERVIEW_INVITATION` → `INTERVIEW_UPDATE` → `APPLICATION_CONFIRMATION` / `APPLICATION_RECEIVED` → `APPLICATION_UPDATE` → `WITHDRAWAL`
    - Confidence 0.95 for a subject hit, 0.8 for a body-only hit
    - Add the `your application was sent to` confirmation pattern; classify online assessment / coding challenge / take-home invitations tied to an application as `INTERVIEW_INVITATION`
    - Return `strong` with a Lifecycle_Category and `isLifecycleEvent: true`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [x] 1.4 Implement the medium/weak tier and the terminal fallthrough
    - Step 4: (ATS/portal sender **or** deterministically extracted application URL) **and** candidate-facing possessive language → `weak` with a null category
    - Step 5: application URL alone → `weak`
    - Step 6: otherwise `none`, with `keyword_only` when a bare listed keyword was the sole match, else `no_application_evidence`
    - An ATS/portal sender with no candidate-facing language must resolve to `none`
    - _Requirements: 1.9, 3.1, 3.2_

  - [x]* 1.5 Write property test for hard exclusions in `src/lib/gmail/applicationEvidence.test.ts`
    - **Property 1: Every hard-exclusion class yields the rejection verdict**
    - **Validates: Requirements 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8**

  - [x]* 1.6 Write property test for exclusion precedence
    - **Property 2: Exclusions are evaluated before lifecycle patterns**
    - **Validates: Requirements 1.1**

  - [x]* 1.7 Write property test for insufficient signals
    - **Property 3: An insufficient signal never escalates**
    - **Validates: Requirements 1.9, 3.2**

  - [x]* 1.8 Write property test for lifecycle classification and status mapping
    - **Property 4: Lifecycle evidence classifies deterministically and maps to a status**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.7, 6.6**

  - [x]* 1.9 Write property test for competing lifecycle evidence
    - **Property 5: Competing lifecycle evidence resolves to the furthest-along stage**
    - **Validates: Requirements 2.6**

  - [x]* 1.10 Write unit examples for the named exclusion and confirmation cases
    - A job alert, a social notification, and a finance-application email each return strength `none`
    - An application confirmation returns strength `strong` with a Lifecycle_Category
    - Cover the documented awkward phrasings that motivated each lifecycle pattern
    - _Requirements: 15.5, 15.6_

- [x] 2. Replace the escalation rules in the heuristic layer
  - [x] 2.1 Rewrite `evaluateEmail` in `src/lib/gmail/heuristics.ts` as a gate adapter
    - Keep the exact signature and `HeuristicVerdict` shape, including every legacy `reason` string
    - Implement the documented mapping table for `none` / `strong` / `weak` verdicts
    - Delete the `weakSignal` keyword regex and the bare `fromAts` escalation
    - Re-implement `looksLikeBulkMail` and `detectCategory` as delegations to the gate's exclusion and lifecycle stages so each pattern set exists once; leave `isAtsDomain`, `companyFromDomain`, `portalNameFromDomain`, `isPortalDisplayName`, `sanitizeCompanyName`, `PORTAL_DISPLAY_NAME_SET`, `EMAIL_CATEGORIES` exported with unchanged behaviour
    - _Requirements: 3.3, 3.4, 3.5, 3.6_

  - [x] 2.2 Resolve the two known conflicts in `src/lib/gmail/pipeline.test.ts`
    - Conflict 1: rename the 180-day test title to name the `6m` range, keep its assertion body verbatim, and add a test asserting the new 30-day default
    - Conflict 2: change the ambiguous-ATS fixture subject to `"Regarding your application"` keeping all three assertions verbatim, and add a test pinning that the original `"An update from Acme"` fixture now yields `candidate === false` and `needsAI === false`
    - Keep conflict 3 (job-url-alone escalates) unchanged
    - Add assertions that a bare ATS sender no longer escalates and that a promotions label beats a lifecycle phrase
    - Delete no existing assertion
    - _Requirements: 15.4, 3.2, 1.8_

  - [ ]* 2.3 Write property test for the heuristic mapping in `src/lib/gmail/evidenceGate.integration.test.ts`
    - **Property 6: The heuristic verdict is a pure function of the gate verdict**
    - **Validates: Requirements 3.3, 3.4, 3.5, 3.6**
    - Include the structural assertion that the keyword regex and bare-ATS escalation are gone

  - [x] 2.4 Extract the two pure seams from `src/lib/gmail/sync.ts`
    - `classifyParsedEmails(emails, connectionId)` → `{ records, ambiguous }` from step 4
    - `resolveNextCursor({ pageFullyProcessed, nextPageToken, storedPageToken })` from step 6
    - Behaviour-preserving refactor only: listing, dedup, concurrency bounds, time budget, and cursor semantics stay exactly as they are
    - _Requirements: 3.7, 4.1, 4.2, 4.4_

  - [ ]* 2.5 Write property test for the classification partition
    - **Property 7: Every scanned message is accounted for exactly once, and only ambiguity reaches the model**
    - **Validates: Requirements 3.7, 4.1**

  - [ ]* 2.6 Write property test for cursor safety in `src/lib/gmail/incremental.test.ts`
    - **Property 8: The page cursor never advances past unprocessed messages**
    - **Validates: Requirements 4.4**

- [x] 3. Checkpoint - the precision fix is live
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Scan window: 30-day default and a selectable set
  - [x] 4.1 Update `src/lib/gmail/query.ts`
    - Add `SCAN_WINDOWS`, `ScanWindow`, `isScanWindow`, `DEFAULT_SCAN_WINDOW = "30d"`, `DEFAULT_WINDOW_DAYS = 30`, and the `60d` entry
    - Keep `6m` and `1y` resolvable in `HISTORY_RANGES` for backward compatibility
    - Add `-category:promotions` to the query; keep `-in:spam`, `-in:trash`, `-in:chats` and the sender/subject signal group unchanged
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [ ]* 4.2 Write property test for query construction in `src/lib/gmail/scanWindow.test.ts`
    - **Property 17: The scan query is well-formed for every accepted window and rejects the rest**
    - **Validates: Requirements 9.2, 9.4, 9.5, 9.6**

  - [x] 4.3 Validate the window and choose the sync mode in `src/app/api/gmail/sync/route.ts`
    - Accept `{ window?: ScanWindow }` with the legacy `range` still honoured; any value outside the accepted set falls back to `30d` before a job is created
    - Choose `full` vs `incremental` using `getCompletedFullScanWindowStart` coverage: a narrower or equal window with a valid anchor stays incremental, a wider one runs a bounded full scan
    - Return `window` and `syncMode` alongside existing progress fields; keep the `reconnectRequired` / `fullSyncRequired` / `retryable` error taxonomy unchanged
    - _Requirements: 9.6, 4.5, 4.6_

  - [ ]* 4.4 Write unit tests for the concrete window examples
    - The default window is 30 days; the `all` window omits the lower bound
    - _Requirements: 9.1, 9.3_

  - [x] 4.5 Add the window selector to the `/track-my-jobs` client component
    - Options `Last 7 days`, `Last 30 days (recommended)`, `Last 60 days`, `Last 90+ days`, `All mail`, defaulting to `30d`
    - Send the selected value with every batch request of that scan; leave the batch loop, sequential-batch invariant, and `router.refresh()` behaviour unchanged
    - _Requirements: 9.7_

- [x] 5. Sprint 9 migration and evidence persistence
  - [x] 5.1 Write `jobos-web/supabase-schema-sprint9-gmail-precision.sql`
    - Additive and re-runnable: `gmail_connections.gmail_address`, `gmail_activity.evidence_strength` / `evidence_reason` with a guarded CHECK, `gmail_sync_jobs.applications_updated` default 0, and the partial index serving the Unknown-bucket derivation
    - No `ALTER TABLE public.applications`, no `DROP CONSTRAINT`, no altered existing column
    - _Requirements: 13.4, 13.5, 13.6, 13.7_

  - [x] 5.2 Extend `src/lib/api/gmailActivity.ts` types and reads
    - Add `evidenceStrength` / `evidenceReason` to `GmailActivityRecord` and `evidence_strength` / `evidence_reason` to `GmailActivityRow`
    - Add `fetchLifecycleActivityForAutoImport`, `countEvidenceByReason`, and `getCompletedFullScanWindowStart`, every read carrying `.eq("user_id", userId)`
    - No column whose name contains a body or snippet
    - _Requirements: 4.2, 4.7, 14.4, 14.5_

  - [x] 5.3 Persist evidence and re-gate AI output in `src/lib/gmail/sync.ts`
    - Write `evidence_strength` / `evidence_reason` on every ledger row, including gate rejections, so a re-scan stays free
    - Re-gate model output: accept only vocabulary categories, store any model-derived lifecycle category with `evidence_strength = "weak"`, keep `sanitizeCompanyName` and the deterministic `jobUrl` precedence
    - Add `applicationsCreated`, `applicationsUpdated`, and `evidenceReasonCounts` to `BatchResult`
    - Still no Gmail message id and no body text sent to the AI provider, and no body text persisted
    - _Requirements: 3.7, 4.1, 4.3, 4.7, 14.2, 14.3, 14.4, 14.6, 14.7_

  - [ ]* 5.4 Write integration tests for persistence and the AI re-gate
    - Ledger dedup happens before metadata fetch and before any AI call; a model lifecycle verdict is stored as `weak`; rejected mail is ledgered as `NOT_JOB_RELATED`
    - _Requirements: 4.1, 4.2, 4.3_

- [x] 6. Checkpoint - schema and pipeline persistence
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Proposal grouping and status mapping
  - [x] 7.1 Carry evidence strength through `src/lib/gmail/proposals.ts`
    - Add `evidenceStrength`, `hasStrongEvidence`, `isLifecycleEvent` to `ApplicationProposal`; treat a null stored strength as not strong
    - Grouping, `NOT_JOB_RELATED` exclusion, earliest/latest date bounds, null-rather-than-portal employer resolution, separate `jobPortal`, and the read-time `sanitizeCompanyName` repair all stay as they are
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [ ]* 7.2 Write property test for proposal grouping in `src/lib/gmail/proposals.test.ts`
    - **Property 13: Evidence for one role groups into one proposal, independent of input order**
    - **Validates: Requirements 7.1, 7.2, 7.5**
    - Include the example of several lifecycle emails for one role grouping into one proposal (Requirement 15.8)

  - [ ]* 7.3 Write property test for proposal date bounds
    - **Property 14: Proposal date bounds are the extremes of their evidence**
    - **Validates: Requirements 7.3, 7.4**

  - [ ]* 7.4 Write property test for portal/employer separation in `src/lib/gmail/company-portal.test.ts`
    - **Property 15: A portal is never stored or accepted as an employer**
    - **Validates: Requirements 7.6, 7.7, 8.5**
    - Include the assertion that no portal name is ever stored as an employer name (Requirement 15.10)

  - [x] 7.5 Resolve assessment invitations to `Interview` in `src/lib/gmail/statusInference.ts`
    - No new category and no new status; the `applications.status` and `gmail_activity.category` CHECK constraints stay frozen
    - _Requirements: 6.5, 6.6, 13.4_

  - [ ]* 7.6 Write property test for the status vocabulary in `src/lib/gmail/tracking.test.ts`
    - **Property 12: Only the five allowed statuses are ever produced**
    - **Validates: Requirements 6.5**

- [x] 8. Auto_Importer — automatic organization
  - [x] 8.1 Implement the pure decision table in `src/lib/gmail/autoImport.ts`
    - `decideProposal` returning exactly one of `create`, `link`, `hold_ambiguous`, `hold_unknown_employer` with a non-content reason code
    - Order: `thread` / `job_url` / `company_title` tier → link; `company_only` → hold; employer known and a strong lifecycle row → create; null employer → hold for the bucket; otherwise hold
    - _Requirements: 5.2, 5.3, 5.4, 5.5_

  - [ ]* 8.2 Write property test for the decision table in `src/lib/gmail/autoImport.test.ts`
    - **Property 9: The auto-import decision table is total, exclusive, and refuses weak evidence**
    - **Validates: Requirements 5.2, 5.3, 5.4, 5.5**

  - [x] 8.3 Implement `runAutoImport`
    - Build proposals from the user's unlinked lifecycle activity, apply each decision in its own `try/catch`, link activity in the same logical step as creation, and count `created` / `updated` / `linked` / `heldAmbiguous` / `heldUnknownEmployer` / `failed`
    - Resolve status from all of a linked application's evidence and gate the write through `shouldUpdateStatus`; write only `Applied`, `Interview`, `Offer`, `Rejected`, `Ghosted`; never let undated evidence move a status; let dated evidence supersede a derived `Ghosted`
    - Every read and write carries `.eq("user_id", userId)`; a failed insert leaves activity unlinked for the next run
    - Test against a small in-memory fake Supabase that records applied filters
    - _Requirements: 5.1, 5.6, 5.7, 5.8, 6.1, 6.2, 6.3, 6.4, 6.5, 6.7_

  - [ ]* 8.4 Write property test for idempotency
    - **Property 10: Auto-import is idempotent**
    - **Validates: Requirements 5.6**

  - [ ]* 8.5 Write property test for status monotonicity
    - **Property 11: Status advances only on strictly newer dated evidence**
    - **Validates: Requirements 6.2, 6.3, 6.4, 6.7**

  - [x] 8.6 Wire the Auto_Importer into `src/lib/gmail/sync.ts`
    - Invoke after persistence, only when remaining budget exceeds `AUTO_IMPORT_MIN_BUDGET_MS`, capped at `AUTO_IMPORT_BATCH_CAP` proposals, and caught so it can never fail the scan or lose cursor progress
    - Report created/updated counts through `BatchResult` and the sync route response
    - _Requirements: 5.1, 10.5_

  - [ ]* 8.7 Write tests for status advance, insert failure, and per-user isolation
    - Interview, rejection, and offer evidence each update an existing application's status
    - A failed insert leaves activity unlinked and retryable; every statement is user-scoped
    - _Requirements: 15.7, 5.7, 5.8_

- [x] 9. Checkpoint - automatic organization
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Unknown-employer bucket and the results-first workspace
  - [x] 10.1 Add the bucket derivation to `src/lib/api/gmailActivity.ts`
    - `fetchUnknownBucket(supabase, userId, limit?)` filtering `application_id IS NULL AND company IS NULL AND category IN (<Lifecycle_Category list>)`, plus the pure `isUnknownBucketRow(row)` predicate
    - Derived query only: no new table, column, or constraint beyond the Sprint 9 index
    - _Requirements: 8.1, 8.2, 8.4_

  - [x] 10.2 Add `selectPendingDecisions(proposals, bucketRows)` for the workspace
    - Pending set is exactly the held proposals plus the Unknown-bucket entries; automatically created or linked proposals are excluded
    - _Requirements: 10.2_

  - [ ]* 10.3 Write property test for the bucket/auto-import dichotomy
    - **Property 16: A lifecycle record is either auto-organizable or bucketed, never both and never neither**
    - **Validates: Requirements 8.1, 5.5**
    - Include the assertion that lifecycle activity with a null employer name appears in the bucket derivation (Requirement 15.9)

  - [ ]* 10.4 Write property test for the pending set
    - **Property 19: Only unresolved work is presented as a pending decision**
    - **Validates: Requirements 10.2**

  - [x] 10.5 Add the `reject` and `resolve_unknown` decisions to `src/app/api/gmail/sync/import/route.ts`
    - `reject`: unlink the automatic application's activity and mark it `NOT_JOB_RELATED`
    - `resolve_unknown`: create an application from a user-supplied employer name and link the entry's activity, rejecting any name that resolves to a portal via `isPortalDisplayName` / `sanitizeCompanyName`
    - Keep the existing `import` / `merge` / `ignore` contract, ownership verification for every referenced id, and length-bounded untrusted text
    - _Requirements: 8.3, 8.5, 10.3, 10.4, 14.5_

  - [x] 10.6 Reorder the `/track-my-jobs` workspace to results-first
    - Sections in order: scan controls, "What this scan did" with created/updated/scanned/excluded counts, "Needs your input" with only held proposals, "Unknown applications (N)" with an inline employer field per entry, and a collapsed "Recently organized automatically" list with a per-row "Not mine" action mapping to `reject`
    - Bucket entries render as compact evidence rows (category, sender domain, portal, date, reason code), never as full application cards, and never show body text
    - _Requirements: 10.1, 10.2, 10.4, 10.5_

  - [x] 10.7 Add the bucket entry points
    - `View unknown applications (N)` in the applications header and the dashboard tracking panel, shown only when `N > 0`, linking to `/track-my-jobs#unknown`
    - _Requirements: 8.1_

- [x] 11. Real dashboard metrics
  - [x] 11.1 Create `src/app/dashboard/metrics.ts`
    - `computeWeeklyApplicationData` over the eight most recent complete Monday-based UTC weeks, oldest first, always eight entries, one week per application, unparseable dates excluded
    - `filterApplicationsByRange`, `computeStatusDistribution`, `computePortalDistribution`, `computeScanSummary`, `DASHBOARD_RANGES`, `WEEKS_IN_TREND`
    - Pure module fed from persisted rows only
    - _Requirements: 11.1, 11.2, 11.3, 11.5, 11.6_

  - [ ]* 11.2 Write property test for weekly bucketing in `src/app/dashboard/metrics.test.ts`
    - **Property 18: Weekly buckets are a complete, non-overlapping partition of the reported span**
    - **Validates: Requirements 11.2, 11.3, 11.5, 11.6**

  - [ ]* 11.3 Write unit tests for the dashboard edge cases
    - No applications yields eight zero-count entries; an unparseable applied date is excluded from every bucket; range filtering behaves for each `DashboardRange`
    - _Requirements: 11.4, 11.5_

  - [x] 11.4 Wire the dashboard components to real data
    - Replace `generateWeeklyData()` and the hardcoded `trend` props on `DashboardStats`; grow `TrackMyJobs` into the scan panel (window used, last scan, duration, scanned, lifecycle detected, auto-imported, updated, pending, unknown, excluded)
    - Apply the time filter to the stat row, trend chart, and recent activity; keep the existing layout and the per-read `Promise.allSettled` failure isolation
    - _Requirements: 11.1, 11.4_

- [x] 12. Connected mailbox address and last sync
  - [x] 12.1 Store and read `gmail_address` in `src/lib/api/gmail.ts`
    - Add `emailAddress: string | null` to `GmailConnection`, keeping the type token-free
    - _Requirements: 12.5, 12.6, 14.1_

  - [x] 12.2 Capture the mailbox address in `src/app/api/gmail/callback/route.ts`
    - One `getProfile` call after a successful token exchange stores `emailAddress` on the connection; a failure is non-fatal and leaves the address null
    - No OAuth scope change
    - _Requirements: 12.5, 12.4, 14.8_

  - [x] 12.3 Show the connection detail on `/settings/integrations`
    - Connection state, connected mailbox address or the state alone when absent, connected-at, last completed sync or "No sync has run yet", the default scan window, a link to run a scan, and Disconnect
    - No access token, refresh token, or expiry in any client payload
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.6_

  - [ ]* 12.4 Write integration tests for the address capture
    - Stubbed `fetch`: a successful `getProfile` stores the address; a failing one still completes the connection with a null address
    - _Requirements: 12.4, 12.5_

- [x] 13. Reconciliation of already-imported applications
  - [x] 13.1 Implement `planReconciliation` in `src/lib/gmail/reconcile.ts`
    - Only applications with linked `gmail_activity`; replace `job_portal` only when it is exactly `"Gmail"` and evidence yields a portal; replace `company` / `role` only against the exact `"Unknown company"` / `"Unknown role"` placeholders and only when evidence survives `sanitizeCompanyName`; move `status` only through `shouldUpdateStatus` with dated evidence; never clear a field; emit no empty patch
    - _Requirements: 6.2, 6.5, 7.6, 7.7_

  - [x] 13.2 Implement `runReconciliation`
    - Per-application isolation, user-scoped reads and writes, returns `{ examined, patched }`, idempotent because a patched placeholder no longer matches
    - _Requirements: 5.8, 14.5_

  - [x] 13.3 Add `POST /api/gmail/reconcile` and the explicit repair action
    - Route runs `runReconciliation` for the acting user; the workspace exposes a "Repair Gmail-imported applications" action; never invoked on a timer
    - _Requirements: 10.4, 14.5_

  - [ ]* 13.4 Write tests for reconciliation in `src/lib/gmail/reconcile.test.ts`
    - Plan determinism, idempotence, manual-row immunity, placeholder-only replacement
    - _Requirements: 7.6, 6.2_

- [x] 14. Test suite wiring and structural guarantees
  - [x] 14.1 Register every new test file in the `test:gmail` script
    - Add `applicationEvidence.test.ts`, `evidenceGate.integration.test.ts`, `autoImport.test.ts`, `reconcile.test.ts`, `scanWindow.test.ts`, and the dashboard metrics test to `jobos-web/package.json`
    - _Requirements: 15.3_

  - [ ]* 14.2 Extend `src/lib/gmail/security.test.ts` structurally
    - Cover the four new modules and the Sprint 9 migration: no body persisted, no token in a client component, no new AI provider, no `ALTER TABLE public.applications`, no `DROP CONSTRAINT`, migration re-runnable
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.6, 14.7, 13.4, 13.6, 13.7_

  - [ ]* 14.3 Extend `src/lib/gmail/incremental.test.ts`
    - Extend the analytical benchmark to assert AI-call counts under the new gate for a fixed fixture corpus; re-assert incremental sync, ledger dedup, status monotonicity, and per-user isolation
    - _Requirements: 15.12, 4.2, 4.5, 4.6_

- [x] 15. Final checkpoint - full verification
  - Ensure all tests pass, ask the user if questions arise.
  - Run `npx tsc --noEmit`, `npm test`, and `npm run build`
  - _Requirements: 13.8_

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each of the nineteen correctness properties from the design is implemented by exactly one property-based test, tagged with a comment naming the feature and property
- Property tests run at least 100 iterations via `fast-check`; unit tests stay deliberately few and cover the concrete examples the properties cannot pin
- Checkpoints follow the design's incremental rollout: after task 3 the precision fix alone is shippable, after task 6 the schema and persistence are in place, after task 9 automatic organization works
- The frozen Sprint 8 baseline (incremental sync, list/batch sizing, bounded concurrency, ledger dedup, cursor hold-back, monotonic status, company/portal separation, OAuth, RLS, AI gateway) must remain unchanged by every task

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "4.1", "5.1", "11.1", "12.1"] },
    { "id": 1, "tasks": ["1.3", "4.3", "5.2", "11.2", "12.2", "7.5"] },
    { "id": 2, "tasks": ["1.4", "4.2", "11.3", "12.3", "7.1"] },
    { "id": 3, "tasks": ["1.5", "2.1", "4.4", "7.2", "7.4", "11.4", "12.4", "10.1"] },
    { "id": 4, "tasks": ["1.6", "2.2", "7.3", "7.6", "8.1", "13.1", "4.5"] },
    { "id": 5, "tasks": ["1.7", "2.3", "2.4", "8.2", "13.2", "10.2"] },
    { "id": 6, "tasks": ["1.8", "2.5", "8.3", "13.4", "5.3"] },
    { "id": 7, "tasks": ["1.9", "2.6", "8.4", "5.4", "10.5"] },
    { "id": 8, "tasks": ["1.10", "8.5", "8.6", "10.6"] },
    { "id": 9, "tasks": ["8.7", "10.7", "13.3"] },
    { "id": 10, "tasks": ["10.3", "14.1"] },
    { "id": 11, "tasks": ["10.4", "14.2", "14.3"] }
  ]
}
```

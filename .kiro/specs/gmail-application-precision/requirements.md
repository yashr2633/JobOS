# Requirements Document

## Introduction

JobOS scans a connected Gmail mailbox and turns application correspondence into tracked applications. Detection currently has poor precision: of roughly 750 scanned messages, roughly 637 were classified job-related, because an ATS/job-board sender domain alone escalates a message to candidate status and a broad keyword regex (`application|applied|candidate|position|role|hiring|recruit`) escalates almost anything else. Job alerts, social notifications, course promotions, and loan/finance mail therefore reach the review queue and the AI classifier.

This feature replaces the escalation logic with a lifecycle-evidence gate, makes high-confidence applications organize themselves without a manual click, narrows the default scan window from 180 days to 30 days, exposes a bucket for lifecycle mail whose employer could not be determined, replaces the mocked dashboard weekly chart with real data, and shows the connected Gmail address and last-sync time on the integrations page.

The scope is precision and automatic organization. Gmail OAuth, incremental sync, the activity ledger, Resume Match, and the AI gateway already work and are explicitly out of scope for change.

## Glossary

- **Evidence_Gate**: New module `src/lib/gmail/applicationEvidence.ts`. Classifies one parsed email into `EvidenceStrength` (`strong` | `weak` | `none`) plus a category, a lifecycle flag, and a reason code. Pure: no network, no AI, no database.
- **EvidenceStrength**: `strong` when a lifecycle pattern matched deterministically, `weak` when an ATS sender is paired with candidate language and only AI can decide, `none` when the email carries no application evidence.
- **Lifecycle_Event**: An email that evidences a real stage of the user's own application: application confirmation, application received, application update, interview invitation, interview update, rejection of an application, offer, or withdrawal.
- **Lifecycle_Category**: The `EmailCategory` values that denote a Lifecycle_Event: `APPLICATION_CONFIRMATION`, `APPLICATION_RECEIVED`, `APPLICATION_UPDATE`, `INTERVIEW_INVITATION`, `INTERVIEW_UPDATE`, `REJECTION`, `OFFER`, `WITHDRAWAL`.
- **Hard_Exclusion**: A deterministic rule that classifies an email as carrying no application evidence before any other rule runs. Covers job alerts and digests, social-network notifications, finance/loan/banking mail, newsletters and promotions, and "posted a job" / "is hiring" announcements.
- **Heuristic_Layer**: Existing module `src/lib/gmail/heuristics.ts`, whose `evaluateEmail` function produces the pre-AI verdict.
- **Sync_Pipeline**: Existing module `src/lib/gmail/sync.ts`. Lists message ids, deduplicates against the ledger, fetches metadata, applies the Heuristic_Layer, calls AI for ambiguous emails, and writes ledger rows.
- **Activity_Ledger**: The `gmail_activity` table, unique on `(user_id, gmail_message_id)`.
- **Auto_Importer**: New module `src/lib/gmail/autoImport.ts`. Decides which proposals are safe to persist without user confirmation and applies them.
- **Proposal_Builder**: Existing module `src/lib/gmail/proposals.ts`, whose `buildProposals` function groups ledger rows into application proposals.
- **Status_Resolver**: Existing module `src/lib/gmail/statusInference.ts`, which maps categories to the five allowed application statuses and enforces status monotonicity.
- **Unknown_Bucket**: The set of Activity_Ledger rows for one user where `application_id IS NULL`, `category` is a Lifecycle_Category, and `company IS NULL`. Derived by query; requires no schema change.
- **Scan_Window**: The historical date range passed to Gmail's `q=` parameter, selected from `7d`, `30d`, `60d`, `90d`, `all`.
- **Scan_Query_Builder**: Existing module `src/lib/gmail/query.ts`.
- **Review_Workspace**: The `/track-my-jobs` page and its client component, where the user corrects automatic decisions.
- **Portal**: A job board or applicant-tracking vendor (LinkedIn, Naukri, Indeed, Greenhouse, and the rest of `ATS_DOMAINS`). A Portal is never an employer.
- **Dashboard**: The `/dashboard` route and its supporting functions in `src/app/dashboard/utils.ts`.
- **Integrations_Page**: The `/settings/integrations` route.

## Requirements

### Requirement 1: Reject non-application mail before anything else

**User Story:** As a job seeker, I want job alerts, social notifications, and finance mail excluded from tracking, so that my application list reflects only jobs I actually applied to.

#### Acceptance Criteria

1. THE Evidence_Gate SHALL evaluate Hard_Exclusion rules before evaluating strong lifecycle rules and before evaluating weak-evidence rules.
2. WHEN an email matches a Hard_Exclusion rule, THE Evidence_Gate SHALL return strength `none`, category `NOT_JOB_RELATED`, `isLifecycleEvent` false, and a reason code naming the matched exclusion class.
3. WHEN an email is a job alert, job digest, or job recommendation from any sender, THE Evidence_Gate SHALL return strength `none`.
4. WHEN an email is a social-network notification, including connection requests, profile views, post activity, and "people you may know", THE Evidence_Gate SHALL return strength `none`.
5. WHEN an email concerns a loan, credit card, banking, insurance, or other financial application, THE Evidence_Gate SHALL return strength `none`.
6. WHEN an email is a newsletter, promotion, course advertisement, webinar invitation, or salary report, THE Evidence_Gate SHALL return strength `none`.
7. WHEN an email announces that a person or company posted a job or is hiring, THE Evidence_Gate SHALL return strength `none`.
8. WHEN an email carries the Gmail label `CATEGORY_PROMOTIONS`, `SPAM`, or `TRASH`, THE Evidence_Gate SHALL return strength `none`.
9. THE Evidence_Gate SHALL return strength `none` for an email whose only job-related signal is one of the words "application", "applied", "candidate", "candidacy", "position", "role", "hiring", or "recruit".

### Requirement 2: Accept genuine application lifecycle evidence

**User Story:** As a job seeker, I want emails about my own applications recognized without an AI call, so that real applications are tracked accurately and at zero model cost.

#### Acceptance Criteria

1. WHEN an email matches a strong lifecycle pattern and matches no Hard_Exclusion rule, THE Evidence_Gate SHALL return strength `strong`, a Lifecycle_Category, `isLifecycleEvent` true, and a reason code naming the matched pattern class.
2. WHEN an email states that an application was received, submitted, or thanked for, THE Evidence_Gate SHALL return category `APPLICATION_CONFIRMATION`.
3. WHEN an email invites the user to an interview, a screening call, or an online assessment, THE Evidence_Gate SHALL return category `INTERVIEW_INVITATION`.
4. WHEN an email declines the user's application, THE Evidence_Gate SHALL return category `REJECTION`.
5. WHEN an email extends an employment offer, THE Evidence_Gate SHALL return category `OFFER`.
6. WHEN two or more lifecycle patterns match one email, THE Evidence_Gate SHALL return the category of the pattern that is furthest along the hiring lifecycle, ranked offer above rejection above interview above application confirmation.
7. WHERE a lifecycle pattern matches the subject line, THE Evidence_Gate SHALL report a confidence of at least 0.9.

### Requirement 3: Spend AI credits only on ambiguous application mail

**User Story:** As a user with limited AI credits, I want the model called only when an email plausibly concerns my application but no rule can decide, so that scanning stays affordable.

#### Acceptance Criteria

1. WHEN an email matches no Hard_Exclusion rule, matches no strong lifecycle pattern, originates from a Portal or ATS sender domain, and contains candidate-facing application language, THE Evidence_Gate SHALL return strength `weak` with a null category.
2. WHEN an email originates from a Portal or ATS sender domain and contains no candidate-facing application language, THE Evidence_Gate SHALL return strength `none`.
3. THE Heuristic_Layer SHALL derive its verdict from the Evidence_Gate result rather than from an independent sender-domain rule or keyword rule.
4. WHEN the Evidence_Gate returns strength `none`, THE Heuristic_Layer SHALL report `candidate` false, `needsAI` false, and category `NOT_JOB_RELATED`.
5. WHEN the Evidence_Gate returns strength `strong`, THE Heuristic_Layer SHALL report `candidate` true, `needsAI` false, and the Evidence_Gate category.
6. WHEN the Evidence_Gate returns strength `weak`, THE Heuristic_Layer SHALL report `candidate` true and `needsAI` true.
7. THE Sync_Pipeline SHALL send an email to the AI classifier only when the Heuristic_Layer reports `needsAI` true.

### Requirement 4: Record every scanned email so deduplication keeps working

**User Story:** As a job seeker who re-scans my mailbox, I want previously rejected emails never re-examined, so that repeat scans are fast and cost nothing.

#### Acceptance Criteria

1. WHEN the Evidence_Gate returns strength `none` for a scanned email, THE Sync_Pipeline SHALL write an Activity_Ledger row for that email with category `NOT_JOB_RELATED`.
2. THE Sync_Pipeline SHALL query the Activity_Ledger for already-processed message ids before fetching message metadata and before calling the AI classifier.
3. WHEN a message id already exists in the Activity_Ledger for the acting user, THE Sync_Pipeline SHALL leave the stored row unchanged.
4. THE Sync_Pipeline SHALL advance the stored page cursor only after every fresh message on the listed page has been processed.
5. WHILE a sync job is running in incremental mode, THE Sync_Pipeline SHALL list message ids from Gmail history since the stored anchor.
6. WHEN a full scan completes, THE Sync_Pipeline SHALL report the Gmail history id so the caller can promote the anchor.
7. THE Sync_Pipeline SHALL write no email body text to any table.

### Requirement 5: Organize high-confidence applications automatically

**User Story:** As a job seeker, I want confirmed applications to appear in my tracker without clicking Import for each one, so that tracking requires no manual data entry.

#### Acceptance Criteria

1. WHEN a sync batch finishes, THE Auto_Importer SHALL build proposals from that user's unlinked lifecycle activity using the Proposal_Builder.
2. WHERE a proposal has a non-null employer name and at least one strong lifecycle evidence row, THE Auto_Importer SHALL create an application for that proposal and link its activity rows to it.
3. WHERE a proposal matches an existing application at match tier `thread`, `job_url`, or `company_title`, THE Auto_Importer SHALL link the proposal's activity rows to that existing application instead of creating a new one.
4. WHERE a proposal matches an existing application at match tier `company_only`, THE Auto_Importer SHALL leave the proposal unlinked for user review.
5. WHERE a proposal has a null employer name, THE Auto_Importer SHALL leave the proposal unlinked for user review.
6. WHEN the Auto_Importer runs twice over the same Activity_Ledger state, THE Auto_Importer SHALL produce the same set of applications as a single run.
7. IF an application insert fails, THEN THE Auto_Importer SHALL leave the corresponding activity rows unlinked and allow the next run to retry them.
8. THE Auto_Importer SHALL restrict every read and write to the acting user's rows.

### Requirement 6: Advance the status of an existing application from new evidence

**User Story:** As a job seeker, I want an interview, rejection, or offer email to update the application it belongs to, so that my tracker shows the current stage.

#### Acceptance Criteria

1. WHEN activity is linked to an existing application, THE Auto_Importer SHALL resolve a status from that application's evidence using the Status_Resolver.
2. WHEN the resolved status differs from the stored status and the newest evidence is dated later than the stored status timestamp, THE Auto_Importer SHALL write the resolved status to the application.
3. IF the newest evidence is dated no later than the stored status timestamp, THEN THE Auto_Importer SHALL leave the stored status unchanged.
4. IF evidence carries no date, THEN THE Auto_Importer SHALL leave the stored status unchanged.
5. THE Auto_Importer SHALL write only the status values `Applied`, `Interview`, `Offer`, `Rejected`, and `Ghosted`.
6. WHEN an email invites the user to an online assessment, THE Status_Resolver SHALL resolve the status `Interview`.
7. WHEN a stored status is `Ghosted` and dated evidence resolves any other status, THE Auto_Importer SHALL write the resolved status.

### Requirement 7: Group all evidence for one role into one application

**User Story:** As a job seeker, I want the confirmation, interview, and rejection emails for one role to form a single tracked application, so that my list has one entry per application.

#### Acceptance Criteria

1. WHEN two lifecycle emails share a Gmail thread id, THE Proposal_Builder SHALL place both in the same proposal.
2. WHEN two lifecycle emails share a canonical employer name and a canonical job title, THE Proposal_Builder SHALL place both in the same proposal.
3. THE Proposal_Builder SHALL set a proposal's applied date to the earliest evidence date in that proposal.
4. THE Proposal_Builder SHALL set a proposal's last-activity timestamp to the latest evidence date in that proposal.
5. THE Proposal_Builder SHALL exclude Activity_Ledger rows with category `NOT_JOB_RELATED` from every proposal.
6. THE Proposal_Builder SHALL resolve a proposal's employer name to null rather than to a Portal name when no employer name is available.
7. THE Proposal_Builder SHALL record the Portal name in the proposal's `jobPortal` field, separately from the employer name.

### Requirement 8: Surface lifecycle mail whose employer is unknown

**User Story:** As a job seeker, I want lifecycle emails whose employer could not be determined collected in one place, so that I can name the employer myself instead of losing the application.

#### Acceptance Criteria

1. THE Review_Workspace SHALL derive the Unknown_Bucket from Activity_Ledger rows where `application_id` is null, `category` is a Lifecycle_Category, and `company` is null.
2. THE Unknown_Bucket derivation SHALL require no new table, column, or constraint.
3. WHEN the user supplies an employer name for an Unknown_Bucket entry, THE Review_Workspace SHALL create an application with that employer name and link the entry's activity rows to it.
4. THE Review_Workspace SHALL restrict the Unknown_Bucket to the acting user's rows.
5. THE Review_Workspace SHALL reject a supplied employer name that resolves to a Portal name.

### Requirement 9: Scan the last 30 days by default

**User Story:** As a job seeker, I want a recent-mail scan by default with the option to look further back, so that the first scan is fast and cheap.

#### Acceptance Criteria

1. THE Scan_Query_Builder SHALL default the Scan_Window to 30 days.
2. THE Scan_Query_Builder SHALL accept the Scan_Window values `7d`, `30d`, `60d`, `90d`, and `all`.
3. WHEN the Scan_Window is `all`, THE Scan_Query_Builder SHALL omit the lower date bound from the Gmail query.
4. WHEN a Scan_Window other than `all` is selected, THE Scan_Query_Builder SHALL include an `after:` bound equal to the current date minus the window's day count, formatted as UTC `YYYY/MM/DD`.
5. THE Scan_Query_Builder SHALL exclude spam, trash, and chats from every query.
6. IF a sync request supplies a Scan_Window value outside the accepted set, THEN THE sync endpoint SHALL use the 30-day window.
7. THE Review_Workspace SHALL present the accepted Scan_Window values and send the selected value with each sync request.

### Requirement 10: Keep manual review as a corrections path

**User Story:** As a job seeker, I want the interface to show what was already organized and ask me only about the uncertain cases, so that I am not asked to approve work the system already did.

#### Acceptance Criteria

1. THE Review_Workspace SHALL present applications created automatically since the last scan as a completed result rather than as pending decisions.
2. THE Review_Workspace SHALL present as pending decisions only proposals the Auto_Importer left unlinked and Unknown_Bucket entries.
3. WHEN the user rejects an automatically created application, THE Review_Workspace SHALL unlink its Gmail activity and mark that activity `NOT_JOB_RELATED`.
4. THE Review_Workspace SHALL retain the existing import, merge, and ignore actions for pending decisions.
5. WHEN a scan reports a completed pass, THE Review_Workspace SHALL report the count of applications created and the count of applications updated by that scan.

### Requirement 11: Base the dashboard weekly chart on real applications

**User Story:** As a job seeker, I want the weekly activity chart to reflect my real applications, so that the dashboard is trustworthy.

#### Acceptance Criteria

1. THE Dashboard SHALL compute weekly application counts from the acting user's stored applications.
2. THE Dashboard SHALL return one entry per week for the eight most recent complete weeks, ordered oldest to newest.
3. WHEN an application's applied date falls inside a week's bounds, THE Dashboard SHALL count that application in that week only.
4. WHEN the user has no applications, THE Dashboard SHALL return eight weekly entries with a count of zero each.
5. WHEN an application's applied date is unparseable, THE Dashboard SHALL exclude that application from every weekly count.
6. THE Dashboard SHALL return weekly counts whose sum equals the number of applications whose applied date falls inside the reported eight-week span.

### Requirement 12: Show the connected Gmail account and last sync

**User Story:** As a job seeker with several Google accounts, I want to see which mailbox is connected and when it last synced, so that I can confirm JobOS is reading the right inbox.

#### Acceptance Criteria

1. THE Integrations_Page SHALL display the email address of the connected Gmail account.
2. THE Integrations_Page SHALL display the timestamp of the last completed sync.
3. WHEN no sync has completed, THE Integrations_Page SHALL state that no sync has run.
4. WHEN the stored Gmail address is absent, THE Integrations_Page SHALL display the connection state without an address.
5. WHEN a Gmail connection is created or refreshed through the OAuth callback, THE server SHALL store the mailbox address returned by the Gmail profile endpoint on that connection.
6. THE Integrations_Page SHALL send no Gmail access token, refresh token, or token expiry to the browser.

### Requirement 13: Type safety and schema safety

**User Story:** As the maintainer, I want the change to compile cleanly under the existing configuration and leave the database contract intact, so that quality does not regress.

#### Acceptance Criteria

1. THE implementation SHALL contain no `any` type, no `@ts-ignore` comment, and no `@ts-expect-error` comment.
2. THE implementation SHALL use no type assertion whose purpose is to suppress a compiler error.
3. THE implementation SHALL leave `tsconfig.json` and `eslint.config.mjs` compiler and lint strictness unchanged.
4. THE implementation SHALL leave the `applications.status` CHECK constraint unchanged.
5. WHERE the existing schema supports a required behaviour, THE implementation SHALL add no migration for that behaviour.
6. WHERE a migration is required, THE migration SHALL be additive and SHALL succeed when applied a second time.
7. THE implementation SHALL preserve the `UNIQUE(user_id, gmail_message_id)` constraint on the Activity_Ledger.
8. THE implementation SHALL pass `npx tsc --noEmit`, `npm test`, and `npm run build`.

### Requirement 14: Security and privacy of Gmail data

**User Story:** As a job seeker, I want my mailbox contents and credentials protected, so that connecting Gmail is safe.

#### Acceptance Criteria

1. THE implementation SHALL keep Gmail access tokens and refresh tokens out of every client component payload.
2. THE implementation SHALL send no Gmail message id to an AI provider.
3. THE implementation SHALL send no email body text to an AI provider.
4. THE implementation SHALL persist no email body text.
5. THE implementation SHALL constrain every Activity_Ledger and applications statement by the acting user's id.
6. THE implementation SHALL route every AI call through the existing AI gateway module.
7. THE implementation SHALL add no additional AI provider.
8. THE implementation SHALL leave the Google OAuth, Gmail OAuth, row-level security, and Resume Match modules unchanged unless a reproduced defect in one of them blocks a requirement above.

### Requirement 15: Test suite conventions and coverage

**User Story:** As the maintainer, I want the new behaviour covered by tests that run in the existing harness, so that precision cannot silently regress.

#### Acceptance Criteria

1. THE new tests SHALL use the `node --test` runner and the `assert/strict` module.
2. THE new library test files SHALL import modules under test by relative path with an explicit `.ts` extension.
3. THE `test:gmail` script in `package.json` SHALL list every new test file.
4. THE implementation SHALL leave every existing test assertion in place.
5. THE test suite SHALL assert that a job alert, a social notification, and a finance-application email each produce strength `none`.
6. THE test suite SHALL assert that an application confirmation email produces strength `strong` and a Lifecycle_Category.
7. THE test suite SHALL assert that interview, rejection, and offer evidence update an existing application's status.
8. THE test suite SHALL assert that several lifecycle emails for one role group into one proposal.
9. THE test suite SHALL assert that lifecycle activity with a null employer name appears in the Unknown_Bucket derivation.
10. THE test suite SHALL assert that no Portal name is stored as an employer name.
11. THE test suite SHALL assert the default and selectable Scan_Window behaviour.
12. THE test suite SHALL assert that incremental sync, ledger deduplication, status monotonicity, and per-user isolation still hold.

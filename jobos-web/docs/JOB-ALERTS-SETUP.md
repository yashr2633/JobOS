# JobTrackOS job alerts

Implemented locally: Settings > Job alerts; verified account email only; explicit email opt-in; daily or weekly preference; role/company and city filters; authenticated save/read; public unsubscribe confirmation and POST; protected scheduled sender; original-source dates; fresh-source evidence; duplicate job suppression; durable provider acceptance records. No existing account is automatically subscribed.

WhatsApp is not currently offered. No WhatsApp request option is shown and the API rejects new WhatsApp opt-ins. Existing schema fields are retained to avoid destructive changes. No paid plan or messaging credits have been purchased.

The dashboard and signed-in Find Jobs now show a role/location email form with the action "Enable daily emails". Saved career preferences can prefill the form but never subscribe the user by themselves. Signup has an optional setup choice that directs the user to alert preferences after either email confirmation or Google signup. The user then chooses the actual search and subscription. Normal login and signup without that choice keep their existing destinations.

## Activate email

1. Apply `supabase-schema-job-alerts.sql` once in the existing Supabase project after the existing migrations. It adds new alert-only tables and grants access only to the server service role; existing tracker/resume tables are untouched. Do not subscribe existing users by importing their auth email list.
2. Configure a Brevo sender and authenticate its domain using the DNS records Brevo provides. Use an address on the JobTrackOS domain. Configure provider bounce/complaint suppression before enabling delivery. A provider acceptance ID is not proof of inbox delivery.
3. Set server-only environment variables: `SUPABASE_SERVICE_ROLE_KEY`, `BREVO_API_KEY`, `JOB_ALERT_FROM_EMAIL`, `CRON_SECRET` (random secret), and `JOB_ALERTS_ENABLED=true`. Existing Supabase public configuration is reused. Never put secret values in NEXT_PUBLIC variables or source control.
4. Deploy through the existing Vercel workflow. Run the production build before deployment. Authenticate a test account, open `/settings/alerts`, choose an actually available role/city and enable email alerts yourself. Existing career profiles are available separately; alerts use the user's explicit search fields so no browsing history is silently imported.
5. Schedule GET `/api/job-alerts/dispatch` with `Authorization: Bearer <CRON_SECRET>`. Use the hosting plan's supported scheduler. Each run handles at most 10 subscriptions and uses a five-minute global lease. Schedule no more frequently than every five minutes; email cadence remains per-user daily/weekly. No schedule is automatically added and no production emails are sent by this implementation task.
6. Verify an email against a matching job posted after consent, a no-match run, unsubscribe, cross-user access denial, and duplicate suppression before broader launch. Do not change source publication dates to manufacture a test match.

## Sending limits and operations

The sender reserves at most 250 requests per UTC day across all users, leaving space under Brevo's documented 300/day free allowance for other mail. Other applications sharing the Brevo account can still exhaust its quota. Request limits are ceilings, not delivery promises. Do not create multiple accounts to bypass provider limits.

Only source-listed jobs with a known publication date within seven days and source evidence within 24 hours are eligible. The first digest can include existing recent vacancies; later digests exclude previously accepted job hashes. Unknown publication dates, expired jobs, and source failures produce no fabricated alert. Strict role/title and city matching can yield no results. The first version uses existing configured employer feeds and does not claim all internet vacancies or all employers. No AI tokens or resume contents are sent to the email provider.

The email shows the recipient's first name when supplied, job cards, source, publication date, employer application link and preference controls. Sender defaults to JobTrackOS. Optional `JOB_ALERT_FROM_NAME` may identify a real authorized team member, for example "Yash from JobTrackOS". Do not use invented recruiters, impersonate Naukri/employers, or imply actual selection. The sender address must be verified in Brevo. This automation targets users who enable job emails; lead collection or external email-list importing is not part of the sender.

`job_alert_deliveries.status=accepted` means Brevo accepted the request. `sending` and `unknown` block that subscriber until reviewed against provider logs. Do not blindly retry after network timeout or ambiguous provider failure: the provider might already have accepted the email. After review, mark accepted with provider ID, or failed only when non-acceptance is confirmed. Idempotency keys reuse each delivery's UUID. Explicit 4xx rejections are failed and may be retried on a later run.

Consent withdrawal is rechecked immediately before reserving a send. An already submitted request cannot be recalled. Links in email open the original employer application destination and JobTrackOS search. There are no hidden tracking pixels added by JobTrackOS; provider tracking settings still apply. Unsubscribe works without login; opening the link alone does not unsubscribe because mail security scanners follow links.

This bounded first release is not sized or load-tested for 20,000 active subscriptions. At a 250/day ceiling even one email to 20,000 subscribers takes at least 80 days. Upgrade only with explicit spend approval, then implement queued batches and sufficient scheduler capacity before promising that scale.

## Personal data and rollback

Contact email stays in Supabase Auth; alert tables store user ID, selected role/city, consent timestamps/version, channel requests and source job hashes. Account deletion cascades alert data. Contacts are never exported to a public database. Use separate retention rules for operational delivery and consent evidence before a large rollout.

To stop delivery immediately, set `JOB_ALERTS_ENABLED=false` and disable the scheduler. Preserve the tables for consent and delivery review. The UI can still accept preference changes. No unrelated database rollback is necessary.

Provider reference: https://developers.brevo.com/reference/send-transac-email
Free limits: https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan

# Dashboard assistant results and recovery

Scope: the existing dashboard Career Assistant, its intent/results routes and
result presentation. No new navigation route, schema, authentication, Gmail,
application tracking, tailoring/export, entitlement or billing changes.

## Behavior

- Full-width desktop job comparison: role/company, location, source education
  requirement, evidence-based resume match /100, original/source date provenance,
  direct original Apply link, source attribution and rechecked full details.
  Mobile rows reflow with visible field labels. Start with nine actual results,
  retain existing pagination and display the actual filtered source count.
- Education text is a source excerpt, not an assertion that a candidate is eligible.
  Parsed candidate education stays local to matching presentation.
- Explicit resume-based job requests use already extracted suggested roles locally;
  neither private resume text nor filename is sent to public search. Selecting a
  role changes the public search query; unavailable resume evidence prompts a choice.
- Model interpretation failure becomes a bounded clarification with selectable
  roles. Confirmed earlier city/experience filters survive the selected answer.
  Expired sessions still ask for sign-in; authentication is not bypassed.
- A catalog whose every source failed no longer counts as a successful empty
  response. Healthy partial results remain usable with an incomplete-coverage note.
- Original Google-grounded text, citations and required Search Suggestions remain
  unchanged in expandable additional research. They are not fabricated structured
  jobs, not assigned resume scores and not counted in the employer table.

## Material limits

This release does not provide unlimited internet search or add an employer feed.
Google provider quota and source licensing/access remain external constraints.
An unconnected employer is identified as such, with its known official careers
page where available. Empty results never mean that an entire city/employer has
no vacancies. Existing freshness rules, unknown dates and explicit widening remain.
The owner has chosen free quota only. Do not enable billing or accept new terms.

## Rollback

Production baseline: f54c373967372a40df3327efe1384cdf74705ce3.
Release rollback branch: codex/assistant-results-rollback-2026-10-28.
Use the existing Git main-to-Vercel workflow. Do not force push, alter DNS or
change provider/OAuth configuration. Record observed production smoke checks
after deployment, not as assumptions here.

## Verification before release

Final combined jobs and UI suite: 136 tests, 135 passed, one optional live
Greenhouse integration skipped, zero failures. Final production build and
TypeScript passed. Changed-file lint passed after fixing the two new findings.

Signed-in built-app checks used real employer/remote feeds with Google generation
explicitly disabled only in the local test process: BBA/fresher/Bokaro returned
four explicitly India-eligible remote roles; Sales Executive/Kolkata retained the
earlier fresher/degree filters and pagination expanded nine actual records to the
full loaded result set. Weekday full JD, resume-fit explanation and original Apply
destination were rechecked. BBF Racer produced clarification, not a parser error.
Anonymous search endpoints returned JSON 401; foreign-origin results returned 403.

Browser QA caught and fixed academic false positives in 'degree of accuracy' and
'master data', and an 'Experienced Only' title incorrectly surviving a fresher
search with unknown years. Unknown resume experience now asks one contextual
question instead of treating senior vacancies as suitable. Relevant tests passed.

A new Google Flash-Lite live diagnostic was initially rejected by automatic
approval review because free-only billing had not been proven. The owner session
was then found: configured-key metadata matched JobOS Project, and its billing
screen showed Free, INR 0 eligible credits, and service paused pending positive
credit balance. A bounded diagnostic was approved with that new evidence.
Flash-Lite returned HTTP 404 NOT_FOUND, explicitly unavailable to this account;
the suggested newer paid-grounding model was not enabled. No replacement key,
model, paid plan, billing or funding change was made. No successful new external
Google search is claimed. Production smoke results are recorded after deployment.

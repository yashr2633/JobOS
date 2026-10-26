# Employer coverage expansion — 27 October 2026 (India)

## Implemented

Eight additional employer-owned SmartRecruiters boards enter the existing unified
India feed, search, filters, detail recheck, application navigation and Resume
Match/tracker workflow. No employer accounts or company identities were created.
The separate optional web-search panel was removed from Find Jobs: candidates use
the normal role/location search and job cards. Google-grounded answers are not
ingested into the catalog or presented as verified vacancies.

| Employer | Verified employer career page | Normalized India listings observed |
| --- | --- | ---: |
| ServiceNow | https://careers.smartrecruiters.com/ServiceNow | 69 |
| NielsenIQ | https://careers.smartrecruiters.com/nielseniq | 61 |
| Freshworks | https://careers.smartrecruiters.com/Freshworks | 34 |
| Sopra Steria | https://careers.smartrecruiters.com/SopraSteria1/soprasteria-in | 63 |
| Ramboll | https://careers.smartrecruiters.com/ramboll3 | 104 |
| Syngenta Group | https://careers.smartrecruiters.com/SyngentaGroup/india | 30 |
| Turner & Townsend | https://careers.smartrecruiters.com/TurnerTownsend | 151 |
| Dr Reddy's Laboratories | https://careers.smartrecruiters.com/DrReddysLaboratoriesLimited | 45 |

These are historical verification observations (557 records), not counters to show
in the product, promises of today's postings, or counts after the default date
filter/deduplication. One ServiceNow record changed between the initial endpoint
probe and normalized adapter run. Source counts can change normally.

Each entire India list was fetched through the actual app adapter, including both
pages for Ramboll and Turner & Townsend. One real detail per employer was fetched
and checked for PUBLIC visibility, India location, full job description and its
official application URL. Original posting dates remain unknown; source release
dates keep their existing distinct label. Real non-metro locations included Baddi,
Pydibimavaram, Gwalior, Chittorgarh, Chhindwara, Guntur and Vadodara.

## Access and refresh

Documented public Posting API:
https://developers.smartrecruiters.com/docs/posting-api and
https://developers.smartrecruiters.com/docs/endpoints.
Only unauthenticated PUBLIC postings are used, never internal postings or candidate
APIs. Existing shared pacing/concurrency, timeouts, pagination bounds, expiry,
closure checks and source-health reporting remain in force. No keys, paid service,
database migration, OAuth change or account permissions were added.

The existing request-driven employer refresh/cache is five minutes, with a
20-minute source-check display ceiling. Manual search and Refresh reuse these
limits; they do not bypass provider rate limits or invent a new publication time.
Himalayas retains its separately labelled daily snapshot. There is no claim of
an unattended global crawler or immediate indexing of every new company posting.

## Named sources investigated but not enabled

- Visa: observed employer career page https://careers.smartrecruiters.com/Visa;
  its public India endpoint returned zero. This is not evidence of no vacancies
  across Visa's other systems.
- Amazon: public India search JSON responded and robots excluded internal areas.
  That demonstrates technical reachability, not a confirmed republication licence.
  The career footer links Amazon Conditions of Use; that page returned 503 during
  review. Do not enable a commercial importer on this evidence alone.
- Google: robots explicitly exclude paginated careers search result URLs. No
  supported permissioned vacancy import was confirmed. Do not bypass those rules.
- Deloitte: https://www.deloitte.com/global/en/careers/job-search.html and a real
  South Asia job page were located. No documented public redistribution feed or
  authorized job-board integration was verified in this pass.
- LinkedIn, Indeed and Naukri: no publisher/partner credentials or republication
  agreement are configured for this change. They are not represented as connected.

The enabled employer count is now 15 plus the existing India-remote source.
Universal India/world coverage remains incomplete. Additional employer-supported
feeds and/or a licensed broad-coverage provider must be verified and onboarded;
an accessible webpage or an AI-generated answer is not a universal jobs API.

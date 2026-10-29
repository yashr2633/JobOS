# Approved blue workspace and document studio

Production base / rollback: `ea20d099859f36ef649d47ab742d59c00700be9f`.
Rollback branch: `codex/pre-resume-studio-2026-10-30`.
Release branch: `codex/blue-resume-studio-2026-10-30`.

## Scope

- Apply the approved navy, blue and white treatment through the shared candidate shell and controls. Keep Track My Application available.
- Public home and signed-out `/jobs` browse actual existing feeds, source dates, filters, pagination and direct application destinations. Candidate and employer login remain separate.
- Add authenticated Resume Builder and Cover Letter, linked from Resume Match and the workspace. Existing matching/tailoring, Gmail, applications and employer logic are reused.
- Resume Builder supports source import/upload, custom editable sections, ordering, formatting, preview, private drafts and PDF/DOCX/TXT. A deliberate action adds a copy to the existing Resume Match library.
- There are 50 distinct single-column typographic presets, each supporting five section-priority arrangements; these are not 250 unrelated visual designs.
- General and role-specific Cover Letter drafts prioritize user-entered facts against the JD. Drafting is deterministic, editable and uses no model credits. It does not claim JD requirements as candidate qualifications.

## Data and security

No schema, RLS, OAuth configuration, dependency, domain, credential or billing changes. Draft JSON lives in the existing private `resumes` bucket under `auth.uid()/documents/{kind}/{id}.json`, protected by existing owner-folder policies. New routes require a verified account. Writes validate the browser origin against the request host; the host-aware check handles Next's local bind address. Neither API accepts a caller-supplied user or storage path. Public jobs project only public vacancy fields and never read resumes or accounts.

No hidden selection instructions, fabricated candidate facts, hiring probabilities or guaranteed shortlist claims are added.

## Verification

- 14 document, request-origin and public-filter regressions passed.
- Resume/export suite: 319 passed, including content/order extraction across all 250 PDF and DOCX arrangements and 50 distinct base configurations.
- Jobs: 88 passed; one optional live probe skipped. UI: 114 passed. AI: 99 passed. SEO: 4 passed.
- Typecheck, changed-file lint and production build passed again after the final live-origin correction.
- Visually inspected every page of 50 representative resume PDFs and one Cover Letter PDF (52 total pages); no overlap, clipping or missing content. One spacious preset legitimately continues onto page two.
- Local authenticated page access and anonymous public browsing were observed. Anonymous feed returned 2,594 loaded matching listings at this test time; this is an observation, not a fixed count or universal coverage promise. Company autocomplete was observed.
- The first real draft-save attempt exposed a local bind-address origin mismatch. The focused fix and two origin tests passed. Both a synthetic resume and role-specific Cover Letter were saved privately, refreshed and reopened through the real authenticated UI. PDF and DOCX were downloaded and opened/parsed; resume TXT download also succeeded. The letter retained supplied SQL/Excel/BBA facts and did not invent the JD-only MBA/five-year requirements.
- Anonymous HTTP smoke: 17 public-page, private-redirect, JSON authentication, cross-origin rejection, sitemap/robots and real-feed checks passed. UI pagination advanced 20 to 40 cards. Company search returned only the requested employer's cards; Dhanbad autocomplete suggestions were observed. Public layout inspected at desktop and 390px without horizontal overflow. Document layout inspected at the default 795px viewport; a requested 320px override did not apply to that tab and is not claimed verified.
- Browser control intermittently timed out and recovered. No new genuine Gmail scan, external AI tailoring call or application submission was performed in this release verification; those existing workflows were not changed.

## Honest limits

- Connected-source coverage and provider quotas remain finite. This release does not integrate every company or promise every job on the internet. Original-date filtering excludes unknown dates; source updates are labeled separately.
- Standard PDF fonts support Latin-script output. Unsupported scripts return a clear error; DOCX/TXT preserve Unicode. No silent character deletion.
- Preview reflects content/order and typography; exact export pagination can differ.
- Shared production storage is used; clearly named synthetic QA drafts, if saved, must not be confused with candidate-provided documents.

## Deployment and rollback

Use the existing GitHub `main` to Vercel production workflow. Do not force-push. Push the rollback reference before promoting the release. Verify Vercel's GitHub commit status and the live public URLs/private route protections. A serious new regression requires the documented Vercel rollback or an explicit main revert restoring `ea20d09`; preserve subsequent history.

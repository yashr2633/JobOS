# Resume design library and paired application documents

Base/rollback: `1cc786e39a0b92e4f2feb400347cfad62ffc82d1`, branch `codex/pre-design-library-2026-10-30`.
Release branch: `codex/resume-design-library-2026-10-30`.

## User-facing change

The previous gallery exposed 50 mostly typographic presets after a long editor. The new entry point is **Resume Studio**, with the visual template gallery before the form. It contains 60 original resume designs: twelve composition families with five header/section treatments in each family. The default page interleaves families, rather than showing five near-related designs together. Search, style/layout filters, visible selection and pagination cover the entire collection. Sample gallery text never becomes candidate content when a design is selected.

The families include banner, sidebar-left/right, split header, top stripe, rail, label gutter, frame, boxed header, underline, editorial masthead and timeline. Single-column and two-column layouts are labeled. No design is advertised as a guarantee of ATS compatibility or shortlisting.

The builder keeps Resume and Matching Cover Letter in one workspace. Preparing the letter carries over the candidate's entered name, contact, facts and design; an explicit refresh protects existing unsaved letter edits. Resume Match retains its existing AI tailoring engine and now embeds a matching Cover Letter editor beneath the tailored result, seeded from the edited draft and current role/company/JD. Standalone Cover Letter creation remains available. Drafts and exports remain separate documents with their own controls.

## Rendering and compatibility

- Existing 50 presets and saved template IDs remain supported. Existing stored resumes and drafts are not replaced.
- Designed preview and PDF share a vector scene composer. PDFs contain real text; DOCX remains editable using paragraphs and real table cells where the selected design needs columns. No document is exported as a screenshot.
- Layouts paginate long content; original text is retained. PDF and Word can paginate differently. Designed columns can produce a different extracted reading order; use the single-column choices and inspect text order for automated application forms.
- Unsupported PDF-script characters receive an explicit DOCX/TXT alternative, rather than a silent failure or deletion.
- No Canva assets, logos or proprietary template files were copied. The Canva reference informed the gallery workflow; the compositions are implemented locally.
- No schema, RLS, OAuth, credentials, dependencies, pricing or billing changes. Cover Letter drafting remains deterministic with no new model calls. Auth, applications and Gmail logic are unchanged.

## Observed checks

- Resume suite: 382 passed, including 60 new PDF/DOCX content round trips and all legacy exports. All 60 letter styles preserve source text. Long-column/contact-block pagination retains final facts.
- Document/API regressions: 14 passed. Shared UI/navigation regressions: 114 passed.
- Typecheck, scoped lint and production build passed.
- Generated 60 resume and twelve representative matching-letter PDF/DOCX pairs through the actual exporters. Rendered and inspected all 73 pages in 72 PDFs; no clipping or overlap. The spacious Contour Panel sample continues onto a second page without losing its final section.
- Authenticated browser: all 60 resume designs were reached through pagination, family search returned the expected five treatments, and a Folio two-column resume was selected, customized, saved, refreshed and reopened with its design intact. Its current facts/design populated the matching-letter tab; switching documents retained the resume. A role-specific letter excluded JD-only MBA/five-year claims. Both documents were captured as actual PDF/DOCX downloads, reopened and validated; gallery sample facts were absent from the candidate outputs. The letter also reopened through the standalone tool. Browser error logs were empty.
- The gallery was inspected on desktop and at a measured 391 CSS-pixel phone width; no horizontal overflow at that phone width. Browser viewport settings are affected by local display scaling, so the measured DOM width was used rather than assuming the requested size.
- This release does not rerun a live external AI tailoring request. The existing model/provider engine is unchanged; the embedded letter receives the edited draft and role/company/JD via the existing Resume Match flow.

## Deployment

Use the existing GitHub main to Vercel production workflow after final browser checks. Preserve the rollback branch and do not force-push. Verify the actual domain after deployment; report any unverified live flows explicitly.

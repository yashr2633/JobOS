-- ============================================================================
-- Sprint 11 — JOB_OPPORTUNITY category
-- ============================================================================
--
-- A single additive migration. It widens ONE CHECK constraint so the ledger can
-- store a new classification, `JOB_OPPORTUNITY`, for mail that presents a job the
-- user MIGHT apply to (job alerts, recommendations, "you may be a match") as
-- distinct from mail evidencing an application the user actually made.
--
-- Why this is safe and KPI-neutral by construction:
--   * `JOB_OPPORTUNITY` is NOT one of the Lifecycle_Categories, so the
--     Auto_Importer's input query (`fetchLifecycleActivityForAutoImport`, which
--     filters `category IN (<lifecycle set>)`) never reads it. An opportunity can
--     therefore never create, link, or update an application, and can never reach
--     Total Applications / Applied / Interview / Offer / Rejected / Ghosted.
--   * It is not `company IS NULL` lifecycle mail, so it is never in the unknown
--     employer bucket.
--   * It carries `evidence_strength = NULL` (gate strength `none`), so it is never
--     auto-importable and never presented as a held approval.
--
-- Idempotent and non-destructive: it only drops and re-adds the named CHECK, adds
-- no column, touches no row, and can be re-run. It does NOT modify any
-- previously-applied migration.
--
-- Run once in the Supabase SQL editor.

ALTER TABLE public.gmail_activity
  DROP CONSTRAINT IF EXISTS gmail_activity_category_check;

ALTER TABLE public.gmail_activity
  ADD CONSTRAINT gmail_activity_category_check
  CHECK (category IN (
    'APPLICATION_CONFIRMATION',
    'APPLICATION_RECEIVED',
    'APPLICATION_UPDATE',
    'INTERVIEW_INVITATION',
    'INTERVIEW_UPDATE',
    'RECRUITER_CONTACT',
    'REJECTION',
    'OFFER',
    'WITHDRAWAL',
    'FOLLOW_UP',
    'JOB_OPPORTUNITY',
    'OTHER_JOB_RELATED',
    'NOT_JOB_RELATED'
  ));

-- A partial index so the dashboard's opportunity count is a cheap head request,
-- mirroring the unknown-employer index from Sprint 9.
CREATE INDEX IF NOT EXISTS idx_gmail_activity_job_opportunity
  ON public.gmail_activity(user_id, email_date DESC)
  WHERE category = 'JOB_OPPORTUNITY';

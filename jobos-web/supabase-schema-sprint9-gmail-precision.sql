-- JobOS Sprint 9 Migration: Gmail application precision
-- Run in the Supabase SQL Editor AFTER supabase-schema-sprint8-gmail-incremental.sql
--
-- FULLY ADDITIVE and IDEMPOTENT. No existing column, constraint, policy, index,
-- or trigger is altered or dropped. public.applications is not touched, and its
-- status CHECK constraint is unchanged. The gmail_activity category CHECK and
-- its UNIQUE(user_id, gmail_message_id) constraint are unchanged. RLS on every
-- existing table is unaffected — these are new nullable/defaulted columns on
-- tables that already carry owner-scoped policies. Running this file a second
-- time is a no-op.
--
-- Purpose: record WHY an email was accepted, so organization can be automatic.
--
-- Detection now runs through a deterministic evidence gate. Whether a ledger row
-- came from a lifecycle pattern that matched on its own ("strong") or from an
-- AI adjudication of ambiguous portal mail ("weak") decides whether an
-- application may be created without asking the user. That distinction cannot be
-- recomputed at read time: subject lines and bodies are deliberately never
-- persisted, so the verdict has to be stored when the email is classified.

-- ============================================================================
-- gmail_connections: which mailbox is actually connected
-- ============================================================================

ALTER TABLE public.gmail_connections
  -- Mailbox address reported by the Gmail profile endpoint at OAuth time.
  -- Nullable: capture is non-fatal, and pre-existing connections have no
  -- address until they are reconnected. Not a credential — safe to display.
  ADD COLUMN IF NOT EXISTS gmail_address TEXT;

-- ============================================================================
-- gmail_activity: the evidence verdict behind each ledger row
-- ============================================================================

ALTER TABLE public.gmail_activity
  -- 'strong' = a lifecycle pattern matched deterministically; safe to organize
  --            without confirmation.
  -- 'weak'   = portal/ATS mail that only the model could adjudicate; always
  --            held for review.
  -- NULL     = rejected mail, or a row written before this migration. NULL is
  --            read as "not strong", so legacy queue rows keep requiring
  --            review instead of being retroactively auto-imported.
  ADD COLUMN IF NOT EXISTS evidence_strength TEXT,

  -- Fixed reason code from the gate's EvidenceReason vocabulary (for example
  -- 'job_alert', 'social_notification', 'keyword_only'). Codes only — never
  -- subject, snippet, or body text.
  ADD COLUMN IF NOT EXISTS evidence_reason  TEXT;

-- Constraint added separately so re-running this migration cannot fail with
-- "constraint already exists".
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.gmail_activity'::regclass
       AND conname  = 'gmail_activity_evidence_strength_check'
  ) THEN
    ALTER TABLE public.gmail_activity
      ADD CONSTRAINT gmail_activity_evidence_strength_check
      CHECK (evidence_strength IS NULL OR evidence_strength IN ('strong', 'weak'));
  END IF;
END $$;

-- ============================================================================
-- gmail_sync_jobs: report what a scan changed, durably
-- ============================================================================

ALTER TABLE public.gmail_sync_jobs
  -- Status advances applied to already-tracked applications by this job.
  -- applications_found (already present) counts applications created; this
  -- counts the ones that moved stage. Defaulted so existing rows stay valid.
  ADD COLUMN IF NOT EXISTS applications_updated INTEGER NOT NULL DEFAULT 0;

-- ============================================================================
-- Index for the Unknown-applications bucket
-- ============================================================================
-- The bucket is a derived query, not a new table: lifecycle activity that is
-- still unlinked and whose employer could not be determined. The partial
-- predicate matches the two null conditions of that query; the lifecycle
-- category list is applied on top of the index, and user_id keeps the scan
-- owner-scoped. Narrower than idx_gmail_activity_unlinked, which stays as is.

CREATE INDEX IF NOT EXISTS idx_gmail_activity_unknown_employer
  ON public.gmail_activity(user_id, email_date DESC)
  WHERE application_id IS NULL AND company IS NULL;

-- ============================================================================
-- Verification
-- ============================================================================
-- SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'gmail_connections'
--    AND column_name = 'gmail_address';
--
-- SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'gmail_activity'
--    AND column_name IN ('evidence_strength', 'evidence_reason');
--
-- SELECT column_name, column_default, is_nullable
--   FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'gmail_sync_jobs'
--    AND column_name = 'applications_updated';
--
-- SELECT indexname FROM pg_indexes
--  WHERE schemaname = 'public' AND tablename = 'gmail_activity';
--
-- Frozen contracts still in place:
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--  WHERE conrelid = 'public.applications'::regclass AND contype = 'c';
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--  WHERE conrelid = 'public.gmail_activity'::regclass AND contype = 'c';
--
-- SELECT indexdef FROM pg_indexes
--  WHERE schemaname = 'public'
--    AND indexname = 'idx_gmail_activity_unique_message';

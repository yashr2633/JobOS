-- JobOS Sprint 7 Migration: Gmail Job Tracking ("Track My Jobs")
-- Run in the Supabase SQL Editor AFTER supabase-schema-sprint6-gmail.sql
--
-- FULLY ADDITIVE and IDEMPOTENT. This migration does not alter or drop any
-- existing column, constraint, policy, index, or trigger. In particular it does
-- NOT touch public.applications or its status CHECK constraint
-- ('Applied','Interview','Offer','Rejected','Ghosted') — Gmail evidence is
-- mapped onto those existing statuses rather than introducing a second status
-- system.
--
-- Privacy: no email body is stored anywhere in this schema. Only metadata,
-- deterministically extracted fields, and the Gmail message id (kept as
-- verifiable evidence) are persisted.

-- ============================================================================
-- 1. gmail_sync_jobs — resumable historical scan state
-- ============================================================================
-- One row per scan. page_token is the Gmail pagination cursor and is persisted
-- after every batch, which is what allows a scan to survive a closed browser,
-- a failed request, or a transient Gmail error.

CREATE TABLE IF NOT EXISTS public.gmail_sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL
    REFERENCES public.gmail_connections(id) ON DELETE CASCADE,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'paused', 'complete', 'failed')),

  -- Historical window actually scanned, so a later re-sync can widen it.
  window_start DATE NOT NULL,
  window_end DATE NOT NULL,

  -- Gmail nextPageToken. NULL once the listing is exhausted.
  page_token TEXT,

  -- Progress counters, surfaced directly in the scan UI.
  messages_seen INT NOT NULL DEFAULT 0,
  candidates INT NOT NULL DEFAULT 0,
  classified INT NOT NULL DEFAULT 0,
  applications_found INT NOT NULL DEFAULT 0,

  error TEXT,

  started_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gmail_sync_jobs_user
  ON public.gmail_sync_jobs(user_id, created_at DESC);

-- Lets the API cheaply find the one resumable job for a user, and would let a
-- future worker claim queued work without a schema change.
CREATE INDEX IF NOT EXISTS idx_gmail_sync_jobs_active
  ON public.gmail_sync_jobs(user_id, status)
  WHERE status IN ('pending', 'running', 'paused');

-- At most one unfinished scan per user. This is what prevents two concurrent
-- batch loops from racing the same page_token.
CREATE UNIQUE INDEX IF NOT EXISTS idx_gmail_sync_jobs_one_open_per_user
  ON public.gmail_sync_jobs(user_id)
  WHERE status IN ('pending', 'running', 'paused');

DROP TRIGGER IF EXISTS update_gmail_sync_jobs_updated_at ON public.gmail_sync_jobs;
CREATE TRIGGER update_gmail_sync_jobs_updated_at
  BEFORE UPDATE ON public.gmail_sync_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.gmail_sync_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own sync jobs" ON public.gmail_sync_jobs;
DROP POLICY IF EXISTS "Users can insert their own sync jobs" ON public.gmail_sync_jobs;
DROP POLICY IF EXISTS "Users can update their own sync jobs" ON public.gmail_sync_jobs;
DROP POLICY IF EXISTS "Users can delete their own sync jobs" ON public.gmail_sync_jobs;

CREATE POLICY "Users can view their own sync jobs"
  ON public.gmail_sync_jobs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own sync jobs"
  ON public.gmail_sync_jobs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own sync jobs"
  ON public.gmail_sync_jobs FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own sync jobs"
  ON public.gmail_sync_jobs FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- 2. gmail_activity — per-message evidence ledger
-- ============================================================================
-- One row per processed Gmail message. This table is both the deduplication
-- key and the audit trail that explains why an application has a given status.
--
-- application_id is nullable: a discovered message is recorded first and only
-- linked to an application after the user approves the import.

CREATE TABLE IF NOT EXISTS public.gmail_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connection_id UUID
    REFERENCES public.gmail_connections(id) ON DELETE SET NULL,

  -- Evidence pointers. The message itself is re-fetchable from Gmail; we keep
  -- only its identifiers, never its body.
  gmail_message_id TEXT NOT NULL,
  gmail_thread_id TEXT,

  application_id UUID
    REFERENCES public.applications(id) ON DELETE SET NULL,

  category TEXT NOT NULL DEFAULT 'OTHER_JOB_RELATED'
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
      'OTHER_JOB_RELATED',
      'NOT_JOB_RELATED'
    )),

  -- Extracted fields. All nullable: extraction is best-effort by design.
  company TEXT,
  job_title TEXT,
  job_url TEXT,
  location TEXT,

  email_date TIMESTAMPTZ,
  sender TEXT,
  sender_domain TEXT,

  -- Status this single message implies, if any. NULL for activity-only
  -- categories. Constrained to the EXISTING application statuses; 'Ghosted' is
  -- deliberately absent because it is derived from absence of activity and can
  -- never be implied by one message.
  inferred_status TEXT
    CHECK (inferred_status IS NULL OR inferred_status IN (
      'Applied', 'Interview', 'Offer', 'Rejected'
    )),

  confidence NUMERIC(3, 2)
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),

  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- THE idempotency guarantee: re-processing a message can never create a second
-- row, so a re-run of the scan cannot duplicate applications.
CREATE UNIQUE INDEX IF NOT EXISTS idx_gmail_activity_unique_message
  ON public.gmail_activity(user_id, gmail_message_id);

CREATE INDEX IF NOT EXISTS idx_gmail_activity_user
  ON public.gmail_activity(user_id, email_date DESC);
CREATE INDEX IF NOT EXISTS idx_gmail_activity_application
  ON public.gmail_activity(application_id, email_date DESC);
-- Thread continuity is the strongest matching signal, so it must be indexed.
CREATE INDEX IF NOT EXISTS idx_gmail_activity_thread
  ON public.gmail_activity(user_id, gmail_thread_id);
-- Serves the review screen: discovered but not yet imported.
CREATE INDEX IF NOT EXISTS idx_gmail_activity_unlinked
  ON public.gmail_activity(user_id, email_date DESC)
  WHERE application_id IS NULL;

DROP TRIGGER IF EXISTS update_gmail_activity_updated_at ON public.gmail_activity;
CREATE TRIGGER update_gmail_activity_updated_at
  BEFORE UPDATE ON public.gmail_activity
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.gmail_activity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own gmail activity" ON public.gmail_activity;
DROP POLICY IF EXISTS "Users can insert their own gmail activity" ON public.gmail_activity;
DROP POLICY IF EXISTS "Users can update their own gmail activity" ON public.gmail_activity;
DROP POLICY IF EXISTS "Users can delete their own gmail activity" ON public.gmail_activity;

CREATE POLICY "Users can view their own gmail activity"
  ON public.gmail_activity FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own gmail activity"
  ON public.gmail_activity FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own gmail activity"
  ON public.gmail_activity FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own gmail activity"
  ON public.gmail_activity FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- Verification
-- ============================================================================
-- SELECT tablename FROM pg_tables
--  WHERE schemaname = 'public'
--    AND tablename IN ('gmail_sync_jobs', 'gmail_activity');
--
-- SELECT tablename, policyname FROM pg_policies
--  WHERE schemaname = 'public'
--    AND tablename IN ('gmail_sync_jobs', 'gmail_activity')
--  ORDER BY tablename, policyname;
--
-- Confirm applications was left untouched:
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--  WHERE conrelid = 'public.applications'::regclass AND contype = 'c';

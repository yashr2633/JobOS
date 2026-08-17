-- JobOS Sprint 8 Migration: Gmail incremental synchronisation
-- Run in the Supabase SQL Editor AFTER supabase-schema-sprint7-gmail-tracking.sql
--
-- FULLY ADDITIVE and IDEMPOTENT. No existing column, constraint, policy, index,
-- or trigger is altered or dropped. public.applications is not touched, and its
-- status CHECK constraint is unchanged. RLS on every existing table is
-- unaffected — these are new nullable columns on tables that already have
-- owner-scoped policies.
--
-- Purpose: stop re-listing the entire mailbox on every sync.
--
-- Gmail provides first-class partial synchronisation: capture a mailbox-wide
-- `historyId` anchor, then ask history.list for everything added since. Without
-- a persisted anchor there is nothing to ask from, which is why every scan so
-- far has been proportional to the whole mailbox instead of to what changed.

-- ============================================================================
-- gmail_connections: incremental sync anchor
-- ============================================================================

ALTER TABLE public.gmail_connections
  -- Mailbox sequence number captured at the START of the last successful full
  -- scan. Stored as TEXT because Gmail documents historyId as an unsigned
  -- 64-bit value, which exceeds a JS number and a Postgres INT.
  ADD COLUMN IF NOT EXISTS history_id TEXT,

  -- When a full scan last completed. Absence means "never fully synced", which
  -- is what forces the first scan down the full-sync path.
  ADD COLUMN IF NOT EXISTS last_full_sync_at TIMESTAMPTZ;

-- ============================================================================
-- gmail_sync_jobs: distinguish the two sync modes
-- ============================================================================

ALTER TABLE public.gmail_sync_jobs
  -- 'full'        = query-narrowed historical scan over a date window
  -- 'incremental' = history.list since the stored anchor
  ADD COLUMN IF NOT EXISTS sync_mode TEXT NOT NULL DEFAULT 'full',

  -- Anchor this job started from ('incremental' only), and the anchor to store
  -- when it completes. Kept on the job rather than written straight to the
  -- connection so an interrupted scan cannot advance the anchor past messages
  -- it never actually processed.
  ADD COLUMN IF NOT EXISTS start_history_id TEXT,
  ADD COLUMN IF NOT EXISTS result_history_id TEXT;

-- Constraint added separately so re-running this migration cannot fail with
-- "constraint already exists".
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.gmail_sync_jobs'::regclass
       AND conname = 'gmail_sync_jobs_sync_mode_check'
  ) THEN
    ALTER TABLE public.gmail_sync_jobs
      ADD CONSTRAINT gmail_sync_jobs_sync_mode_check
      CHECK (sync_mode IN ('full', 'incremental'));
  END IF;
END $$;

-- ============================================================================
-- Verification
-- ============================================================================
-- SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'gmail_connections'
--    AND column_name IN ('history_id', 'last_full_sync_at');
--
-- SELECT column_name FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'gmail_sync_jobs'
--    AND column_name IN ('sync_mode', 'start_history_id', 'result_history_id');
--
-- Confirm applications is still untouched:
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--  WHERE conrelid = 'public.applications'::regclass AND contype = 'c';

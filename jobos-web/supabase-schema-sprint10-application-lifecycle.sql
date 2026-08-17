-- JobOS Sprint 10 Migration: Application Status Lifecycle + History
-- Run in the Supabase SQL Editor AFTER supabase-schema-sprint9-gmail-precision.sql
--
-- FULLY ADDITIVE and RE-RUNNABLE. This migration adds one table, two indexes,
-- four owner policies and one function. It does not alter, drop, or backfill
-- anything that already exists. In particular it does NOT touch
-- public.applications or its status CHECK constraint
-- ('Applied','Interview','Offer','Rejected','Ghosted') — the lifecycle is built
-- on those five existing statuses and introduces no sixth one.
--
-- No history is backfilled. An application that existed before this migration
-- simply has no recorded events until its status next changes; inventing an
-- "Applied" event from applied_date would be fabricating a timestamp we never
-- observed.
--
-- Privacy: this schema stores a status, a source code, a timestamp and an
-- optional user-written note. No email body, subject, snippet, sender, or token
-- is stored here or anywhere near here.

-- ============================================================================
-- 1. application_status_history — the recorded status trail
-- ============================================================================
-- One row per ACTUAL status change. A change that would leave the status the
-- same writes nothing (enforced in update_application_status below), so the
-- table never accumulates no-op events.
--
-- from_status is nullable on purpose: a first recorded event has no prior
-- status. It is never inferred.

CREATE TABLE IF NOT EXISTS public.application_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  application_id UUID NOT NULL
    REFERENCES public.applications(id) ON DELETE CASCADE,
  user_id UUID NOT NULL
    REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Both status columns use the SAME five values as applications.status.
  from_status TEXT
    CHECK (from_status IS NULL OR from_status IN (
      'Applied', 'Interview', 'Offer', 'Rejected', 'Ghosted'
    )),
  to_status TEXT NOT NULL
    CHECK (to_status IN (
      'Applied', 'Interview', 'Offer', 'Rejected', 'Ghosted'
    )),

  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Who set it. A closed vocabulary, never free text.
  source TEXT NOT NULL
    CHECK (source IN ('manual', 'gmail', 'system')),

  -- Optional explanation, written by the user or by a correction path.
  note TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Serves the detail view: one application's trail, newest first.
CREATE INDEX IF NOT EXISTS idx_application_status_history_application
  ON public.application_status_history(application_id, changed_at DESC);

-- Serves the dashboard's recent activity: one user's trail, newest first.
CREATE INDEX IF NOT EXISTS idx_application_status_history_user
  ON public.application_status_history(user_id, changed_at DESC);

-- ============================================================================
-- 2. Row Level Security — owner-only, never permissive
-- ============================================================================

ALTER TABLE public.application_status_history ENABLE ROW LEVEL SECURITY;

-- Guarded creation rather than DROP-then-CREATE, so re-running this file never
-- takes an existing policy away, even momentarily.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'application_status_history'
       AND policyname = 'Users can view their own status history'
  ) THEN
    CREATE POLICY "Users can view their own status history"
      ON public.application_status_history FOR SELECT
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'application_status_history'
       AND policyname = 'Users can insert their own status history'
  ) THEN
    CREATE POLICY "Users can insert their own status history"
      ON public.application_status_history FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'application_status_history'
       AND policyname = 'Users can update their own status history'
  ) THEN
    CREATE POLICY "Users can update their own status history"
      ON public.application_status_history FOR UPDATE
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'application_status_history'
       AND policyname = 'Users can delete their own status history'
  ) THEN
    CREATE POLICY "Users can delete their own status history"
      ON public.application_status_history FOR DELETE
      USING (auth.uid() = user_id);
  END IF;
END $$;

-- ============================================================================
-- 3. update_application_status — the one atomic status write
-- ============================================================================
-- Supabase JS has no client-side transaction, so the read-validate-update-append
-- sequence has to happen inside one statement or it is not atomic. Everything
-- below runs in the single implicit transaction of this function call:
--
--   lock the application row  ->  read its current status  ->  detect a no-op
--   ->  validate the transition  ->  update applications.status
--   ->  append EXACTLY ONE history row  ->  return the resulting status
--
-- SECURITY INVOKER, so the caller's RLS policies apply as the primary guard.
-- Ownership is ALSO filtered on auth.uid() explicitly inside every statement,
-- matching this codebase's convention of enforcing ownership in the statement
-- rather than relying on RLS alone.
--
-- The allowed-pair list below is the same table as FORWARD_TRANSITIONS in
-- src/lib/applications/lifecycle.ts. src/lib/applications/lifecycle.test.ts
-- reads this file and asserts the two match pair-for-pair.

CREATE OR REPLACE FUNCTION public.update_application_status(
  p_application_id UUID,
  p_status TEXT,
  p_source TEXT,
  p_note TEXT DEFAULT NULL,
  p_allow_correction BOOLEAN DEFAULT FALSE
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_current TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to change an application status.'
      USING ERRCODE = '42501';
  END IF;

  IF p_status IS NULL OR p_status NOT IN
     ('Applied', 'Interview', 'Offer', 'Rejected', 'Ghosted') THEN
    RAISE EXCEPTION 'That is not an application status.'
      USING ERRCODE = '23514';
  END IF;

  IF p_source IS NULL OR p_source NOT IN ('manual', 'gmail', 'system') THEN
    RAISE EXCEPTION 'That is not a recognised status source.'
      USING ERRCODE = '23514';
  END IF;

  -- Lock the row for the rest of this function, so two concurrent changes
  -- cannot both read the same "current" status and both append an event.
  -- Scoped to the owner in the statement, not only by RLS.
  SELECT a.status INTO v_current
    FROM public.applications AS a
   WHERE a.id = p_application_id
     AND a.user_id = v_user_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That application could not be found.'
      USING ERRCODE = '42501';
  END IF;

  -- A no-op writes nothing at all: no update, and NO history row.
  IF v_current = p_status THEN
    RETURN v_current;
  END IF;

  IF NOT p_allow_correction AND NOT EXISTS (
    SELECT 1
      FROM (VALUES
-- BEGIN ALLOWED TRANSITIONS (must match FORWARD_TRANSITIONS in src/lib/applications/lifecycle.ts)
        ('Applied', 'Interview'),
        ('Applied', 'Offer'),
        ('Applied', 'Rejected'),
        ('Applied', 'Ghosted'),
        ('Interview', 'Offer'),
        ('Interview', 'Rejected'),
        ('Interview', 'Ghosted'),
        ('Offer', 'Rejected')
-- END ALLOWED TRANSITIONS
      ) AS allowed(from_status, to_status)
     WHERE allowed.from_status = v_current
       AND allowed.to_status = p_status
  ) THEN
    RAISE EXCEPTION
      'An application that is % cannot move to %. Correct it explicitly if it was set by mistake.',
      v_current, p_status
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.applications AS a
     SET status = p_status
   WHERE a.id = p_application_id
     AND a.user_id = v_user_id;

  -- Exactly one row per actual change.
  INSERT INTO public.application_status_history (
    application_id, user_id, from_status, to_status, source, note
  ) VALUES (
    p_application_id,
    v_user_id,
    v_current,
    p_status,
    p_source,
    NULLIF(btrim(COALESCE(p_note, '')), '')
  );

  RETURN p_status;
END;
$$;

-- Callable by signed-in users only. The function itself still refuses an
-- anonymous caller, so this is the outer of two guards.
REVOKE ALL ON FUNCTION public.update_application_status(UUID, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_application_status(UUID, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;

-- ============================================================================
-- Verification
-- ============================================================================
-- SELECT tablename FROM pg_tables
--  WHERE schemaname = 'public' AND tablename = 'application_status_history';
--
-- SELECT policyname, cmd FROM pg_policies
--  WHERE schemaname = 'public' AND tablename = 'application_status_history'
--  ORDER BY policyname;
--
-- SELECT proname, prosecdef FROM pg_proc
--  WHERE proname = 'update_application_status';
--
-- Confirm the applications status constraint was left untouched:
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--  WHERE conrelid = 'public.applications'::regclass AND contype = 'c';
--
-- Confirm nothing was backfilled (expected: 0 before the first status change):
-- SELECT count(*) FROM public.application_status_history;

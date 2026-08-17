-- JobOS Sprint 6 Migration: Gmail OAuth Integration Foundation
-- Run this SQL in your Supabase SQL Editor AFTER supabase-schema-sprint5.sql
--
-- This migration is ADDITIVE and IDEMPOTENT. It does not alter or drop any
-- Sprint 4 or Sprint 5 column, policy, index, or trigger. Existing rows stay valid.

-- ============================================================================
-- 1. gmail_connections
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.gmail_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Google OAuth credentials (stored server-side, never exposed to client)
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  token_type TEXT NOT NULL DEFAULT 'Bearer',

  -- Google identity binding (using Google's stable 'sub' identifier)
  -- This ensures the same Google account used for auth is connected for Gmail
  google_sub TEXT NOT NULL,

  -- Scopes granted by the user
  scopes TEXT[] NOT NULL DEFAULT ARRAY['https://www.googleapis.com/auth/gmail.readonly'],

  -- Connection metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_sync_at TIMESTAMPTZ,

  -- Connection state
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- Upgrade path for installs created before identity binding existed.
-- CREATE TABLE IF NOT EXISTS above is a no-op on an existing table, so the
-- google_sub column has to be added explicitly. Left nullable so the migration
-- succeeds even if legacy rows exist; every write path supplies it.
ALTER TABLE public.gmail_connections
  ADD COLUMN IF NOT EXISTS google_sub TEXT;

CREATE INDEX IF NOT EXISTS idx_gmail_connections_active
  ON public.gmail_connections(user_id, is_active)
  WHERE is_active = true;

-- One connection row per JobOS user. Prevents duplicate rows, which would
-- otherwise make the connection state ambiguous and unrecoverable in the UI.
CREATE UNIQUE INDEX IF NOT EXISTS idx_gmail_connections_one_per_user
  ON public.gmail_connections(user_id);

-- A given Google identity may be actively linked to at most ONE JobOS account.
-- RLS hides other users' rows, so application code cannot detect this case;
-- this constraint is the only real enforcement point. The insert path maps the
-- resulting unique_violation (23505) onto a user-safe "already linked" error.
CREATE UNIQUE INDEX IF NOT EXISTS idx_gmail_connections_one_active_per_google_sub
  ON public.gmail_connections(google_sub)
  WHERE is_active;

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS update_gmail_connections_updated_at ON public.gmail_connections;
CREATE TRIGGER update_gmail_connections_updated_at
  BEFORE UPDATE ON public.gmail_connections
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security
ALTER TABLE public.gmail_connections ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view their own Gmail connection" ON public.gmail_connections;
DROP POLICY IF EXISTS "Users can insert their own Gmail connection" ON public.gmail_connections;
DROP POLICY IF EXISTS "Users can update their own Gmail connection" ON public.gmail_connections;
DROP POLICY IF EXISTS "Users can delete their own Gmail connection" ON public.gmail_connections;

-- Create RLS policies
CREATE POLICY "Users can view their own Gmail connection"
  ON public.gmail_connections
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own Gmail connection"
  ON public.gmail_connections
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own Gmail connection"
  ON public.gmail_connections
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own Gmail connection"
  ON public.gmail_connections
  FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- Verification
-- ============================================================================

-- SELECT * FROM pg_tables WHERE schemaname = 'public' AND tablename = 'gmail_connections';
-- SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'gmail_connections';
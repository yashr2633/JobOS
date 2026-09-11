-- JobTrackOS Analytics Migration
-- Run in Supabase SQL Editor after all existing migrations
--
-- FULLY ADDITIVE and IDEMPOTENT. Does not alter existing tables.
-- Adds founder analytics infrastructure with strict security.

-- ============================================================================
-- 1. admin_users: founder/admin authorization allowlist
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.admin_users (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS enabled, NO policies - only service role can access
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.admin_users IS 
  'Admin authorization allowlist. No RLS policies - only accessible via service role.';

-- ============================================================================
-- 2. analytics_events: activity tracking for metrics not derivable elsewhere
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Currently single event type: user_session_activity
  -- Tracks authenticated app sessions (one per user per UTC day)
  event_name TEXT NOT NULL CHECK (event_name IN ('user_session_activity')),
  
  -- Minimal safe metadata
  -- NEVER contains email content, tokens, PII, or sensitive data
  metadata JSONB,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for active user queries (most common)
CREATE INDEX IF NOT EXISTS idx_analytics_events_user_created 
  ON public.analytics_events(user_id, created_at DESC);

-- Index for aggregate metrics by event type and date
CREATE INDEX IF NOT EXISTS idx_analytics_events_name_created
  ON public.analytics_events(event_name, created_at DESC);

-- Index for daily deduplication check (user_id + UTC date)
-- Supports fast lookup for "does this user already have an event today"
CREATE INDEX IF NOT EXISTS idx_analytics_events_user_date
  ON public.analytics_events(user_id, DATE(created_at AT TIME ZONE 'UTC'))
  WHERE event_name = 'user_session_activity';

-- Unique constraint: one user_session_activity per user per UTC calendar day
-- Enforces server-side deduplication, preventing inflated metrics
CREATE UNIQUE INDEX IF NOT EXISTS idx_analytics_events_one_session_per_user_per_day
  ON public.analytics_events(user_id, DATE(created_at AT TIME ZONE 'UTC'))
  WHERE event_name = 'user_session_activity';

-- RLS: users can insert their own events, cannot read ANY events
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can insert their own events" 
  ON public.analytics_events;
  
CREATE POLICY "Users can insert their own events"
  ON public.analytics_events
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- NO SELECT policy - only service role via admin routes can read

COMMENT ON TABLE public.analytics_events IS 
  'Activity events not derivable from existing tables. Users can insert but not read. Daily deduplication enforced.';

-- ============================================================================
-- Verification Queries
-- ============================================================================

-- Check tables exist:
-- SELECT table_name FROM information_schema.tables 
--   WHERE table_schema = 'public' 
--   AND table_name IN ('admin_users', 'analytics_events');

-- Verify RLS enabled:
-- SELECT tablename, rowsecurity FROM pg_tables 
--   WHERE schemaname = 'public' 
--   AND tablename IN ('admin_users', 'analytics_events');

-- Check policies (should see only INSERT for analytics_events):
-- SELECT tablename, policyname, cmd FROM pg_policies 
--   WHERE schemaname = 'public' 
--   AND tablename = 'analytics_events';

-- Check unique constraint exists:
-- SELECT indexname, indexdef FROM pg_indexes
--   WHERE schemaname = 'public'
--   AND tablename = 'analytics_events'
--   AND indexname LIKE '%one_session%';

-- ============================================================================
-- Add First Admin (run ONCE after migration)
-- ============================================================================

-- Replace YOUR_USER_ID_HERE with your actual user_id from auth.users
-- To find your user_id:
--   SELECT id, email FROM auth.users WHERE email = 'your-email@example.com';

-- INSERT INTO public.admin_users (user_id)
-- VALUES ('YOUR_USER_ID_HERE')
-- ON CONFLICT (user_id) DO NOTHING;

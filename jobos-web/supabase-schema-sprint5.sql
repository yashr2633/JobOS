-- JobOS Sprint 5 Migration: AI Job Intelligence Layer
-- Run this SQL in your Supabase SQL Editor AFTER supabase-schema.sql
--
-- This migration is ADDITIVE and IDEMPOTENT. It does not alter or drop any
-- Sprint 4 column, policy, index, or trigger. Existing rows stay valid because
-- every new column on `applications` is nullable.
--
-- Pipeline this schema supports:
--   file/paste -> extracted_text (cached) -> parsed JSON (cached)
--                 -> deterministic scoring -> LLM interpretation
--
-- Each cache stage carries its own status column so a stage can be retried or
-- moved to a background worker without schema changes.

-- ============================================================================
-- 1. resumes
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.resumes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  label TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'paste'
    CHECK (source IN ('paste', 'upload')),

  -- Set only when source = 'upload'. Path within the private Storage bucket.
  file_name TEXT,
  file_path TEXT,

  -- Stage 1 cache: raw text extracted from the file (or pasted directly).
  extracted_text TEXT,
  extraction_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (extraction_status IN ('pending', 'complete', 'failed')),
  extraction_error TEXT,

  -- Stage 2 cache: structured resume produced by the parsing model.
  parsed JSONB,
  parsed_at TIMESTAMPTZ,
  parse_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (parse_status IN ('pending', 'complete', 'failed')),
  parse_error TEXT,

  is_default BOOLEAN NOT NULL DEFAULT false,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_resumes_user_id
  ON public.resumes(user_id);
CREATE INDEX IF NOT EXISTS idx_resumes_created_at
  ON public.resumes(created_at DESC);

-- At most one default resume per user.
CREATE UNIQUE INDEX IF NOT EXISTS idx_resumes_one_default_per_user
  ON public.resumes(user_id)
  WHERE is_default;

DROP TRIGGER IF EXISTS update_resumes_updated_at ON public.resumes;
CREATE TRIGGER update_resumes_updated_at
  BEFORE UPDATE ON public.resumes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.resumes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own resumes" ON public.resumes;
DROP POLICY IF EXISTS "Users can insert their own resumes" ON public.resumes;
DROP POLICY IF EXISTS "Users can update their own resumes" ON public.resumes;
DROP POLICY IF EXISTS "Users can delete their own resumes" ON public.resumes;

CREATE POLICY "Users can view their own resumes"
  ON public.resumes
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own resumes"
  ON public.resumes
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own resumes"
  ON public.resumes
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own resumes"
  ON public.resumes
  FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- 2. applications: additive nullable columns for the JD text + parse cache
-- ============================================================================

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS job_description TEXT,
  ADD COLUMN IF NOT EXISTS parsed_jd JSONB,
  ADD COLUMN IF NOT EXISTS parsed_jd_at TIMESTAMPTZ;

-- ============================================================================
-- 3. match_results
-- ============================================================================
-- One row per analysis run, created in 'pending' state before any heavy work
-- starts. A synchronous route handler and a future background worker drive the
-- same lifecycle, so moving processing off the request path needs no migration.

CREATE TABLE IF NOT EXISTS public.match_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  application_id UUID NOT NULL
    REFERENCES public.applications(id) ON DELETE CASCADE,
  resume_id UUID
    REFERENCES public.resumes(id) ON DELETE SET NULL,
  -- Denormalized so RLS is a single-table check with no join.
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'complete', 'failed')),
  failure_reason TEXT,

  -- Deterministic, rule-based. NULL until the run completes.
  match_score INT
    CHECK (match_score IS NULL OR (match_score >= 0 AND match_score <= 100)),
  -- Bumped whenever scoring rules change, so old scores remain interpretable.
  scoring_version INT,
  confidence TEXT
    CHECK (confidence IS NULL OR confidence IN ('low', 'medium', 'high')),
  -- Per-dimension weight/ratio/points breakdown behind the numeric score.
  score_breakdown JSONB,

  required_skills JSONB,
  preferred_skills JSONB,
  missing_required_skills JSONB,
  missing_preferred_skills JSONB,
  experience_gap JSONB,
  education_gap JSONB,

  -- LLM-authored interpretation only. Never contributes to match_score.
  ai_summary TEXT,
  recommendations JSONB,
  model TEXT,

  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_match_results_application_id
  ON public.match_results(application_id, created_at DESC);
-- Serves the per-user daily quota count.
CREATE INDEX IF NOT EXISTS idx_match_results_user_created
  ON public.match_results(user_id, created_at DESC);
-- Lets a background worker claim queued work cheaply.
CREATE INDEX IF NOT EXISTS idx_match_results_pending
  ON public.match_results(status, created_at)
  WHERE status IN ('pending', 'processing');

ALTER TABLE public.match_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own match results" ON public.match_results;
DROP POLICY IF EXISTS "Users can insert their own match results" ON public.match_results;
DROP POLICY IF EXISTS "Users can update their own match results" ON public.match_results;
DROP POLICY IF EXISTS "Users can delete their own match results" ON public.match_results;

CREATE POLICY "Users can view their own match results"
  ON public.match_results
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own match results"
  ON public.match_results
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own match results"
  ON public.match_results
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own match results"
  ON public.match_results
  FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- Verification
-- ============================================================================
-- SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'applications'
--  ORDER BY ordinal_position;
--
-- SELECT tablename, policyname FROM pg_policies
--  WHERE schemaname = 'public' AND tablename IN ('resumes', 'match_results')
--  ORDER BY tablename, policyname;

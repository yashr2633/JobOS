-- Gmail Account Identity Fix Migration
-- Fixes Gmail Accounts Tested counting by preserving immutable Gmail account identity in scan records
--
-- PROBLEM: gmail_connections has UNIQUE(user_id), so connecting a new Gmail overwrites the old one.
-- Historical scans lose their Gmail account identity when the connection row is replaced.
--
-- SOLUTION: Add google_sub directly to gmail_sync_jobs so each scan permanently retains
-- the Gmail account identity that performed it, regardless of future connection changes.

-- ============================================================================
-- 1. Add google_sub to gmail_sync_jobs
-- ============================================================================

-- Add column (nullable for backward compatibility with existing scans)
ALTER TABLE public.gmail_sync_jobs
  ADD COLUMN IF NOT EXISTS google_sub TEXT;

-- Create index for efficient Gmail account counting
CREATE INDEX IF NOT EXISTS idx_gmail_sync_jobs_google_sub
  ON public.gmail_sync_jobs(google_sub)
  WHERE status = 'complete' AND google_sub IS NOT NULL;

-- ============================================================================
-- 2. Backfill google_sub for existing scans (best effort)
-- ============================================================================

-- Backfill google_sub from current gmail_connections via connection_id
-- This recovers Gmail identity for scans whose connection still exists
UPDATE public.gmail_sync_jobs gsj
SET google_sub = gc.google_sub
FROM public.gmail_connections gc
WHERE gsj.connection_id = gc.id
  AND gsj.google_sub IS NULL
  AND gc.google_sub IS NOT NULL;

-- ============================================================================
-- 3. Add comment explaining the field
-- ============================================================================

COMMENT ON COLUMN public.gmail_sync_jobs.google_sub IS 
  'Immutable Gmail account identifier (Google sub claim) that performed this scan. '
  'Preserved permanently even if the user later connects a different Gmail account or disconnects. '
  'Used for Gmail Accounts Tested analytics metric.';

-- ============================================================================
-- Verification Queries
-- ============================================================================

-- Check backfill results:
-- SELECT 
--   COUNT(*) as total_scans,
--   COUNT(CASE WHEN google_sub IS NOT NULL THEN 1 END) as with_google_sub,
--   COUNT(CASE WHEN google_sub IS NULL THEN 1 END) as without_google_sub
-- FROM gmail_sync_jobs
-- WHERE status = 'complete';

-- Verify Gmail Accounts Tested count:
-- SELECT COUNT(DISTINCT google_sub) as gmail_accounts_tested
-- FROM gmail_sync_jobs
-- WHERE status = 'complete' AND google_sub IS NOT NULL;

-- Gmail scan recording fix: allow a completed scan to be recorded without a
-- server-side Gmail connection row.
--
-- WHY THIS IS REQUIRED (not optional):
--   public.gmail_sync_jobs.connection_id is declared
--     connection_id UUID NOT NULL REFERENCES public.gmail_connections(id)
--   (see supabase-schema-sprint7-gmail-tracking.sql).
--
--   Gmail authorization is now browser-only: the token is minted by Google
--   Identity Services in the browser and no row is ever written to
--   gmail_connections (upsertGmailConnection has no callers; /api/gmail/oauth
--   and /api/gmail/callback both return 410 Gone). So for any Gmail account
--   connected through the current flow there is NO connection row to reference,
--   and the NOT NULL + FK pair makes recording that scan impossible.
--
--   Scan identity is carried by gmail_sync_jobs.google_sub (added in
--   supabase-gmail-account-identity-fix.sql), which is the immutable Google
--   'sub' of the account that performed the scan. connection_id is now only
--   incidental provenance, so it must be nullable.
--
-- ADDITIVE and IDEMPOTENT. No column is dropped, no data is rewritten, and the
-- foreign key + ON DELETE CASCADE behaviour is left exactly as it was.

ALTER TABLE public.gmail_sync_jobs
  ALTER COLUMN connection_id DROP NOT NULL;

COMMENT ON COLUMN public.gmail_sync_jobs.connection_id IS
  'Optional provenance link to gmail_connections. NULL for browser-only scans, '
  'which hold no server-side connection row. Gmail account identity for '
  'analytics lives in google_sub, not here.';

-- ============================================================================
-- Verification
-- ============================================================================

-- Confirm the column is nullable (expect is_nullable = 'YES'):
-- SELECT column_name, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'gmail_sync_jobs'
--   AND column_name IN ('connection_id', 'google_sub');

-- After running one browser scan that finds ZERO applications, expect exactly
-- one new row, with a non-null google_sub and status 'complete':
-- SELECT id, google_sub, status, applications_found, messages_seen, created_at
-- FROM public.gmail_sync_jobs
-- ORDER BY created_at DESC
-- LIMIT 3;

-- The two analytics figures, recomputed:
-- SELECT COUNT(DISTINCT google_sub) AS gmail_accounts_tested,
--        COUNT(*)                   AS gmail_scan_attempts
-- FROM public.gmail_sync_jobs
-- WHERE status = 'complete';

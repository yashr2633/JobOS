-- JobOS Sprint 14 Migration: correct C-001 column isolation on public.gmail_connections
-- Run in the Supabase SQL Editor AFTER supabase-schema-sprint13-gmail-token-isolation.sql
--
-- WHY THIS IS NEEDED
-- ------------------
-- Sprint 13 revoked column-level SELECT on access_token/refresh_token, but the
-- `authenticated` and `anon` roles still hold TABLE-LEVEL SELECT on the table.
-- In PostgreSQL a role may read a column if it has EITHER a table-level SELECT
-- OR a column-level SELECT: the two are a union, and a column-level REVOKE
-- cannot subtract from a table-level GRANT. So while table-wide SELECT remains,
-- the token columns are still readable and the Sprint 13 revoke is ineffective.
--
-- This migration removes the table-wide SELECT from both client-facing roles and
-- re-grants SELECT on ONLY the token-free metadata columns to `authenticated`.
--
-- FULLY ADDITIVE to structure: no table/column/policy/index/trigger/constraint
-- is created, altered, or dropped. Only privileges change. Re-runnable: REVOKE
-- of an absent privilege is a no-op and re-GRANT is a no-op.
--
-- WHAT THIS DOES NOT CHANGE
-- -------------------------
--   * RLS stays enabled and all four owner policies (auth.uid() = user_id) are
--     untouched. Row visibility is unchanged; this only narrows which COLUMNS
--     the two client roles may read.
--   * service_role is untouched (it holds table privileges and BYPASSRLS), so
--     the server-only service-role client keeps full token read/write access.
--   * UPDATE/INSERT privileges are unchanged, so the non-token metadata writes
--     that still run under the authenticated client continue to work.
--   * access_token and refresh_token are deliberately NOT granted to any client
--     role. Only server code (service role) can read them.
--   * anon is deliberately NOT re-granted: no unauthenticated path reads
--     gmail_connections, and RLS already returns zero rows for anon.

-- ============================================================================
-- 1. Remove the table-wide SELECT that makes the column revoke ineffective
-- ============================================================================
REVOKE SELECT ON public.gmail_connections FROM authenticated;
REVOKE SELECT ON public.gmail_connections FROM anon;

-- ============================================================================
-- 2. Re-grant SELECT on ONLY the token-free metadata columns to authenticated
-- ============================================================================
-- This column list is EXACTLY the TOKEN_FREE_COLUMNS used by src/lib/api/gmail.ts
-- for metadata reads, and includes every column referenced in that path's
-- WHERE/ORDER BY (user_id, created_at). access_token and refresh_token are
-- intentionally excluded.
GRANT SELECT (
  id,
  user_id,
  expires_at,
  token_type,
  google_sub,
  scopes,
  gmail_address,
  is_active,
  created_at,
  updated_at,
  last_sync_at,
  history_id,
  last_full_sync_at
) ON public.gmail_connections TO authenticated;

-- ============================================================================
-- Verification (read-only; run manually after applying)
-- ============================================================================
-- Expect: `authenticated` listed only for the 13 token-free columns; NO
-- access_token / refresh_token row for authenticated or anon.
--
-- SELECT grantee, column_name, privilege_type
--   FROM information_schema.column_privileges
--  WHERE table_schema = 'public'
--    AND table_name = 'gmail_connections'
--    AND grantee IN ('authenticated', 'anon')
--  ORDER BY grantee, column_name, privilege_type;
--
-- Expect: NO table-level SELECT for authenticated or anon.
--
-- SELECT grantee, privilege_type
--   FROM information_schema.role_table_grants
--  WHERE table_schema = 'public'
--    AND table_name = 'gmail_connections'
--    AND grantee IN ('authenticated', 'anon')
--    AND privilege_type = 'SELECT';
--
-- RLS and its four owner policies must still be present and unchanged:
-- SELECT relrowsecurity FROM pg_class
--  WHERE oid = 'public.gmail_connections'::regclass;   -- expect: t
-- SELECT policyname, cmd FROM pg_policies
--  WHERE schemaname = 'public' AND tablename = 'gmail_connections'
--  ORDER BY policyname;

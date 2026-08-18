-- JobOS Sprint 13 Migration: Gmail OAuth token isolation (C-001)
-- Run in the Supabase SQL Editor AFTER supabase-schema-sprint12-application-source.sql
--
-- FULLY ADDITIVE, NON-DESTRUCTIVE and RE-RUNNABLE. No table is created, altered,
-- or dropped. No column is added, altered, or dropped. No RLS policy, index,
-- trigger, or constraint is created, altered, or dropped. Running this file a
-- second time is a no-op.
--
-- PURPOSE
-- -------
-- The browser and the Next.js server both authenticate to Supabase with the
-- same publishable/anon key, which resolves to the `authenticated` role. Under
-- that role, RLS lets a signed-in user read THEIR OWN gmail_connections row —
-- and until now that included the two OAuth secret columns, `access_token` and
-- `refresh_token`. Those columns are credentials: they must only ever be read by
-- trusted server code, never be reachable from a browser session.
--
-- This migration removes column-level SELECT on exactly those two columns from
-- the `authenticated` and `anon` roles. Server code reads the tokens through the
-- Supabase SERVICE ROLE key instead (see src/lib/supabase/admin.ts), which is
-- not subject to column grants or RLS.
--
-- WHAT THIS DOES NOT CHANGE
-- -------------------------
--   * RLS stays enabled on public.gmail_connections, and all four owner-scoped
--     policies (SELECT/INSERT/UPDATE/DELETE using auth.uid() = user_id) are
--     untouched. Row visibility is unchanged; only two COLUMNS become
--     unreadable to the two client-facing roles.
--   * No other column's SELECT is affected. The metadata the app renders
--     (gmail_address, expires_at, is_active, scopes, timestamps, history_id,
--     ...) is still readable by the owning user.
--   * UPDATE/INSERT privileges are unchanged. The disconnect path can still
--     blank the token columns; the connect/refresh paths still write them (they
--     run through the service role in application code, but nothing here revokes
--     the ability to write).

-- ============================================================================
-- Revoke column-level SELECT on the OAuth secret columns
-- ============================================================================
-- REVOKE is idempotent: revoking a privilege that is not held is a no-op, so
-- this block is safe to re-run. Column-level SELECT is revoked explicitly for
-- both client-facing roles.
--
-- Note: a plain `GRANT SELECT ON TABLE ... TO authenticated` elsewhere would
-- re-grant every column. Supabase's default grants are role-wide, so we scope
-- the revoke to the two secret columns and leave the table-level SELECT (which
-- RLS still gates row-by-row) in place for every other column.

REVOKE SELECT (access_token, refresh_token)
  ON public.gmail_connections
  FROM authenticated;

REVOKE SELECT (access_token, refresh_token)
  ON public.gmail_connections
  FROM anon;

-- ============================================================================
-- Verification (read-only; run manually after applying)
-- ============================================================================
-- Expect: NO rows mentioning access_token / refresh_token for authenticated or
-- anon. Other columns (e.g. gmail_address) should still be listed for
-- authenticated, confirming only the secrets were revoked.
--
-- SELECT grantee, column_name, privilege_type
--   FROM information_schema.column_privileges
--  WHERE table_schema = 'public'
--    AND table_name = 'gmail_connections'
--    AND grantee IN ('authenticated', 'anon')
--  ORDER BY grantee, column_name, privilege_type;
--
-- RLS and its four owner policies must still be present and unchanged:
-- SELECT relrowsecurity FROM pg_class
--  WHERE oid = 'public.gmail_connections'::regclass;   -- expect: t
-- SELECT policyname, cmd, qual, with_check FROM pg_policies
--  WHERE schemaname = 'public' AND tablename = 'gmail_connections'
--  ORDER BY policyname;

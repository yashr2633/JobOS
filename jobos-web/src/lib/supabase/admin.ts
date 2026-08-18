/**
 * Server-only Supabase service-role client.
 *
 * SERVER ONLY. This client authenticates with the Supabase SERVICE ROLE key and
 * therefore bypasses column-level grants and RLS. It exists for one narrow
 * reason: the OAuth token columns on `public.gmail_connections`
 * (`access_token`, `refresh_token`) have their column-level SELECT revoked from
 * the `authenticated` and `anon` roles (see
 * supabase-schema-sprint13-gmail-token-isolation.sql), so the ordinary
 * publishable/anon client can no longer read them back. The handful of
 * server-side functions that legitimately need those columns obtain this client
 * internally.
 *
 * Hard rules, enforced by the guard below and by the structural security tests:
 *   - The key is read from `SUPABASE_SERVICE_ROLE_KEY`, NEVER a NEXT_PUBLIC_
 *     name, so it is never inlined into the browser bundle.
 *   - This module must never be imported by a client component.
 *   - The key value is never logged.
 *   - No browser cookie session is created; the client is non-persistent and
 *     does not auto-refresh, because it represents no user — it is a privileged
 *     service actor used only for specific token-column reads/writes.
 *
 * This is NOT a general RLS bypass. Every caller keeps its existing
 * `user_id`/`id` predicates; this client only restores read access to two
 * columns the application already owned server-side.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
// Explicit .ts extension matches the convention used across lib/ (see
// lib/gmail/tokens.ts -> ../api/gmail.ts) so this module resolves under both
// the Next bundler and `node --test`.
import { SUPABASE_URL } from "./env.ts";

/** Fails fast if this module is ever pulled into a browser bundle. */
function assertServerOnly(): void {
  if (typeof window !== "undefined") {
    throw new Error(
      "lib/supabase/admin.ts is server-only and must not run in the browser."
    );
  }
}

/**
 * Read the service-role key at call time (not module load), so a missing
 * configuration surfaces as an actionable error on the exact request that needs
 * it rather than crashing unrelated server startup.
 */
function serviceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured. It is required for server-side Gmail token access."
    );
  }
  return key;
}

/**
 * Cached so repeated token reads within a process reuse one client rather than
 * constructing a new one per call.
 */
let cachedAdminClient: SupabaseClient | null = null;

/**
 * TEST-ONLY seam.
 *
 * The token read/write paths obtain their privileged client through
 * `createAdminClient()` rather than the caller's authenticated client, which is
 * exactly what stops a browser session reaching the token columns. The existing
 * in-memory Supabase fakes inject their stand-in through the client that is
 * passed to the data layer, so this override lets those harnesses point the
 * privileged client at the same fake. It is never set in production code.
 */
let testAdminClientFactory: (() => SupabaseClient) | null = null;

/** TEST-ONLY: route `createAdminClient()` at a stand-in, or `null` to reset. */
export function __setAdminClientFactoryForTests(
  factory: (() => SupabaseClient) | null
): void {
  testAdminClientFactory = factory;
  cachedAdminClient = null;
}

/**
 * The service-role Supabase client, for server-side token-column access only.
 *
 * Never returns a user-scoped session; callers MUST continue to constrain every
 * statement by `user_id`/`id` exactly as before.
 */
export function createAdminClient(): SupabaseClient {
  assertServerOnly();

  if (testAdminClientFactory) return testAdminClientFactory();

  if (cachedAdminClient) return cachedAdminClient;

  cachedAdminClient = createClient(SUPABASE_URL, serviceRoleKey(), {
    auth: {
      // No user, no cookie session, nothing to refresh: this actor is the
      // service role, not a signed-in person.
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return cachedAdminClient;
}

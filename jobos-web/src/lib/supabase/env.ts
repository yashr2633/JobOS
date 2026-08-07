/**
 * Supabase environment configuration.
 *
 * Supports both the current publishable key name (`sb_publishable_...`) and the
 * legacy anon key name so either works without touching call sites.
 *
 * These must be referenced as literal `process.env.NEXT_PUBLIC_*` expressions so
 * Next.js can inline them into the client bundle at build time.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;

export const SUPABASE_KEY = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!;

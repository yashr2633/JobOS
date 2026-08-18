/** Canonical origins used by the browser-based Supabase OAuth callbacks. */
export const PRODUCTION_APP_ORIGIN = "https://jobtrackos.vercel.app";
export const LOCAL_APP_ORIGIN = "http://localhost:3000";

/**
 * Build the Supabase Auth callback from the browser's current origin.
 *
 * The production and local origins are explicit so this policy can be tested,
 * while preview and custom domains continue to follow the browser origin. The
 * caller supplies `next` only after applying the existing same-origin path
 * guard.
 */
export function buildSupabaseOAuthCallbackUrl(
  browserOrigin: string,
  next?: string
): string {
  const parsedOrigin = new URL(browserOrigin).origin;
  const origin =
    parsedOrigin === PRODUCTION_APP_ORIGIN
      ? PRODUCTION_APP_ORIGIN
      : parsedOrigin === LOCAL_APP_ORIGIN
        ? LOCAL_APP_ORIGIN
        : parsedOrigin;
  const callbackUrl = new URL("/auth/callback", origin);

  if (next !== undefined) callbackUrl.searchParams.set("next", next);
  return callbackUrl.toString();
}

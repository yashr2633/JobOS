import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_KEY, SUPABASE_URL } from "./env";

/** Prefixes that own their own auth handling and must never be redirected. */
const PASSTHROUGH_PREFIXES = ["/auth", "/api"];

/**
 * Pages that require a session.
 *
 * This list covers every still-reachable page, NOT only the ones in the sidebar.
 * `/resume-match` is now reached from inside `/resumes`, and `/track-my-jobs` is
 * a secondary detail route linked from the dashboard's scan module, so neither
 * appears in primary navigation — and both must still refuse an anonymous
 * visitor. Dropping an unlisted route from here would turn a navigation change
 * into an auth hole.
 */
const PROTECTED_PREFIXES = [
  "/applications",
  "/resume-match",
  "/resumes",
  "/settings",
  "/track-my-jobs",
];

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        supabaseResponse = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // IMPORTANT: Avoid writing any logic between createServerClient and
  // supabase.auth.getUser(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Route handlers under /auth and /api authenticate themselves and return
  // their own responses. Redirecting them here would answer API calls with
  // login HTML and would intercept the code-exchange endpoint itself.
  if (PASSTHROUGH_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return supabaseResponse;
  }

  const isAuthPage =
    pathname.startsWith("/login") || pathname.startsWith("/signup");
  const isProtectedPage =
    pathname === "/" ||
    PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  if (isProtectedPage && !user) {
    // A Supabase OAuth code can land on a page instead of /auth/callback when
    // the dashboard's Redirect URLs allow-list does not contain the callback
    // URL, in which case Supabase falls back to the Site URL. Hand the code to
    // the canonical exchange route instead of dropping it and bouncing to
    // login, which is indistinguishable from "login silently failed".
    const code = request.nextUrl.searchParams.get("code");
    if (code) {
      const exchangeUrl = request.nextUrl.clone();
      exchangeUrl.pathname = "/auth/callback";
      exchangeUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(exchangeUrl);
    }

    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    // Preserve the destination so the user resumes where they were headed.
    if (pathname !== "/") {
      loginUrl.searchParams.set("next", pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  if (isAuthPage && user) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildSupabaseOAuthCallbackUrl,
  LOCAL_APP_ORIGIN,
  PRODUCTION_APP_ORIGIN,
} from "./oauthRedirect.ts";

test("Google production callback uses the canonical production origin", () => {
  assert.equal(
    buildSupabaseOAuthCallbackUrl(PRODUCTION_APP_ORIGIN, "/applications"),
    "https://jobtrackos.vercel.app/auth/callback?next=%2Fapplications"
  );
});

test("Google local callback preserves the localhost origin", () => {
  assert.equal(
    buildSupabaseOAuthCallbackUrl(LOCAL_APP_ORIGIN),
    "http://localhost:3000/auth/callback"
  );
});

test("OAuth source guard keeps localhost out of the Supabase production path", () => {
  const read = (relativePath: string): string =>
    readFileSync(join(process.cwd(), relativePath), "utf8");
  const gmailOAuth = read("src/lib/gmail/oauth.ts");
  const login = read("src/app/(auth)/login/LoginForm.tsx");
  const signup = read("src/app/(auth)/signup/page.tsx");

  assert.match(gmailOAuth, /VERCEL_ENV\s*===\s*["']production["']/);
  assert.match(gmailOAuth, /https:\/\/jobtrackos\.vercel\.app\/api\/gmail\/callback/);
  assert.doesNotMatch(login, /localhost/);
  assert.doesNotMatch(signup, /localhost/);
  assert.match(login, /buildSupabaseOAuthCallbackUrl/);
  assert.match(signup, /buildSupabaseOAuthCallbackUrl/);
});

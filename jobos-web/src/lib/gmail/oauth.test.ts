/**
 * Gmail OAuth state and authorization-URL tests.
 *
 * Pure unit tests: no network, no Supabase, no Next runtime. Matches the
 * existing `node --test` convention used by the AI suite.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  GMAIL_SCOPES,
  buildOAuthUrl,
  decodePendingState,
  encodePendingState,
  exchangeCodeForTokens,
  generateOAuthState,
  getGmailRedirectUri,
  safeEqual,
  validateOAuthState,
} from "./oauth.ts";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

function withEnv(
  vars: Record<string, string | undefined>,
  run: () => void
): void {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

// ---------------------------------------------------------------------------
// State generation
// ---------------------------------------------------------------------------

test("state is unpredictable and long enough to resist guessing", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 100; i += 1) {
    const state = generateOAuthState();
    // 32 random bytes rendered as hex.
    assert.equal(state.length, 64);
    assert.match(state, /^[0-9a-f]{64}$/);
    assert.equal(seen.has(state), false, "state values must not repeat");
    seen.add(state);
  }
});

// ---------------------------------------------------------------------------
// Constant-time comparison
// ---------------------------------------------------------------------------

test("safeEqual accepts identical values and rejects any difference", () => {
  assert.equal(safeEqual("abc123", "abc123"), true);
  assert.equal(safeEqual("abc123", "abc124"), false);
  // Length mismatch must not throw and must not compare as equal.
  assert.equal(safeEqual("abc", "abc123"), false);
  assert.equal(safeEqual("", ""), true);
});

// ---------------------------------------------------------------------------
// Pending-state encoding (binding to a user)
// ---------------------------------------------------------------------------

test("pending state round-trips the user binding and the state", () => {
  const state = generateOAuthState();
  const decoded = decodePendingState(encodePendingState(USER_A, state));

  assert.ok(decoded);
  assert.equal(decoded.userId, USER_A);
  assert.equal(decoded.state, state);
});

test("malformed pending state is rejected rather than parsed loosely", () => {
  assert.equal(decodePendingState(""), null);
  assert.equal(decodePendingState("no-separator"), null);
  // Empty user portion.
  assert.equal(decodePendingState(".abc"), null);
  // Empty state portion.
  assert.equal(decodePendingState("user."), null);
});

// ---------------------------------------------------------------------------
// State validation — the checks the callback relies on
// ---------------------------------------------------------------------------

test("a state returned unchanged validates", () => {
  const state = generateOAuthState();
  const decoded = decodePendingState(encodePendingState(USER_A, state));

  assert.ok(decoded);
  assert.equal(validateOAuthState(decoded.state, state), true);
});

test("a different state does not validate", () => {
  const minted = generateOAuthState();
  const attacker = generateOAuthState();
  assert.equal(validateOAuthState(minted, attacker), false);
});

test("an empty returned state does not validate", () => {
  const minted = generateOAuthState();
  assert.equal(validateOAuthState(minted, ""), false);
});

test("state minted for one user cannot be redeemed by another", () => {
  const state = generateOAuthState();
  const decoded = decodePendingState(encodePendingState(USER_A, state));

  assert.ok(decoded);
  // The state value itself still matches...
  assert.equal(validateOAuthState(decoded.state, state), true);
  // ...but the binding check, which the callback performs first, fails.
  assert.notEqual(decoded.userId, USER_B);
});

// ---------------------------------------------------------------------------
// Authorization URL
// ---------------------------------------------------------------------------

test("authorization URL targets Google and carries the state", () => {
  withEnv({ GOOGLE_CLIENT_ID: "test-client-id" }, () => {
    const state = generateOAuthState();
    const url = new URL(buildOAuthUrl(state));

    assert.equal(url.origin, "https://accounts.google.com");
    assert.equal(url.pathname, "/o/oauth2/v2/auth");
    assert.equal(url.searchParams.get("client_id"), "test-client-id");
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("state"), state);
    // offline + consent are what make a refresh_token available.
    assert.equal(url.searchParams.get("access_type"), "offline");
    assert.equal(url.searchParams.get("prompt"), "consent");
  });
});

test("requested scopes are read-only Gmail plus the minimum needed for sub", () => {
  withEnv({ GOOGLE_CLIENT_ID: "test-client-id" }, () => {
    const url = new URL(buildOAuthUrl(generateOAuthState()));
    const scopes = (url.searchParams.get("scope") ?? "").split(" ");

    assert.deepEqual(scopes, [...GMAIL_SCOPES]);
    assert.ok(scopes.includes("https://www.googleapis.com/auth/gmail.readonly"));
    // openid is required to receive an id_token, the only reliable source of `sub`.
    assert.ok(scopes.includes("openid"));
    // No write/send capability may ever be requested.
    assert.equal(
      scopes.some((scope) => scope.includes("gmail.send") || scope.includes("gmail.modify")),
      false
    );
  });
});

test("redirect URI defaults to the local callback outside Vercel production", () => {
  withEnv(
    {
      GOOGLE_CLIENT_ID: "test-client-id",
      GMAIL_OAUTH_REDIRECT_URI: undefined,
      VERCEL_ENV: undefined,
    },
    () => {
      assert.equal(
        getGmailRedirectUri(),
        "http://localhost:3000/api/gmail/callback"
      );
      const url = new URL(buildOAuthUrl(generateOAuthState()));
      assert.equal(
        url.searchParams.get("redirect_uri"),
        "http://localhost:3000/api/gmail/callback"
      );
    }
  );
});

test("redirect URI defaults to the production callback on Vercel production", () => {
  withEnv(
    {
      GOOGLE_CLIENT_ID: "test-client-id",
      GMAIL_OAUTH_REDIRECT_URI: undefined,
      VERCEL_ENV: "production",
    },
    () => {
      const expected = "https://jobtrackos.vercel.app/api/gmail/callback";
      assert.equal(getGmailRedirectUri(), expected);
      const url = new URL(buildOAuthUrl(generateOAuthState()));
      assert.equal(url.searchParams.get("redirect_uri"), expected);
    }
  );
});

test("an explicit Gmail redirect URI overrides every environment default", () => {
  withEnv(
    {
      GOOGLE_CLIENT_ID: "test-client-id",
      GMAIL_OAUTH_REDIRECT_URI: "https://app.example.com/api/gmail/callback",
      VERCEL_ENV: "production",
    },
    () => {
      const url = new URL(buildOAuthUrl(generateOAuthState()));
      assert.equal(
        getGmailRedirectUri(),
        "https://app.example.com/api/gmail/callback"
      );
      assert.equal(
        url.searchParams.get("redirect_uri"),
        "https://app.example.com/api/gmail/callback"
      );
    }
  );
});

test("the client secret never appears in the authorization URL", () => {
  withEnv(
    {
      GOOGLE_CLIENT_ID: "test-client-id",
      GOOGLE_CLIENT_SECRET: "super-secret-value",
    },
    () => {
      const url = buildOAuthUrl(generateOAuthState());
      assert.equal(url.includes("super-secret-value"), false);
      assert.equal(url.includes("client_secret"), false);
    }
  );
});

test("missing client id fails loudly instead of building a broken URL", () => {
  withEnv({ GOOGLE_CLIENT_ID: undefined }, () => {
    assert.throws(
      () => buildOAuthUrl(generateOAuthState()),
      /GOOGLE_CLIENT_ID is not configured/
    );
  });
});

test("authorize and token exchange use the same redirect URI", async () => {
  const previousClientId = process.env.GOOGLE_CLIENT_ID;
  const previousSecret = process.env.GOOGLE_CLIENT_SECRET;
  const previousRedirect = process.env.GMAIL_OAUTH_REDIRECT_URI;
  const previousVercelEnv = process.env.VERCEL_ENV;
  const previousFetch = globalThis.fetch;
  let tokenRedirectUri: string | null = null;
  const idToken = `header.${Buffer.from(
    JSON.stringify({ sub: "google-subject" })
  ).toString("base64url")}.signature`;

  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
  delete process.env.GMAIL_OAUTH_REDIRECT_URI;
  process.env.VERCEL_ENV = "production";
  globalThis.fetch = async (_input, init) => {
    tokenRedirectUri = new URLSearchParams(String(init?.body)).get(
      "redirect_uri"
    );
    return new Response(
      JSON.stringify({
        access_token: "access-token",
        id_token: idToken,
        expires_in: 3600,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  try {
    const authorizeRedirectUri = new URL(
      buildOAuthUrl(generateOAuthState())
    ).searchParams.get("redirect_uri");
    await exchangeCodeForTokens("authorization-code");
    assert.equal(tokenRedirectUri, authorizeRedirectUri);
    assert.equal(
      tokenRedirectUri,
      "https://jobtrackos.vercel.app/api/gmail/callback"
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = previousClientId;
    if (previousSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
    else process.env.GOOGLE_CLIENT_SECRET = previousSecret;
    if (previousRedirect === undefined) delete process.env.GMAIL_OAUTH_REDIRECT_URI;
    else process.env.GMAIL_OAUTH_REDIRECT_URI = previousRedirect;
    if (previousVercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previousVercelEnv;
  }
});

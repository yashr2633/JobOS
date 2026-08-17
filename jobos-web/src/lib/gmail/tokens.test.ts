/**
 * Gmail token lifecycle tests.
 *
 * Network is stubbed; no Supabase involvement. Follows the existing
 * `node --test` + `assert/strict` convention used by the AI suite.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  GmailReconnectRequiredError,
  TOKEN_EXPIRY_SKEW_MS,
  refreshAccessToken,
  shouldRefresh,
} from "./tokens.ts";

const realFetch = globalThis.fetch;

function stubFetch(
  handler: (url: string, init?: RequestInit) => Promise<Response>
): void {
  globalThis.fetch = ((input: unknown, init?: RequestInit) =>
    handler(String(input), init)) as typeof fetch;
}

function restoreFetch(): void {
  globalThis.fetch = realFetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function withGoogleEnv(run: () => Promise<void>): Promise<void> {
  const prevId = process.env.GOOGLE_CLIENT_ID;
  const prevSecret = process.env.GOOGLE_CLIENT_SECRET;
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";

  return run().finally(() => {
    if (prevId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = prevId;
    if (prevSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
    else process.env.GOOGLE_CLIENT_SECRET = prevSecret;
    restoreFetch();
  });
}

// ---------------------------------------------------------------------------
// Skew boundary — when is a refresh actually needed
// ---------------------------------------------------------------------------

test("a comfortably valid token is reused, not refreshed", () => {
  const now = Date.now();
  const expiresAt = new Date(now + 30 * 60 * 1000).toISOString();
  assert.equal(shouldRefresh(expiresAt, now), false);
});

test("a token expiring inside the skew window is refreshed", () => {
  const now = Date.now();
  // Two minutes out, inside the five-minute skew.
  const expiresAt = new Date(now + 2 * 60 * 1000).toISOString();
  assert.equal(shouldRefresh(expiresAt, now), true);
});

test("the skew boundary itself refreshes rather than gambling", () => {
  const now = Date.now();
  const expiresAt = new Date(now + TOKEN_EXPIRY_SKEW_MS).toISOString();
  assert.equal(shouldRefresh(expiresAt, now), true);
});

test("an already-expired token is refreshed", () => {
  const now = Date.now();
  const expiresAt = new Date(now - 1000).toISOString();
  assert.equal(shouldRefresh(expiresAt, now), true);
});

test("a missing or unparseable expiry fails safe by refreshing", () => {
  assert.equal(shouldRefresh(null), true);
  assert.equal(shouldRefresh(""), true);
  assert.equal(shouldRefresh("not-a-date"), true);
});

// ---------------------------------------------------------------------------
// Refresh exchange
// ---------------------------------------------------------------------------

test("refresh uses grant_type=refresh_token and returns a new access token", async () => {
  await withGoogleEnv(async () => {
    let seenUrl = "";
    let seenBody = "";

    stubFetch(async (url, init) => {
      seenUrl = url;
      seenBody = String(init?.body ?? "");
      return jsonResponse({ access_token: "new-access", expires_in: 3600 });
    });

    const result = await refreshAccessToken("stored-refresh-token");

    assert.equal(seenUrl, "https://oauth2.googleapis.com/token");
    assert.ok(seenBody.includes("grant_type=refresh_token"));
    assert.ok(seenBody.includes("refresh_token=stored-refresh-token"));
    assert.equal(result.accessToken, "new-access");
    assert.ok(Date.parse(result.expiresAt) > Date.now());
  });
});

test("refresh preserves the stored refresh token when Google omits one", async () => {
  await withGoogleEnv(async () => {
    stubFetch(async () =>
      // Google normally returns no refresh_token on refresh.
      jsonResponse({ access_token: "new-access", expires_in: 3600 })
    );

    const result = await refreshAccessToken("stored-refresh-token");

    // null is the signal for "keep what is stored" — never an empty string,
    // which would overwrite and permanently break the connection.
    assert.equal(result.refreshToken, null);
  });
});

test("a rotated refresh token is returned when Google supplies one", async () => {
  await withGoogleEnv(async () => {
    stubFetch(async () =>
      jsonResponse({
        access_token: "new-access",
        refresh_token: "rotated-refresh",
        expires_in: 3600,
      })
    );

    const result = await refreshAccessToken("stored-refresh-token");
    assert.equal(result.refreshToken, "rotated-refresh");
  });
});

test("invalid_grant is terminal and demands reconnection", async () => {
  await withGoogleEnv(async () => {
    stubFetch(async () =>
      jsonResponse(
        { error: "invalid_grant", error_description: "Token has been expired or revoked." },
        400
      )
    );

    await assert.rejects(
      () => refreshAccessToken("revoked-token"),
      GmailReconnectRequiredError
    );
  });
});

test("an empty refresh token is rejected without a network call", async () => {
  await withGoogleEnv(async () => {
    let called = false;
    stubFetch(async () => {
      called = true;
      return jsonResponse({});
    });

    await assert.rejects(
      () => refreshAccessToken(""),
      GmailReconnectRequiredError
    );
    assert.equal(called, false);
  });
});

test("a transient 5xx is a retryable error, not a reconnect demand", async () => {
  await withGoogleEnv(async () => {
    stubFetch(async () => jsonResponse({ error: "backend_error" }, 503));

    await assert.rejects(
      () => refreshAccessToken("stored-refresh-token"),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error instanceof GmailReconnectRequiredError, false);
        return true;
      }
    );
  });
});

test("refresh failures never echo the token or response body", async () => {
  await withGoogleEnv(async () => {
    const secret = "SENSITIVE-REFRESH-TOKEN-VALUE";
    stubFetch(async () =>
      jsonResponse({ error: "backend_error", error_description: secret }, 500)
    );

    await assert.rejects(
      () => refreshAccessToken(secret),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message.includes(secret), false);
        return true;
      }
    );
  });
});

test("a malformed success body is rejected rather than cached", async () => {
  await withGoogleEnv(async () => {
    stubFetch(async () => jsonResponse({ expires_in: 3600 }));

    await assert.rejects(
      () => refreshAccessToken("stored-refresh-token"),
      /no access_token/
    );
  });
});

test("missing Google credentials fail loudly before any network call", async () => {
  const prevId = process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_ID;

  let called = false;
  stubFetch(async () => {
    called = true;
    return jsonResponse({});
  });

  try {
    await assert.rejects(
      () => refreshAccessToken("stored-refresh-token"),
      /credentials are not configured/
    );
    assert.equal(called, false);
  } finally {
    if (prevId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = prevId;
    restoreFetch();
  }
});

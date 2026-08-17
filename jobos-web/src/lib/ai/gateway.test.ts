/**
 * AI gateway + provider tests.
 *
 * Every network call is intercepted, so these run with zero network access and
 * no real API keys. No provider is ever contacted for real here.
 *
 * Run with:  npm run test:ai
 */

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  generateStructured,
  AiGatewayError,
  __clearInFlightForTests,
  type AiGatewayResult,
} from "./gateway.ts";
import { getAiConfig, listKnownProviderNames } from "./config.ts";
import { geminiProvider } from "./providers/gemini.ts";
import { groqProvider } from "./providers/groq.ts";
import { openRouterProvider } from "./providers/openrouter.ts";
import { AiProviderError, type AiTaskKind } from "./providers/types.ts";
import { classifyHttpFailure, parseJsonFromModelText } from "./providers/shared.ts";
import type { ValidationResult } from "./schemas.ts";

// ---------------------------------------------------------------------------
// Fetch stubbing
// ---------------------------------------------------------------------------

type Handler = (url: string, init?: RequestInit) => Promise<Response>;

let handler: Handler | null = null;
const originalFetch = globalThis.fetch;

before(() => {
  globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
    if (handler) return handler(String(url), init);
    return originalFetch(url, init);
  };
});

after(() => {
  globalThis.fetch = originalFetch;
});

/** Env keys this suite manipulates, restored between tests. */
const MANAGED_ENV = [
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "OPENROUTER_API_KEY",
  "ANTHROPIC_API_KEY",
  "AI_PRIMARY_PROVIDER",
  "AI_FALLBACK_PROVIDERS",
  "AI_ENABLE_ANTHROPIC",
  "AI_MAX_RETRIES",
  "AI_REQUEST_TIMEOUT_MS",
  "GEMINI_DEEP_MODEL",
  "GEMINI_LIGHT_MODEL",
  "GROQ_MODEL",
  "OPENROUTER_MODEL",
] as const;

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of MANAGED_ENV) savedEnv[key] = process.env[key];
  // Clean slate: no providers configured, no retries (keeps tests fast).
  for (const key of MANAGED_ENV) delete process.env[key];
  process.env.AI_MAX_RETRIES = "0";
  handler = null;
  __clearInFlightForTests();
});

after(() => {
  for (const key of MANAGED_ENV) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

// ---------------------------------------------------------------------------
// Response builders
// ---------------------------------------------------------------------------

function geminiOk(payload: unknown): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

function openAiOk(payload: unknown): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(payload) } }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isGemini(url: string): boolean {
  return url.includes("generativelanguage.googleapis.com");
}
function isGroq(url: string): boolean {
  return url.includes("api.groq.com");
}
function isOpenRouter(url: string): boolean {
  return url.includes("openrouter.ai");
}

/** Accepts any object with a `skills` array — a stand-in strict schema. */
function validateSkills(raw: unknown): ValidationResult<{ skills: string[] }> {
  if (
    typeof raw === "object" &&
    raw !== null &&
    Array.isArray((raw as { skills?: unknown }).skills)
  ) {
    return { ok: true, value: raw as { skills: string[] } };
  }
  return { ok: false, error: "missing skills array" };
}

let uniqueCounter = 0;
/** Distinct content per call so the dedup cache never masks a test. */
function uniqueContent(): string {
  uniqueCounter += 1;
  return `payload-${uniqueCounter}`;
}

interface RunOverrides {
  task?: AiTaskKind;
  timeoutMs?: number;
  maxTokens?: number;
  userContent?: string;
  label?: string;
}

/** Typed wrapper so `result.value` keeps its schema type in assertions. */
function run(
  overrides: RunOverrides = {}
): Promise<AiGatewayResult<{ skills: string[] }>> {
  return generateStructured<{ skills: string[] }>({
    systemPrompt: "system",
    userContent: overrides.userContent ?? uniqueContent(),
    task: overrides.task ?? "lightweight",
    validate: validateSkills,
    label: overrides.label ?? "test_task",
    timeoutMs: overrides.timeoutMs,
    maxTokens: overrides.maxTokens,
  });
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

test("default provider chain is gemini → groq → openrouter and excludes anthropic", () => {
  const config = getAiConfig();
  assert.deepEqual(
    config.chain.map((p) => p.id),
    ["gemini", "groq", "openrouter"]
  );
});

test("anthropic joins the chain only when explicitly enabled", () => {
  process.env.AI_ENABLE_ANTHROPIC = "true";
  process.env.AI_FALLBACK_PROVIDERS = "groq,anthropic";

  const config = getAiConfig();
  assert.deepEqual(
    config.chain.map((p) => p.id),
    ["gemini", "groq", "anthropic"]
  );
});

test("provider order is configurable without code changes", () => {
  process.env.AI_PRIMARY_PROVIDER = "groq";
  process.env.AI_FALLBACK_PROVIDERS = "openrouter";

  assert.deepEqual(
    getAiConfig().chain.map((p) => p.id),
    ["groq", "openrouter"]
  );
});

test("unknown provider names are skipped rather than throwing", () => {
  process.env.AI_PRIMARY_PROVIDER = "does-not-exist";
  process.env.AI_FALLBACK_PROVIDERS = "groq";

  assert.deepEqual(
    getAiConfig().chain.map((p) => p.id),
    ["groq"]
  );
});

test("retry and timeout settings are clamped to safe bounds", () => {
  process.env.AI_MAX_RETRIES = "99";
  process.env.AI_REQUEST_TIMEOUT_MS = "1";
  const config = getAiConfig();
  assert.equal(config.maxRetries, 1, "out-of-range retries fall back to default");
  assert.equal(config.timeoutMs, 20_000, "out-of-range timeout falls back to default");
});

test("registry exposes all four providers for future expansion", () => {
  const names = listKnownProviderNames().sort();
  assert.deepEqual(names, ["anthropic", "gemini", "groq", "openrouter"]);
});

// ---------------------------------------------------------------------------
// Model IDs (verified live against each provider's model listing)
// ---------------------------------------------------------------------------

test("gemini uses flash for deep work and flash-lite for lightweight work", () => {
  assert.equal(geminiProvider.modelFor("deep"), "gemini-2.5-flash");
  assert.equal(geminiProvider.modelFor("lightweight"), "gemini-2.5-flash-lite");
});

test("groq and openrouter use their verified model ids", () => {
  assert.equal(groqProvider.modelFor("deep"), "openai/gpt-oss-120b");
  assert.equal(openRouterProvider.modelFor("deep"), "openrouter/free");
});

test("model ids are overridable via env", () => {
  process.env.GEMINI_DEEP_MODEL = "gemini-custom";
  assert.equal(geminiProvider.modelFor("deep"), "gemini-custom");
});

// ---------------------------------------------------------------------------
// isConfigured / missing keys
// ---------------------------------------------------------------------------

test("providers report unconfigured when their key is absent", () => {
  assert.equal(geminiProvider.isConfigured(), false);
  assert.equal(groqProvider.isConfigured(), false);
  assert.equal(openRouterProvider.isConfigured(), false);

  process.env.GEMINI_API_KEY = "test-key";
  assert.equal(geminiProvider.isConfigured(), true);
});

test("missing key throws unconfigured without making a network call", async () => {
  let called = false;
  handler = async () => {
    called = true;
    return geminiOk({ skills: [] });
  };

  await assert.rejects(
    () => geminiProvider.generateJson({
      systemPrompt: "s",
      userContent: "u",
      task: "lightweight",
      maxTokens: 100,
      timeoutMs: 1000,
    }),
    (err: unknown) => {
      assert.ok(err instanceof AiProviderError);
      assert.equal(err.category, "unconfigured");
      return true;
    }
  );

  assert.equal(called, false, "must not call the network without a key");
});

test("gateway skips unconfigured providers and uses the first available one", async () => {
  // Only Groq has a key; Gemini should be skipped without a request.
  process.env.GROQ_API_KEY = "groq-key";

  let geminiCalls = 0;
  handler = async (url) => {
    if (isGemini(url)) {
      geminiCalls += 1;
      return geminiOk({ skills: ["should-not-be-used"] });
    }
    if (isGroq(url)) return openAiOk({ skills: ["Go"] });
    return errorResponse(500, "unexpected");
  };

  const result = await run();

  assert.equal(geminiCalls, 0, "unconfigured provider must not be called");
  assert.equal(result.providerId, "groq");
  assert.deepEqual(result.value.skills, ["Go"]);
  assert.equal(result.usedFallback, true);
});

test("gateway throws unconfigured when no provider has a key", async () => {
  await assert.rejects(
    () => run(),
    (err: unknown) => {
      assert.ok(err instanceof AiGatewayError);
      assert.equal(err.category, "unconfigured");
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// Happy path + normalized response
// ---------------------------------------------------------------------------

test("primary provider success returns a normalized result", async () => {
  process.env.GEMINI_API_KEY = "gemini-key";
  handler = async (url) =>
    isGemini(url) ? geminiOk({ skills: ["TypeScript"] }) : errorResponse(500, "nope");

  const result = await run();

  assert.deepEqual(result.value.skills, ["TypeScript"]);
  assert.equal(result.providerId, "gemini");
  assert.equal(result.model, "gemini-2.5-flash-lite");
  assert.equal(result.usedFallback, false);
  assert.ok(result.requestId.length > 0, "request id present for tracing");
  assert.ok(typeof result.durationMs === "number");
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].ok, true);
});

test("deep task selects the deep model tier", async () => {
  process.env.GEMINI_API_KEY = "gemini-key";
  handler = async () => geminiOk({ skills: ["x"] });

  const result = await run({ task: "deep" });
  assert.equal(result.model, "gemini-2.5-flash");
});

test("gemini requests JSON mode and sends the key as a header, not a query param", async () => {
  process.env.GEMINI_API_KEY = "secret-key";
  let seenUrl = "";
  let seenHeaders: Record<string, string> = {};
  let seenBody: { generationConfig?: { responseMimeType?: string } } = {};

  handler = async (url, init) => {
    seenUrl = url;
    seenHeaders = (init?.headers ?? {}) as Record<string, string>;
    seenBody = JSON.parse(String(init?.body));
    return geminiOk({ skills: ["a"] });
  };

  await run();

  assert.ok(!seenUrl.includes("secret-key"), "key must not appear in the URL");
  assert.equal(seenHeaders["x-goog-api-key"], "secret-key");
  assert.equal(seenBody.generationConfig?.responseMimeType, "application/json");
});

// ---------------------------------------------------------------------------
// Fallback behaviour
// ---------------------------------------------------------------------------

test("429 on the primary fails over to the next provider", async () => {
  process.env.GEMINI_API_KEY = "g";
  process.env.GROQ_API_KEY = "q";

  handler = async (url) => {
    if (isGemini(url)) return errorResponse(429, "rate limit exceeded");
    if (isGroq(url)) return openAiOk({ skills: ["Rust"] });
    return errorResponse(500, "unexpected");
  };

  const result = await run();

  assert.equal(result.providerId, "groq");
  assert.equal(result.usedFallback, true);
  assert.equal(result.attempts[0].category, "rate_limit");
});

test("provider outage (5xx) fails over to the next provider", async () => {
  process.env.GEMINI_API_KEY = "g";
  process.env.GROQ_API_KEY = "q";

  handler = async (url) => {
    if (isGemini(url)) return errorResponse(503, "service unavailable");
    if (isGroq(url)) return openAiOk({ skills: ["Java"] });
    return errorResponse(500, "unexpected");
  };

  const result = await run();
  assert.equal(result.providerId, "groq");
});

test("falls through two providers to the last fallback", async () => {
  process.env.GEMINI_API_KEY = "g";
  process.env.GROQ_API_KEY = "q";
  process.env.OPENROUTER_API_KEY = "o";

  handler = async (url) => {
    if (isGemini(url)) return errorResponse(500, "boom");
    if (isGroq(url)) return errorResponse(429, "slow down");
    if (isOpenRouter(url)) return openAiOk({ skills: ["Kotlin"] });
    return errorResponse(500, "unexpected");
  };

  const result = await run();

  assert.equal(result.providerId, "openrouter");
  assert.equal(result.model, "openrouter/free");
  assert.equal(result.attempts.length, 3);
});

test("gateway reports the most actionable category when all providers fail", async () => {
  process.env.GEMINI_API_KEY = "g";
  process.env.GROQ_API_KEY = "q";

  handler = async (url) => {
    // Billing outranks a plain outage in the reported category.
    if (isGemini(url)) return errorResponse(500, "transient");
    if (isGroq(url)) return errorResponse(402, "insufficient credits");
    return errorResponse(500, "unexpected");
  };

  await assert.rejects(
    () => run(),
    (err: unknown) => {
      assert.ok(err instanceof AiGatewayError);
      assert.equal(err.category, "billing");
      // gemini (unavailable) + groq (billing) + openrouter (unconfigured,
      // recorded without a network call since no key is set).
      assert.equal(err.attempts.length, 3);
      assert.deepEqual(
        err.attempts.map((a) => a.category),
        ["unavailable", "billing", "unconfigured"]
      );
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// Permanent failures must not be retried
// ---------------------------------------------------------------------------

test("auth failure is not retried on the same provider", async () => {
  process.env.AI_MAX_RETRIES = "2";
  process.env.GEMINI_API_KEY = "bad";
  process.env.GROQ_API_KEY = "q";

  let geminiCalls = 0;
  handler = async (url) => {
    if (isGemini(url)) {
      geminiCalls += 1;
      return errorResponse(401, "invalid api key");
    }
    if (isGroq(url)) return openAiOk({ skills: ["C"] });
    return errorResponse(500, "unexpected");
  };

  const result = await run();

  assert.equal(geminiCalls, 1, "auth error must not be retried");
  assert.equal(result.providerId, "groq");
});

test("billing failure is not retried and fails over immediately", async () => {
  process.env.AI_MAX_RETRIES = "2";
  process.env.GEMINI_API_KEY = "g";
  process.env.GROQ_API_KEY = "q";

  let geminiCalls = 0;
  handler = async (url) => {
    if (isGemini(url)) {
      geminiCalls += 1;
      return errorResponse(400, "Your credit balance is too low");
    }
    if (isGroq(url)) return openAiOk({ skills: ["Swift"] });
    return errorResponse(500, "unexpected");
  };

  const result = await run();

  assert.equal(geminiCalls, 1, "billing error must not be retried");
  assert.equal(result.providerId, "groq");
  assert.equal(result.attempts[0].category, "billing");
});

// ---------------------------------------------------------------------------
// Retry with backoff on transient errors
// ---------------------------------------------------------------------------

test("transient failure is retried on the same provider before failover", async () => {
  process.env.AI_MAX_RETRIES = "1";
  process.env.GEMINI_API_KEY = "g";

  let geminiCalls = 0;
  handler = async (url) => {
    if (isGemini(url)) {
      geminiCalls += 1;
      if (geminiCalls === 1) return errorResponse(503, "overloaded");
      return geminiOk({ skills: ["Elixir"] });
    }
    return errorResponse(500, "unexpected");
  };

  const result = await run();

  assert.equal(geminiCalls, 2, "should retry once then succeed");
  assert.equal(result.providerId, "gemini");
  assert.equal(result.usedFallback, false);
});

test("retries are bounded — no infinite loop", async () => {
  process.env.AI_MAX_RETRIES = "1";
  process.env.GEMINI_API_KEY = "g";

  let calls = 0;
  handler = async () => {
    calls += 1;
    return errorResponse(503, "always down");
  };

  await assert.rejects(() => run());
  // 1 initial + 1 retry, and no other provider configured.
  assert.equal(calls, 2);
});

// ---------------------------------------------------------------------------
// Invalid / malformed structured output
// ---------------------------------------------------------------------------

test("non-JSON output fails over to the next provider", async () => {
  process.env.GEMINI_API_KEY = "g";
  process.env.GROQ_API_KEY = "q";

  handler = async (url) => {
    if (isGemini(url)) {
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "I cannot help." }] } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (isGroq(url)) return openAiOk({ skills: ["Scala"] });
    return errorResponse(500, "unexpected");
  };

  const result = await run();

  assert.equal(result.providerId, "groq");
  assert.equal(result.attempts[0].category, "invalid_response");
});

test("schema-valid JSON that violates the app schema fails over", async () => {
  process.env.GEMINI_API_KEY = "g";
  process.env.GROQ_API_KEY = "q";

  handler = async (url) => {
    // Valid JSON, but no `skills` array → rejected by validate().
    if (isGemini(url)) return geminiOk({ unexpected: true });
    if (isGroq(url)) return openAiOk({ skills: ["Perl"] });
    return errorResponse(500, "unexpected");
  };

  const result = await run();

  assert.equal(result.providerId, "groq");
  assert.equal(result.attempts[0].category, "invalid_response");
  assert.deepEqual(result.value.skills, ["Perl"]);
});

test("invalid output from every provider raises invalid_response, never crashes", async () => {
  process.env.GEMINI_API_KEY = "g";
  process.env.GROQ_API_KEY = "q";

  handler = async (url) => {
    if (isGemini(url)) return geminiOk({ wrong: 1 });
    if (isGroq(url)) return openAiOk({ alsoWrong: 2 });
    return errorResponse(500, "unexpected");
  };

  await assert.rejects(
    () => run(),
    (err: unknown) => {
      assert.ok(err instanceof AiGatewayError);
      assert.equal(err.category, "invalid_response");
      return true;
    }
  );
});

test("empty completion is treated as an invalid response", async () => {
  process.env.GEMINI_API_KEY = "g";
  handler = async () =>
    new Response(JSON.stringify({ candidates: [{ finishReason: "MAX_TOKENS" }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  await assert.rejects(
    () => run(),
    (err: unknown) => {
      assert.ok(err instanceof AiGatewayError);
      assert.equal(err.category, "invalid_response");
      return true;
    }
  );
});

test("gemini safety block is reported as invalid_response", async () => {
  process.env.GEMINI_API_KEY = "g";
  handler = async () =>
    new Response(JSON.stringify({ promptFeedback: { blockReason: "SAFETY" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  await assert.rejects(
    () => run(),
    (err: unknown) => {
      assert.ok(err instanceof AiGatewayError);
      assert.equal(err.category, "invalid_response");
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// Timeout
// ---------------------------------------------------------------------------

test("timeout is classified as timeout and fails over", async () => {
  process.env.GEMINI_API_KEY = "g";
  process.env.GROQ_API_KEY = "q";

  handler = async (url, init) => {
    if (isGemini(url)) {
      const signal = (init as { signal?: AbortSignal } | undefined)?.signal;
      return new Promise<Response>((_, reject) => {
        signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError"))
        );
      });
    }
    if (isGroq(url)) return openAiOk({ skills: ["Haskell"] });
    return errorResponse(500, "unexpected");
  };

  const result = await run({ timeoutMs: 80 });

  assert.equal(result.attempts[0].category, "timeout");
  assert.equal(result.providerId, "groq");
});

test("timeout on every provider raises a timeout category", async () => {
  process.env.GEMINI_API_KEY = "g";

  handler = async (_url, init) => {
    const signal = (init as { signal?: AbortSignal } | undefined)?.signal;
    return new Promise<Response>((_, reject) => {
      signal?.addEventListener("abort", () =>
        reject(new DOMException("aborted", "AbortError"))
      );
    });
  };

  await assert.rejects(
    () => run({ timeoutMs: 60 }),
    (err: unknown) => {
      assert.ok(err instanceof AiGatewayError);
      assert.equal(err.category, "timeout");
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// Duplicate request suppression
// ---------------------------------------------------------------------------

test("identical concurrent requests are coalesced into one provider call", async () => {
  process.env.GEMINI_API_KEY = "g";

  let calls = 0;
  handler = async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 20));
    return geminiOk({ skills: ["Dedup"] });
  };

  const shared = {
    systemPrompt: "system",
    userContent: "identical-content",
    task: "lightweight" as const,
    validate: validateSkills,
    label: "dedup_task",
  };

  const [a, b] = await Promise.all([
    generateStructured(shared),
    generateStructured(shared),
  ]);

  assert.equal(calls, 1, "duplicate in-flight request must not be re-sent");
  assert.deepEqual(a.value.skills, ["Dedup"]);
  assert.deepEqual(b.value.skills, ["Dedup"]);
});

test("different content is not coalesced", async () => {
  process.env.GEMINI_API_KEY = "g";

  let calls = 0;
  handler = async () => {
    calls += 1;
    return geminiOk({ skills: ["x"] });
  };

  await Promise.all([run(), run()]);
  assert.equal(calls, 2);
});

// ---------------------------------------------------------------------------
// Classification unit tests
// ---------------------------------------------------------------------------

test("classifyHttpFailure maps statuses to normalized categories", () => {
  assert.equal(classifyHttpFailure(401, "bad key"), "auth");
  assert.equal(classifyHttpFailure(403, "forbidden"), "auth");
  assert.equal(classifyHttpFailure(429, "slow down"), "rate_limit");
  assert.equal(classifyHttpFailure(500, "oops"), "unavailable");
  assert.equal(classifyHttpFailure(503, "down"), "unavailable");
  assert.equal(classifyHttpFailure(402, "pay up"), "billing");
  assert.equal(classifyHttpFailure(400, "bad shape"), "invalid_response");
});

test("classifyHttpFailure detects billing messages across status codes", () => {
  assert.equal(
    classifyHttpFailure(400, "Your credit balance is too low to access the API"),
    "billing"
  );
  assert.equal(
    classifyHttpFailure(429, "You exceeded your current quota"),
    "billing"
  );
  assert.equal(classifyHttpFailure(403, "insufficient credits"), "billing");
});

test("parseJsonFromModelText tolerates fences and surrounding prose", () => {
  assert.deepEqual(
    parseJsonFromModelText('```json\n{"a":1}\n```', "test"),
    { a: 1 }
  );
  assert.deepEqual(parseJsonFromModelText('```\n{"b":2}\n```', "test"), { b: 2 });
  assert.deepEqual(
    parseJsonFromModelText('Here is the result: {"c":3} hope that helps', "test"),
    { c: 3 }
  );
});

test("parseJsonFromModelText reports invalid_response without leaking content", () => {
  const secret = "CONFIDENTIAL RESUME TEXT";
  assert.throws(
    () => parseJsonFromModelText(secret, "test"),
    (err: unknown) => {
      assert.ok(err instanceof AiProviderError);
      assert.equal(err.category, "invalid_response");
      assert.ok(
        !err.message.includes(secret),
        "error message must not echo model/user content"
      );
      return true;
    }
  );
});

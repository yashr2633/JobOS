/**
 * AI gateway / orchestrator.
 *
 * Single entry point for every AI call in the application. Responsibilities:
 *
 *   1. Pick providers in configured order (primary → fallbacks).
 *   2. Skip providers with no credential (reported unavailable, not failed).
 *   3. Retry transient failures on the same provider with exponential backoff.
 *   4. Fail over to the next provider on permanent or schema failures.
 *   5. Validate structured output against a strict schema BEFORE returning.
 *   6. De-duplicate identical in-flight requests.
 *   7. Emit structured, PII-free logs with a request ID per call.
 *
 * Callers get a normalized, provider-independent result. Nothing downstream
 * (the analyze route, scoring, UI) knows which vendor served the request.
 *
 * Privacy: prompts contain resume and job-description text. This module logs
 * only metadata — provider, model, label, duration, category, content LENGTH.
 * It never logs prompt or completion content, and never logs credentials.
 */

import { getAiConfig } from "./config.ts";
import {
  AiProviderError,
  PERMANENT_PROVIDER_CATEGORIES,
  TRANSIENT_CATEGORIES,
  type AiFailureCategory,
  type AiProvider,
  type AiTaskKind,
} from "./providers/types.ts";
import type { ValidationResult } from "./schemas.ts";

// ---------------------------------------------------------------------------
// Public result / error shapes
// ---------------------------------------------------------------------------

export interface AiAttempt {
  providerId: string;
  model: string;
  ok: boolean;
  category: AiFailureCategory | null;
  durationMs: number;
}

export interface AiGatewayResult<T> {
  value: T;
  /** Provider that actually produced the accepted result. */
  providerId: string;
  model: string;
  requestId: string;
  durationMs: number;
  /** True when the primary provider did not serve the request. */
  usedFallback: boolean;
  attempts: AiAttempt[];
}

/**
 * Raised when every configured provider failed. `category` is the most
 * actionable category observed, which the route maps onto an HTTP status and
 * a user-safe message.
 */
export class AiGatewayError extends Error {
  readonly category: AiFailureCategory;
  readonly requestId: string;
  readonly attempts: AiAttempt[];

  constructor(
    category: AiFailureCategory,
    requestId: string,
    attempts: AiAttempt[],
    message: string
  ) {
    super(message);
    this.name = "AiGatewayError";
    this.category = category;
    this.requestId = requestId;
    this.attempts = attempts;
  }
}

// ---------------------------------------------------------------------------
// Request de-duplication
// ---------------------------------------------------------------------------

/**
 * In-flight requests keyed by task + label + a hash of the content.
 *
 * Guards against duplicate spend when a user double-clicks Analyze or a
 * component re-renders mid-request: the second caller awaits the first
 * promise instead of issuing a second paid call. Entries are removed as soon
 * as the promise settles, so this is a coalescing window, not a cache — it
 * never returns a stale result for a later request.
 */
const inFlight = new Map<string, Promise<AiGatewayResult<unknown>>>();

/** Non-cryptographic content hash. Used only to build a dedup key. */
function hashContent(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

// ---------------------------------------------------------------------------
// Logging — metadata only
// ---------------------------------------------------------------------------

interface AiLogRecord {
  event: "ai_attempt" | "ai_request";
  requestId: string;
  label: string;
  task: AiTaskKind;
  provider?: string;
  model?: string;
  ok: boolean;
  category?: AiFailureCategory | null;
  durationMs: number;
  attempt?: number;
  usedFallback?: boolean;
  /** Length only — never the text itself. */
  inputChars?: number;
}

function logAi(record: AiLogRecord): void {
  // Single-line JSON so a log aggregator can parse it without a custom regex.
  console.log(JSON.stringify({ scope: "ai", ...record }));
}

function newRequestId(): string {
  // randomUUID is available in the Node runtime used by the route handlers.
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `ai_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Ranks categories so the most actionable one is reported to the caller. */
const CATEGORY_PRIORITY: AiFailureCategory[] = [
  "billing",
  "auth",
  "rate_limit",
  "timeout",
  "invalid_response",
  "unavailable",
  "unconfigured",
  "unknown",
];

function mostActionable(categories: AiFailureCategory[]): AiFailureCategory {
  for (const candidate of CATEGORY_PRIORITY) {
    if (categories.includes(candidate)) return candidate;
  }
  return "unknown";
}

// ---------------------------------------------------------------------------
// Core orchestration
// ---------------------------------------------------------------------------

export interface GenerateStructuredParams<T> {
  systemPrompt: string;
  userContent: string;
  task: AiTaskKind;
  /**
   * Strict schema check. A provider result that fails this is discarded and
   * the next provider is tried — invalid data never reaches the application.
   */
  validate: (raw: unknown) => ValidationResult<T>;
  /** Short stable identifier for logs, e.g. "jd_parse". Never user content. */
  label: string;
  maxTokens?: number;
  timeoutMs?: number;
  requestId?: string;
}

/**
 * Generate schema-validated structured output, failing over across providers.
 *
 * Throws `AiGatewayError` only after every configured provider has been
 * exhausted.
 */
export async function generateStructured<T>(
  params: GenerateStructuredParams<T>
): Promise<AiGatewayResult<T>> {
  const key = [
    params.label,
    params.task,
    hashContent(params.systemPrompt),
    hashContent(params.userContent),
  ].join(":");

  const existing = inFlight.get(key);
  if (existing) {
    // Coalesce with the identical request already running.
    return existing as Promise<AiGatewayResult<T>>;
  }

  const promise = runChain(params).finally(() => {
    inFlight.delete(key);
  });

  inFlight.set(key, promise as Promise<AiGatewayResult<unknown>>);
  return promise;
}

async function runChain<T>(
  params: GenerateStructuredParams<T>
): Promise<AiGatewayResult<T>> {
  const config = getAiConfig();
  const requestId = params.requestId ?? newRequestId();
  const startedAt = Date.now();

  const maxTokens = params.maxTokens ?? (params.task === "deep" ? 2_048 : 1_024);
  const timeoutMs = params.timeoutMs ?? config.timeoutMs;

  const attempts: AiAttempt[] = [];
  const categories: AiFailureCategory[] = [];

  if (config.chain.length === 0) {
    const error = new AiGatewayError(
      "unconfigured",
      requestId,
      attempts,
      "No AI providers are configured."
    );
    logAi({
      event: "ai_request",
      requestId,
      label: params.label,
      task: params.task,
      ok: false,
      category: "unconfigured",
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }

  for (let index = 0; index < config.chain.length; index += 1) {
    const provider = config.chain[index];
    const model = provider.modelFor(params.task);

    // Missing credential: unavailable, not a failure. Skip without a call.
    if (!provider.isConfigured()) {
      attempts.push({
        providerId: provider.id,
        model,
        ok: false,
        category: "unconfigured",
        durationMs: 0,
      });
      categories.push("unconfigured");
      logAi({
        event: "ai_attempt",
        requestId,
        label: params.label,
        task: params.task,
        provider: provider.id,
        model,
        ok: false,
        category: "unconfigured",
        durationMs: 0,
      });
      continue;
    }

    const outcome = await attemptProvider({
      provider,
      model,
      params,
      maxTokens,
      timeoutMs,
      maxRetries: config.maxRetries,
      requestId,
      attempts,
    });

    if (outcome.ok) {
      const durationMs = Date.now() - startedAt;
      const usedFallback = index > 0;

      logAi({
        event: "ai_request",
        requestId,
        label: params.label,
        task: params.task,
        provider: provider.id,
        model,
        ok: true,
        durationMs,
        usedFallback,
        inputChars: params.userContent.length,
      });

      return {
        value: outcome.value,
        providerId: provider.id,
        model,
        requestId,
        durationMs,
        usedFallback,
        attempts,
      };
    }

    categories.push(outcome.category);
    // Fall through to the next provider in the chain.
  }

  const category = mostActionable(categories);
  const durationMs = Date.now() - startedAt;

  logAi({
    event: "ai_request",
    requestId,
    label: params.label,
    task: params.task,
    ok: false,
    category,
    durationMs,
    inputChars: params.userContent.length,
  });

  throw new AiGatewayError(
    category,
    requestId,
    attempts,
    `All ${config.chain.length} provider(s) failed for "${params.label}".`
  );
}

type ProviderOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; category: AiFailureCategory };

/**
 * Try one provider, with bounded retries for transient categories only.
 *
 * Permanent categories (unconfigured/auth/billing) and schema failures return
 * immediately so the gateway can move on without wasting time or money.
 */
async function attemptProvider<T>(args: {
  provider: AiProvider;
  model: string;
  params: GenerateStructuredParams<T>;
  maxTokens: number;
  timeoutMs: number;
  maxRetries: number;
  requestId: string;
  attempts: AiAttempt[];
}): Promise<ProviderOutcome<T>> {
  const {
    provider,
    model,
    params,
    maxTokens,
    timeoutMs,
    maxRetries,
    requestId,
    attempts,
  } = args;

  let lastCategory: AiFailureCategory = "unknown";

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (attempt > 0) {
      // Exponential backoff: 500ms, 1s, 2s — bounded by maxRetries (≤ 3).
      await sleep(500 * 2 ** (attempt - 1));
    }

    const attemptStart = Date.now();

    try {
      const raw = await provider.generateJson({
        systemPrompt: params.systemPrompt,
        userContent: params.userContent,
        task: params.task,
        maxTokens,
        timeoutMs,
      });

      const validated = params.validate(raw);
      if (!validated.ok) {
        // Schema violation is this provider's failure, not the user's.
        const durationMs = Date.now() - attemptStart;
        attempts.push({
          providerId: provider.id,
          model,
          ok: false,
          category: "invalid_response",
          durationMs,
        });
        logAi({
          event: "ai_attempt",
          requestId,
          label: params.label,
          task: params.task,
          provider: provider.id,
          model,
          ok: false,
          category: "invalid_response",
          durationMs,
          attempt,
        });
        return { ok: false, category: "invalid_response" };
      }

      const durationMs = Date.now() - attemptStart;
      attempts.push({
        providerId: provider.id,
        model,
        ok: true,
        category: null,
        durationMs,
      });
      logAi({
        event: "ai_attempt",
        requestId,
        label: params.label,
        task: params.task,
        provider: provider.id,
        model,
        ok: true,
        durationMs,
        attempt,
      });

      return { ok: true, value: validated.value };
    } catch (err: unknown) {
      const durationMs = Date.now() - attemptStart;
      const category =
        err instanceof AiProviderError ? err.category : "unknown";
      lastCategory = category;

      attempts.push({
        providerId: provider.id,
        model,
        ok: false,
        category,
        durationMs,
      });
      logAi({
        event: "ai_attempt",
        requestId,
        label: params.label,
        task: params.task,
        provider: provider.id,
        model,
        ok: false,
        category,
        durationMs,
        attempt,
      });

      // Never retry a provider that cannot recover without intervention.
      if (PERMANENT_PROVIDER_CATEGORIES.has(category)) {
        return { ok: false, category };
      }
      // Non-transient (e.g. invalid_response): fail over rather than retry.
      if (!TRANSIENT_CATEGORIES.has(category)) {
        return { ok: false, category };
      }
      // Transient and retries remain → loop for another attempt.
    }
  }

  return { ok: false, category: lastCategory };
}

/** Test-only hook so dedup state cannot leak between test cases. */
export function __clearInFlightForTests(): void {
  inFlight.clear();
}

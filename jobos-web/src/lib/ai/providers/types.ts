/**
 * Provider-independent AI contract.
 *
 * The application never talks to a vendor SDK or endpoint directly. Every AI
 * call goes through the gateway (`../gateway.ts`), which selects among the
 * providers implementing `AiProvider` below. Adding a future provider
 * (Mistral, OpenAI, a self-hosted model) means adding one file that
 * implements this interface and registering it — no changes to callers.
 *
 * All providers are server-only: they read credentials from non-NEXT_PUBLIC_
 * environment variables, so no key can reach the browser bundle.
 */

// ---------------------------------------------------------------------------
// Task classification — drives cost control
// ---------------------------------------------------------------------------

/**
 * What kind of work the call represents. Providers map this onto a concrete
 * model so expensive models are reserved for work that needs them:
 *
 * - "lightweight": structured extraction / classification (JD + resume parse).
 * - "deep":        reasoning, interpretation, recommendations, and later
 *                  tailored-resume generation.
 *
 * Deterministic work (keyword matching, scoring, file parsing, validation)
 * must NOT go through a provider at all — see `scoring.ts` / `normalize.ts`.
 */
export type AiTaskKind = "lightweight" | "deep";

// ---------------------------------------------------------------------------
// Normalized failure categories
// ---------------------------------------------------------------------------

/**
 * Vendor-neutral failure classification. The gateway uses this to decide
 * whether to retry the same provider, move to the next provider, or stop.
 *
 * - "unconfigured"     No credential present. The provider is unavailable, not
 *                      failing — never retried, never counted as an outage.
 * - "auth"             Credential present but rejected. Permanent for this
 *                      provider; skip to the next one without retrying.
 * - "billing"          Quota/credit exhausted. Permanent for this provider.
 * - "rate_limit"       429. Transient; eligible for one backoff retry, then
 *                      failover.
 * - "timeout"          Request exceeded the configured deadline.
 * - "unavailable"      5xx / upstream outage. Transient.
 * - "invalid_response" Non-JSON body, or JSON that failed schema validation.
 *                      Not retried on the same provider (a model that ignored
 *                      the schema once tends to repeat), so we fail over.
 * - "unknown"          Anything unclassified.
 */
export type AiFailureCategory =
  | "unconfigured"
  | "auth"
  | "billing"
  | "rate_limit"
  | "timeout"
  | "unavailable"
  | "invalid_response"
  | "unknown";

/** Categories worth retrying against the SAME provider after a backoff. */
export const TRANSIENT_CATEGORIES: ReadonlySet<AiFailureCategory> = new Set([
  "rate_limit",
  "timeout",
  "unavailable",
]);

/**
 * Categories that mean "this provider cannot serve any request right now".
 * The gateway moves straight to the next provider without burning retries.
 */
export const PERMANENT_PROVIDER_CATEGORIES: ReadonlySet<AiFailureCategory> =
  new Set(["unconfigured", "auth", "billing"]);

/**
 * A single provider failure, carrying enough context for the gateway to make
 * a routing decision and for logs to be diagnosable.
 *
 * `message` is for server logs only — it may contain upstream error text and
 * is never forwarded to the browser verbatim.
 */
export class AiProviderError extends Error {
  readonly category: AiFailureCategory;
  readonly providerId: string;
  readonly statusCode: number | null;

  constructor(
    category: AiFailureCategory,
    providerId: string,
    message: string,
    statusCode: number | null = null
  ) {
    super(message);
    this.name = "AiProviderError";
    this.category = category;
    this.providerId = providerId;
    this.statusCode = statusCode;
  }
}

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface AiJsonRequest {
  /** Instruction context. Must demand raw JSON with no prose. */
  systemPrompt: string;
  /** The variable payload (already wrapped in data delimiters by prompts.ts). */
  userContent: string;
  task: AiTaskKind;
  maxTokens: number;
  timeoutMs: number;
}

export interface AiProvider {
  /** Stable identifier used in config and logs, e.g. "gemini". */
  readonly id: string;

  /**
   * True when the credential this provider needs is present. Checked before
   * any network call so a missing key is reported as "unavailable" rather
   * than producing a misleading auth failure.
   */
  isConfigured(): boolean;

  /** Concrete model ID this provider would use for the task. For logs. */
  modelFor(task: AiTaskKind): string;

  /**
   * Perform one request and return the parsed JSON value (unvalidated —
   * schema validation is the gateway's job). Must throw `AiProviderError`
   * with an accurate category on every failure path.
   */
  generateJson(request: AiJsonRequest): Promise<unknown>;
}

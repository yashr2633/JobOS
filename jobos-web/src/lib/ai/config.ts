/**
 * Server-side AI configuration.
 *
 * Provider order, retries, and timeouts are all driven from environment
 * variables so the routing policy can change without a code change. Every
 * value has a safe default, so the app works with zero AI_* vars set.
 *
 * Server-only: this module reads non-NEXT_PUBLIC_ env vars and must never be
 * imported from a client component.
 */

import type { AiProvider } from "./providers/types.ts";
import { geminiProvider } from "./providers/gemini.ts";
import { groqProvider } from "./providers/groq.ts";
import { openRouterProvider } from "./providers/openrouter.ts";
import { anthropicProvider } from "./providers/anthropic.ts";

/** Every provider the app knows how to talk to, keyed by config name. */
const PROVIDER_REGISTRY: Record<string, AiProvider> = {
  gemini: geminiProvider,
  groq: groqProvider,
  openrouter: openRouterProvider,
  anthropic: anthropicProvider,
};

const DEFAULT_PRIMARY = "gemini";
const DEFAULT_FALLBACKS = ["groq", "openrouter"];

function intFromEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function boolFromEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  return raw === "true" || raw === "1" || raw === "yes";
}

function namesFromEnv(name: string, fallback: string[]): string[] {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s !== "");
  return parsed.length > 0 ? parsed : fallback;
}

export interface AiConfig {
  /** Ordered provider chain: primary first, then each fallback. */
  readonly chain: readonly AiProvider[];
  /** Retries against the SAME provider for transient failures. 0 disables. */
  readonly maxRetries: number;
  /** Per-request deadline in milliseconds. */
  readonly timeoutMs: number;
}

/**
 * Build the effective provider chain.
 *
 * Anthropic is excluded unless AI_ENABLE_ANTHROPIC is truthy, because the
 * account currently has no credit — including it by default would add a
 * guaranteed failed hop to every request.
 *
 * Unknown names in config are skipped rather than throwing, so a typo
 * degrades to a shorter chain instead of taking the feature down.
 */
export function getAiConfig(): AiConfig {
  const primary = (process.env.AI_PRIMARY_PROVIDER?.trim().toLowerCase() ||
    DEFAULT_PRIMARY);
  const fallbacks = namesFromEnv("AI_FALLBACK_PROVIDERS", DEFAULT_FALLBACKS);
  const anthropicEnabled = boolFromEnv("AI_ENABLE_ANTHROPIC", false);

  const ordered: AiProvider[] = [];
  const seen = new Set<string>();

  for (const name of [primary, ...fallbacks]) {
    if (seen.has(name)) continue;
    if (name === "anthropic" && !anthropicEnabled) continue;

    const provider = PROVIDER_REGISTRY[name];
    if (!provider) continue;

    seen.add(name);
    ordered.push(provider);
  }

  return {
    chain: ordered,
    // Cap at 3 so a misconfiguration cannot create a long retry storm.
    maxRetries: intFromEnv("AI_MAX_RETRIES", 1, 0, 3),
    timeoutMs: intFromEnv("AI_REQUEST_TIMEOUT_MS", 20_000, 1_000, 60_000),
  };
}

/** Exposed for tests and future admin/diagnostics surfaces. */
export function listKnownProviderNames(): string[] {
  return Object.keys(PROVIDER_REGISTRY);
}

/**
 * Anthropic provider — legacy / optional.
 *
 * This is a thin adapter over the existing, well-tested `../provider.ts`
 * implementation rather than a reimplementation: that module keeps its own
 * unit tests and remains the source of truth for the Anthropic wire format.
 * Here we only translate its typed errors into the normalized
 * `AiProviderError` categories the gateway understands.
 *
 * NOT part of the default fallback chain: the current Anthropic account has
 * insufficient credits, so calling it by default would waste a round-trip on
 * every analysis. Enable explicitly with AI_ENABLE_ANTHROPIC=true.
 */

import {
  AiProviderError,
  type AiJsonRequest,
  type AiProvider,
  type AiTaskKind,
} from "./types.ts";
import {
  generateJson as anthropicGenerateJson,
  modelIdForTier,
  ProviderConfigError,
  ProviderParseError,
  ProviderResponseError,
  ProviderTimeoutError,
} from "../provider.ts";
import { classifyHttpFailure } from "./shared.ts";

const PROVIDER_ID = "anthropic";

export const anthropicProvider: AiProvider = {
  id: PROVIDER_ID,

  isConfigured(): boolean {
    const key = process.env.ANTHROPIC_API_KEY;
    return typeof key === "string" && key.trim() !== "";
  },

  modelFor(task: AiTaskKind): string {
    // The legacy module's tiers map onto the normalized task kinds.
    return modelIdForTier(task === "deep" ? "reasoning" : "parsing");
  },

  async generateJson(request: AiJsonRequest): Promise<unknown> {
    try {
      return await anthropicGenerateJson(
        request.systemPrompt,
        request.userContent,
        request.task === "deep" ? "reasoning" : "parsing",
        request.maxTokens,
        request.timeoutMs
      );
    } catch (err: unknown) {
      if (err instanceof ProviderConfigError) {
        throw new AiProviderError("unconfigured", PROVIDER_ID, err.message);
      }
      if (err instanceof ProviderTimeoutError) {
        throw new AiProviderError("timeout", PROVIDER_ID, err.message);
      }
      if (err instanceof ProviderParseError) {
        throw new AiProviderError("invalid_response", PROVIDER_ID, err.message);
      }
      if (err instanceof ProviderResponseError) {
        // The legacy module already detects exhausted credit explicitly.
        const category = err.isBillingIssue
          ? "billing"
          : classifyHttpFailure(err.statusCode, err.message);
        throw new AiProviderError(
          category,
          PROVIDER_ID,
          err.message,
          err.statusCode
        );
      }
      throw new AiProviderError(
        "unknown",
        PROVIDER_ID,
        err instanceof Error ? err.message : "Unknown provider failure."
      );
    }
  },
};

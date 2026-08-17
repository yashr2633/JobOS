/**
 * OpenRouter provider — last-resort fallback.
 *
 * Model ID verified against the live OpenRouter `/api/v1/models` listing:
 *   openrouter/free  (a router that dispatches to currently-available
 *                     zero-cost models)
 *
 * Because the router can land on many different underlying models, JSON mode
 * is NOT requested here — some free backends reject `response_format`. The
 * shared loose JSON extractor handles fenced/prose-wrapped output, and the
 * gateway validates the schema afterwards, so a sloppy backend degrades into
 * a clean `invalid_response` rather than a bad result reaching the user.
 */

import {
  AiProviderError,
  type AiJsonRequest,
  type AiProvider,
  type AiTaskKind,
} from "./types.ts";
import { callOpenAiCompatible } from "./shared.ts";

const PROVIDER_ID = "openrouter";
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "openrouter/free";

export const openRouterProvider: AiProvider = {
  id: PROVIDER_ID,

  isConfigured(): boolean {
    const key = process.env.OPENROUTER_API_KEY;
    return typeof key === "string" && key.trim() !== "";
  },

  modelFor(_task: AiTaskKind): string {
    return process.env.OPENROUTER_MODEL?.trim() || DEFAULT_MODEL;
  },

  async generateJson(request: AiJsonRequest): Promise<unknown> {
    const apiKey = process.env.OPENROUTER_API_KEY?.trim();
    if (!apiKey) {
      throw new AiProviderError(
        "unconfigured",
        PROVIDER_ID,
        "OPENROUTER_API_KEY is not set."
      );
    }

    // Attribution headers are optional but recommended by OpenRouter. They
    // carry no user data.
    const extraHeaders: Record<string, string> = {};
    const referer = process.env.OPENROUTER_SITE_URL?.trim();
    if (referer) extraHeaders["HTTP-Referer"] = referer;
    extraHeaders["X-Title"] = "JobTrackOS";

    return callOpenAiCompatible({
      providerId: PROVIDER_ID,
      endpoint: ENDPOINT,
      apiKey,
      model: this.modelFor(request.task),
      systemPrompt: request.systemPrompt,
      userContent: request.userContent,
      maxTokens: request.maxTokens,
      timeoutMs: request.timeoutMs,
      requestJsonMode: false,
      extraHeaders,
    });
  },
};

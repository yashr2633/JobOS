/**
 * Groq provider — first fallback.
 *
 * Model ID verified against the live Groq `/openai/v1/models` listing:
 *   openai/gpt-oss-120b
 *
 * Groq is OpenAI-API-compatible, so both task tiers use the same strong model
 * here: it is fast and inexpensive enough that a separate lightweight tier
 * would add configuration surface without a real cost saving.
 */

import {
  AiProviderError,
  type AiJsonRequest,
  type AiProvider,
  type AiTaskKind,
} from "./types.ts";
import { callOpenAiCompatible } from "./shared.ts";

const PROVIDER_ID = "groq";
const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "openai/gpt-oss-120b";

export const groqProvider: AiProvider = {
  id: PROVIDER_ID,

  isConfigured(): boolean {
    const key = process.env.GROQ_API_KEY;
    return typeof key === "string" && key.trim() !== "";
  },

  modelFor(_task: AiTaskKind): string {
    return process.env.GROQ_MODEL?.trim() || DEFAULT_MODEL;
  },

  async generateJson(request: AiJsonRequest): Promise<unknown> {
    const apiKey = process.env.GROQ_API_KEY?.trim();
    if (!apiKey) {
      throw new AiProviderError(
        "unconfigured",
        PROVIDER_ID,
        "GROQ_API_KEY is not set."
      );
    }

    return callOpenAiCompatible({
      providerId: PROVIDER_ID,
      endpoint: ENDPOINT,
      apiKey,
      model: this.modelFor(request.task),
      systemPrompt: request.systemPrompt,
      userContent: request.userContent,
      maxTokens: request.maxTokens,
      timeoutMs: request.timeoutMs,
      // Groq supports OpenAI JSON mode on this model.
      requestJsonMode: true,
    });
  },
};

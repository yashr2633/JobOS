/**
 * Google Gemini provider — the primary provider.
 *
 * Model IDs verified against the live `v1beta/models` listing:
 *   - gemini-2.5-flash       → deep work (Resume Match, JD analysis, and
 *                              later tailored-resume generation)
 *   - gemini-2.5-flash-lite  → lightweight extraction/classification
 *
 * Both are overridable by env so the model can be changed without a deploy
 * that touches code.
 */

import {
  AiProviderError,
  type AiJsonRequest,
  type AiProvider,
  type AiTaskKind,
} from "./types.ts";
import {
  classifyHttpFailure,
  fetchWithTimeout,
  parseJsonFromModelText,
  readErrorDetail,
} from "./shared.ts";

const PROVIDER_ID = "gemini";

const DEFAULT_DEEP_MODEL = "gemini-2.5-flash";
const DEFAULT_LIGHT_MODEL = "gemini-2.5-flash-lite";

export const geminiProvider: AiProvider = {
  id: PROVIDER_ID,

  isConfigured(): boolean {
    const key = process.env.GEMINI_API_KEY;
    return typeof key === "string" && key.trim() !== "";
  },

  modelFor(task: AiTaskKind): string {
    if (task === "deep") {
      return process.env.GEMINI_DEEP_MODEL?.trim() || DEFAULT_DEEP_MODEL;
    }
    return process.env.GEMINI_LIGHT_MODEL?.trim() || DEFAULT_LIGHT_MODEL;
  },

  async generateJson(request: AiJsonRequest): Promise<unknown> {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      throw new AiProviderError(
        "unconfigured",
        PROVIDER_ID,
        "GEMINI_API_KEY is not set."
      );
    }

    const model = this.modelFor(request.task);
    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

    const response = await fetchWithTimeout(
      endpoint,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Header auth keeps the key out of the URL and therefore out of logs.
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: request.systemPrompt }],
          },
          contents: [
            { role: "user", parts: [{ text: request.userContent }] },
          ],
          generationConfig: {
            maxOutputTokens: request.maxTokens,
            // Deterministic output for reproducible scoring inputs.
            temperature: 0,
            // Native structured-output mode: Gemini enforces JSON itself.
            responseMimeType: "application/json",
          },
        }),
      },
      request.timeoutMs,
      PROVIDER_ID
    );

    if (!response.ok) {
      const detail = await readErrorDetail(response);
      throw new AiProviderError(
        classifyHttpFailure(response.status, detail),
        PROVIDER_ID,
        `HTTP ${response.status}: ${detail}`,
        response.status
      );
    }

    const payload = (await response.json().catch(() => null)) as {
      candidates?: {
        content?: { parts?: { text?: string }[] };
        finishReason?: string;
      }[];
      promptFeedback?: { blockReason?: string };
    } | null;

    const blockReason = payload?.promptFeedback?.blockReason;
    if (blockReason) {
      throw new AiProviderError(
        "invalid_response",
        PROVIDER_ID,
        `Prompt blocked by safety filter: ${blockReason}`
      );
    }

    const text = payload?.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("")
      .trim();

    if (!text) {
      const finish = payload?.candidates?.[0]?.finishReason ?? "unknown";
      throw new AiProviderError(
        "invalid_response",
        PROVIDER_ID,
        `Empty completion (finishReason: ${finish}).`
      );
    }

    return parseJsonFromModelText(text, PROVIDER_ID);
  },
};

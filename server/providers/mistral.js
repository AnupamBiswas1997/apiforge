/**
 * server/providers/mistral.js — Mistral AI API adapter
 *
 * API docs: https://docs.mistral.ai/api/#tag/chat/operation/chat_completion_v1_chat_completions_post
 *
 * Quirks / notes:
 *   - API shape is very similar to OpenAI — uses Bearer auth and the same
 *     messages array format with role: "system" / "user"
 *   - Response is at choices[0].message.content (same as OpenAI)
 *   - Token usage at response.usage.total_tokens
 *   - Mistral models: mistral-large-latest, mistral-medium-latest, mistral-small-latest
 *   - Context window varies by model (32k for large, 8k for small)
 *
 * Required request fields: model, messages
 * Optional: max_tokens, temperature, top_p, stream, safe_prompt
 *
 * How to get an API key: https://console.mistral.ai/
 */

"use strict";

const axios = require("axios");
const logger = require("../logger");

const MISTRAL_API_URL = "https://api.mistral.ai/v1/chat/completions";
const MAX_TOKENS = 4096;

/**
 * @description Call the Mistral AI chat completions API.
 * @param {string} systemPrompt - Instruction context (sent as role: "system")
 * @param {string} userPrompt - The user's request (sent as role: "user")
 * @param {string} apiKey - Mistral API key
 * @param {string} model - Model string e.g. "mistral-large-latest"
 * @param {string} [baseUrl] - Override base URL
 * @returns {Promise<{text: string, tokensUsed: number|null}>}
 * @throws {Error} With classified .code field
 */
async function call(systemPrompt, userPrompt, apiKey, model, baseUrl, maxTokens) {
  const url = baseUrl || MISTRAL_API_URL;

  logger.debug("Mistral: sending request", { model, url });

  let response;
  try {
    response = await axios.post(
      url,
      {
        model,
        // Same message format as OpenAI — system role first, then user
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: maxTokens || MAX_TOKENS,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 60000,  // 60s — generation steps with 4096 tokens can be slow
      }
    );
  } catch (err) {
    if (err.response) {
      const status = err.response.status;
      const body = err.response.data;

      if (status === 401) {
        const e = new Error("Invalid Mistral API key");
        e.code = "INVALID_KEY";
        e.statusCode = 401;
        e.rawBody = body;
        throw e;
      }
      if (status === 429) {
        const e = new Error("Mistral rate limit exceeded");
        e.code = "RATE_LIMITED";
        e.statusCode = 429;
        e.retryAfter = err.response.headers["retry-after"] || null;
        e.rawBody = body;
        throw e;
      }
      if (status === 404) {
        const e = new Error(`Mistral model not found: ${model}`);
        e.code = "MODEL_NOT_FOUND";
        e.statusCode = 404;
        e.rawBody = body;
        throw e;
      }
      if (status >= 500) {
        const e = new Error("Mistral API is unavailable (5xx)");
        e.code = "PROVIDER_DOWN";
        e.statusCode = status;
        e.rawBody = body;
        throw e;
      }
      const e = new Error(`Mistral API error: ${status}`);
      e.code = "PROVIDER_ERROR";
      e.statusCode = status;
      e.rawBody = body;
      throw e;
    }
    if (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND" ||
        err.code === "ETIMEDOUT" || err.message.includes("timeout")) {
      const e = new Error(`Network error connecting to Mistral: ${err.message}`);
      e.code = "NETWORK_ERROR";
      throw e;
    }
    throw err;
  }

  const text = response.data?.choices?.[0]?.message?.content;
  if (!text) {
    const e = new Error("Mistral returned an unexpected response shape");
    e.code = "UNEXPECTED_RESPONSE";
    e.rawBody = response.data;
    throw e;
  }

  const tokensUsed = response.data?.usage?.total_tokens || null;
  return { text, tokensUsed };
}

module.exports = { call };

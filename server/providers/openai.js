/**
 * server/providers/openai.js — OpenAI API adapter
 *
 * API docs: https://platform.openai.com/docs/api-reference/chat/create
 *
 * Quirks / notes:
 *   - Uses standard Bearer token auth in Authorization header
 *   - System prompt is a message with role "system" inside the messages array
 *   - Response text is at choices[0].message.content
 *   - Token usage at response.usage.total_tokens
 *   - gpt-4o and gpt-4o-mini are the recommended current models
 *
 * Required request fields: model, messages
 * Optional: max_tokens, temperature, top_p, stop, stream
 *
 * How to get an API key: https://platform.openai.com/api-keys
 */

"use strict";

const axios = require("axios");
const logger = require("../logger");

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const MAX_TOKENS = 4096;

/**
 * @description Call the OpenAI chat completions API with system + user prompts.
 * @param {string} systemPrompt - Instruction context (sent as role: "system")
 * @param {string} userPrompt - The user's actual request (sent as role: "user")
 * @param {string} apiKey - OpenAI API key (sk-...)
 * @param {string} model - Model string e.g. "gpt-4o"
 * @param {string} [baseUrl] - Override base URL (useful for Azure OpenAI or proxies)
 * @returns {Promise<{text: string, tokensUsed: number|null}>}
 * @throws {Error} With classified .code field
 * @example
 *   const { text } = await call("Be helpful", "Hello", "sk-...", "gpt-4o");
 */
async function call(systemPrompt, userPrompt, apiKey, model, baseUrl, maxTokens) {
  const url = baseUrl || OPENAI_API_URL;

  logger.debug("OpenAI: sending request", { model, url });

  let response;
  try {
    response = await axios.post(
      url,
      {
        model,
        // OpenAI uses the messages array for both system and user prompts
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
        const e = new Error("Invalid OpenAI API key");
        e.code = "INVALID_KEY";
        e.statusCode = 401;
        e.rawBody = body;
        throw e;
      }
      if (status === 429) {
        const e = new Error("OpenAI rate limit or quota exceeded");
        e.code = "RATE_LIMITED";
        e.statusCode = 429;
        e.retryAfter = err.response.headers["retry-after"] || null;
        e.rawBody = body;
        throw e;
      }
      if (status === 404 || body?.error?.code === "model_not_found") {
        const e = new Error(`OpenAI model not found: ${model}`);
        e.code = "MODEL_NOT_FOUND";
        e.statusCode = 404;
        e.rawBody = body;
        throw e;
      }
      // Context window exceeded — OpenAI returns 400 with specific error code
      if (status === 400 && body?.error?.code === "context_length_exceeded") {
        const e = new Error("Prompt exceeds OpenAI context window");
        e.code = "CONTEXT_TOO_LONG";
        e.statusCode = 400;
        e.rawBody = body;
        throw e;
      }
      if (status >= 500) {
        const e = new Error("OpenAI API is unavailable (5xx)");
        e.code = "PROVIDER_DOWN";
        e.statusCode = status;
        e.rawBody = body;
        throw e;
      }
      const e = new Error(`OpenAI API error: ${status}`);
      e.code = "PROVIDER_ERROR";
      e.statusCode = status;
      e.rawBody = body;
      throw e;
    }
    if (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND" ||
        err.code === "ETIMEDOUT" || err.message.includes("timeout")) {
      const e = new Error(`Network error connecting to OpenAI: ${err.message}`);
      e.code = "NETWORK_ERROR";
      throw e;
    }
    throw err;
  }

  const text = response.data?.choices?.[0]?.message?.content;
  if (!text) {
    const e = new Error("OpenAI returned an unexpected response shape");
    e.code = "UNEXPECTED_RESPONSE";
    e.rawBody = response.data;
    throw e;
  }

  const tokensUsed = response.data?.usage?.total_tokens || null;
  return { text, tokensUsed };
}

module.exports = { call };

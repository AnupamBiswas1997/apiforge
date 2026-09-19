/**
 * server/providers/anthropic.js — Anthropic Claude API adapter
 *
 * API docs: https://docs.anthropic.com/en/api/messages
 *
 * Quirks / notes:
 *   - Uses custom headers: x-api-key and anthropic-version (unlike OpenAI Bearer token)
 *   - anthropic-version must be set or the API rejects the request
 *   - System prompt is a top-level field, NOT inside the messages array
 *   - Response content is an array; text is at content[0].text
 *   - Token usage is at response.usage.input_tokens + output_tokens
 *
 * Required request fields: model, max_tokens, messages
 * Optional: system (system prompt), temperature, top_p, stop_sequences
 *
 * How to get an API key: https://console.anthropic.com/
 */

"use strict";

const axios = require("axios");
const logger = require("../logger");

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
// Anthropic requires this header on every request — omitting it causes a 400
const ANTHROPIC_VERSION = "2023-06-01";
// Max tokens we request from Claude — 4096 is sufficient for most pipeline steps
const MAX_TOKENS = 4096;

/**
 * @description Call the Anthropic Claude API with a system + user prompt.
 * @param {string} systemPrompt - Instruction context for the model
 * @param {string} userPrompt - The user's actual question/request
 * @param {string} apiKey - Anthropic API key (sk-ant-...)
 * @param {string} model - Model string e.g. "claude-sonnet-4-20250514"
 * @param {string} [baseUrl] - Override base URL (rarely needed for Anthropic)
 * @returns {Promise<{text: string, tokensUsed: number|null}>} Extracted text + token count
 * @throws {Error} With classified .code field if the API call fails
 * @example
 *   const { text } = await call("Be helpful", "Hello", "sk-ant-...", "claude-sonnet-4-20250514");
 */
async function call(systemPrompt, userPrompt, apiKey, model, baseUrl, maxTokens) {
  const url = baseUrl || ANTHROPIC_API_URL;

  logger.debug("Anthropic: sending request", { model, url });

  let response;
  try {
    response = await axios.post(
      url,
      {
        model,
        max_tokens: maxTokens || MAX_TOKENS,
        // Anthropic uses a top-level "system" field rather than a system role message
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      },
      {
        headers: {
          "x-api-key": apiKey,
          // REQUIRED by Anthropic — missing this header → 400 Bad Request
          "anthropic-version": ANTHROPIC_VERSION,
          "content-type": "application/json",
        },
        // 30s timeout — pipeline steps can be slow with large prompts
        timeout: 60000,  // 60s — generation steps with 4096 tokens can be slow
      }
    );
  } catch (err) {
    // Translate Axios/HTTP errors into structured codes for llm.js to wrap
    if (err.response) {
      const status = err.response.status;
      const body = err.response.data;

      if (status === 401 || status === 403) {
        const e = new Error("Invalid Anthropic API key or insufficient permissions");
        e.code = "INVALID_KEY";
        e.statusCode = status;
        e.rawBody = body;
        throw e;
      }
      if (status === 429) {
        const e = new Error("Anthropic rate limit exceeded");
        e.code = "RATE_LIMITED";
        e.statusCode = 429;
        // Include retry-after header if provided
        e.retryAfter = err.response.headers["retry-after"] || null;
        e.rawBody = body;
        throw e;
      }
      if (status === 404) {
        const e = new Error(`Anthropic model not found: ${model}`);
        e.code = "MODEL_NOT_FOUND";
        e.statusCode = 404;
        e.rawBody = body;
        throw e;
      }
      if (status >= 500) {
        const e = new Error("Anthropic API is unavailable (5xx)");
        e.code = "PROVIDER_DOWN";
        e.statusCode = status;
        e.rawBody = body;
        throw e;
      }
      // Check for context-too-long error (Anthropic returns 400 with a specific message)
      if (status === 400 && body?.error?.type === "invalid_request_error" &&
          body?.error?.message?.includes("too long")) {
        const e = new Error("Prompt exceeds Anthropic context window");
        e.code = "CONTEXT_TOO_LONG";
        e.statusCode = 400;
        e.rawBody = body;
        throw e;
      }
      const e = new Error(`Anthropic API error: ${status}`);
      e.code = "PROVIDER_ERROR";
      e.statusCode = status;
      e.rawBody = body;
      throw e;
    }
    // Network-level error (no response received)
    if (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND" ||
        err.code === "ETIMEDOUT" || err.message.includes("timeout")) {
      const e = new Error(`Network error connecting to Anthropic: ${err.message}`);
      e.code = "NETWORK_ERROR";
      throw e;
    }
    throw err;
  }

  // Extract text from Anthropic's response format
  // response.content is an array of content blocks; we want the first text block
  const text = response.data?.content?.[0]?.text;
  if (!text) {
    const e = new Error("Anthropic returned an unexpected response shape");
    e.code = "UNEXPECTED_RESPONSE";
    e.rawBody = response.data;
    throw e;
  }

  // Token usage is in response.usage — sum input and output for total
  const tokensUsed =
    (response.data?.usage?.input_tokens || 0) +
    (response.data?.usage?.output_tokens || 0) || null;

  return { text, tokensUsed };
}

module.exports = { call };

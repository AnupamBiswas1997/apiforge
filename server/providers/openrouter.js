/**
 * server/providers/openrouter.js — OpenRouter API adapter
 *
 * OpenRouter is a unified gateway to 200+ LLMs (GPT-4, Claude, Llama, Gemini, etc.)
 * through a single OpenAI-compatible API.
 *
 * API docs: https://openrouter.ai/docs
 *
 * Quirks / notes:
 *   - Uses Bearer auth (same as OpenAI)
 *   - Requires two extra headers: HTTP-Referer and X-Title (for rankings/abuse detection)
 *   - Model IDs are namespaced: "anthropic/claude-3-5-sonnet", "openai/gpt-4o", etc.
 *   - Response format is identical to OpenAI: choices[0].message.content
 *   - Rate limiting and errors mirror OpenAI error codes
 *   - Free tier available with some models (add ":free" suffix e.g. "meta-llama/llama-3-8b-instruct:free")
 *
 * Popular models:
 *   anthropic/claude-sonnet-4-5          — Claude 3.5 Sonnet
 *   openai/gpt-4o                        — GPT-4o
 *   google/gemini-pro-1.5                — Gemini 1.5 Pro
 *   meta-llama/llama-3-70b-instruct      — Llama 3 70B
 *   mistralai/mistral-large              — Mistral Large
 *   meta-llama/llama-3-8b-instruct:free  — Free tier
 *
 * How to get an API key: https://openrouter.ai/keys
 */

"use strict";

const axios  = require("axios");
const logger = require("../logger");

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_TOKENS         = 4096;

// These headers are required by OpenRouter for routing and abuse detection.
// They appear in OpenRouter's dashboard as the referrer/app name.
const SITE_URL  = "https://github.com/apiforge";
const SITE_NAME = "APIForge API Testing Suite";

/**
 * @description Call the OpenRouter API with system + user prompts.
 * @param {string} systemPrompt - Instruction context
 * @param {string} userPrompt   - The user's actual request
 * @param {string} apiKey       - OpenRouter API key (sk-or-v1-...)
 * @param {string} model        - Namespaced model string e.g. "anthropic/claude-sonnet-4-5"
 * @param {string} [baseUrl]    - Override base URL (rarely needed)
 * @returns {Promise<{text: string, tokensUsed: number|null}>}
 * @throws {Error} With classified .code field
 */
async function call(systemPrompt, userPrompt, apiKey, model, baseUrl, maxTokens) {
  const url = baseUrl || OPENROUTER_API_URL;

  logger.debug("OpenRouter: sending request", { model, url });

  let response;
  try {
    response = await axios.post(
      url,
      {
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userPrompt   },
        ],
        max_tokens: maxTokens || MAX_TOKENS,
      },
      {
        headers: {
          Authorization:  `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          // Required by OpenRouter — used for analytics and abuse detection
          "HTTP-Referer":  SITE_URL,
          "X-Title":       SITE_NAME,
        },
        timeout: 60000, // OpenRouter can be slower due to provider routing
      }
    );
  } catch (err) {
    if (err.response) {
      const status = err.response.status;
      const body   = err.response.data;

      if (status === 401 || status === 403) {
        const e = new Error("Invalid OpenRouter API key or insufficient credits");
        e.code       = "INVALID_KEY";
        e.statusCode = status;
        e.rawBody    = body;
        throw e;
      }
      if (status === 429) {
        const e = new Error("OpenRouter rate limit exceeded");
        e.code       = "RATE_LIMITED";
        e.statusCode = 429;
        e.retryAfter = err.response.headers["retry-after"] || null;
        e.rawBody    = body;
        throw e;
      }
      if (status === 404 || body?.error?.code === "model_not_found" ||
          body?.error?.message?.toLowerCase().includes("model")) {
        const e = new Error(
          `OpenRouter model not found: "${model}". ` +
          `Check https://openrouter.ai/models for valid model IDs.`
        );
        e.code       = "MODEL_NOT_FOUND";
        e.statusCode = 404;
        e.rawBody    = body;
        throw e;
      }
      if (status === 400 && (
        body?.error?.code === "context_length_exceeded" ||
        body?.error?.message?.toLowerCase().includes("context")
      )) {
        const e = new Error("Prompt exceeds model context window via OpenRouter");
        e.code       = "CONTEXT_TOO_LONG";
        e.statusCode = 400;
        e.rawBody    = body;
        throw e;
      }
      // OpenRouter returns 402 when the user has insufficient credits.
      // This is a billing problem, NOT a transient rate limit — retrying with
      // back-off will never succeed until the account is topped up, so it must
      // use a distinct, non-retryable error code rather than RATE_LIMITED.
      if (status === 402) {
        const e = new Error("Insufficient OpenRouter credits. Top up at https://openrouter.ai/credits");
        e.code       = "INSUFFICIENT_CREDITS";
        e.statusCode = 402;
        e.rawBody    = body;
        throw e;
      }
      if (status >= 500) {
        const e = new Error("OpenRouter API is unavailable (5xx)");
        e.code       = "PROVIDER_DOWN";
        e.statusCode = status;
        e.rawBody    = body;
        throw e;
      }
      const e = new Error(`OpenRouter API error: ${status} — ${body?.error?.message || "unknown"}`);
      e.code       = "PROVIDER_ERROR";
      e.statusCode = status;
      e.rawBody    = body;
      throw e;
    }
    if (
      err.code === "ECONNREFUSED" || err.code === "ENOTFOUND" ||
      err.code === "ETIMEDOUT"    || err.message.includes("timeout")
    ) {
      const e = new Error(`Network error connecting to OpenRouter: ${err.message}`);
      e.code = "NETWORK_ERROR";
      throw e;
    }
    throw err;
  }

  // OpenRouter wraps the upstream provider response — shape is OpenAI-compatible
  const text = response.data?.choices?.[0]?.message?.content;
  if (!text) {
    // OpenRouter sometimes returns an error inside a 200 response (upstream failure)
    const upstreamError = response.data?.error;
    if (upstreamError) {
      const e = new Error(
        `OpenRouter upstream error: ${upstreamError.message || JSON.stringify(upstreamError)}`
      );
      e.code    = "PROVIDER_ERROR";
      e.rawBody = response.data;
      throw e;
    }
    const e = new Error("OpenRouter returned an unexpected response shape");
    e.code    = "UNEXPECTED_RESPONSE";
    e.rawBody = response.data;
    throw e;
  }

  const tokensUsed =
    (response.data?.usage?.prompt_tokens || 0) +
    (response.data?.usage?.completion_tokens || 0) || null;

  return { text, tokensUsed };
}

module.exports = { call };

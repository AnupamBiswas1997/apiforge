/**
 * server/llm.js — Unified LLM provider router
 *
 * Responsible for:
 *   - Routing callLLM() calls to the correct provider adapter
 *   - Resolving which provider/model/key to use (overrides → env → defaults)
 *   - Normalising all responses to a plain text string
 *   - Wrapping all provider errors in a structured LLMError
 *   - Logging provider, model, token usage, and latency for every call
 *   - Retry logic: one automatic retry on unparseable JSON responses
 *
 * NOT responsible for:
 *   - Any provider-specific HTTP logic (that lives in server/providers/)
 *   - Parsing or interpreting the text content (that's pipeline.js's job)
 *   - Storing or persisting session config (that's llm-config.js's job)
 *
 * Side effects:
 *   - Reads process.env for provider/model/key/baseUrl defaults
 *   - Reads module.exports.sessionConfig for runtime overrides set by /api/llm/connect
 */

"use strict";

const logger = require("./logger");

// ─── Provider registry ──────────────────────────────────────────────────────
// Maps provider key strings to their adapter modules.
// Adding a new provider: add an entry here + create server/providers/{key}.js
const PROVIDERS = {
  anthropic:  require("./providers/anthropic"),
  openai:     require("./providers/openai"),
  gemini:     require("./providers/gemini"),
  mistral:    require("./providers/mistral"),
  ollama:     require("./providers/ollama"),
  marsmax:    require("./providers/marsmax"),
  openrouter: require("./providers/openrouter"),
};

// Default models for each provider — used when no model is specified
const DEFAULT_MODELS = {
  anthropic:  "claude-sonnet-4-20250514",
  openai:     "gpt-4o",
  gemini:     "gemini-1.5-pro",
  mistral:    "mistral-large-latest",
  ollama:     "llama3",
  marsmax:    "auto",
  openrouter: "anthropic/claude-sonnet-4-5",
};

// ─── Session config (set by /api/llm/connect at runtime) ────────────────────
// This object is mutated by llm-config.js when the user switches provider
// from the frontend. It persists for the server process lifetime.
// We export it so llm-config.js can update it in-place.
const sessionConfig = {
  provider: null,
  apiKey:   null,
  model:    null,
  baseUrl:  null,
};

// ─── LLMError class ─────────────────────────────────────────────────────────

/**
 * @description Structured error thrown by callLLM on any provider failure.
 * Always has: .code, .provider, .model, .message, .retryable
 */
class LLMError extends Error {
  /**
   * @param {string} message - Human-readable error description
   * @param {object} opts
   * @param {string} opts.code - Error code (INVALID_KEY, RATE_LIMITED, etc.)
   * @param {string} opts.provider - Provider key that failed
   * @param {string} opts.model - Model that was used
   * @param {number} [opts.statusCode] - HTTP status code if applicable
   * @param {boolean} [opts.retryable] - Whether retrying might succeed
   * @param {*} [opts.rawBody] - Raw response body from provider for debugging
   */
  constructor(message, { code, provider, model, statusCode, retryable = false, rawBody } = {}) {
    super(message);
    this.name = "LLMError";
    this.code = code || "UNKNOWN_ERROR";
    this.provider = provider;
    this.model = model;
    this.statusCode = statusCode;
    this.retryable = retryable;
    this.rawBody = rawBody;
  }
}

// ─── Rate-limit retry constants ─────────────────────────────────────────────
const MAX_RATE_LIMIT_RETRIES = 4;
const BASE_RATE_LIMIT_DELAY  = 12000; // 12 seconds minimum between retries

/**
 * Determine how long to wait before retrying a rate-limited call.
 * Priority:
 *   1. err.retryAfter — the standard HTTP Retry-After header, when the
 *      provider adapter captured it (Anthropic, OpenAI, Mistral, OpenRouter).
 *      This is the most accurate signal since it comes directly from the API.
 *   2. A "try again in N seconds" hint parsed from the error message
 *      (Mars Max includes this in its 429 body).
 *   3. BASE_RATE_LIMIT_DELAY as a safe fallback for providers that give no hint.
 * @param {Error} err - The error thrown by the provider adapter
 * @returns {number} Milliseconds to wait before retrying
 */
function computeRetryDelayMs(err) {
  // 1. Explicit Retry-After header (seconds, per HTTP spec for this use case)
  const headerVal = Number(err?.retryAfter);
  if (Number.isFinite(headerVal) && headerVal > 0) {
    return (headerVal + 1) * 1000; // +1s buffer
  }

  // 2. Parse "N seconds" from the message text (e.g. Mars Max's 429 body)
  const match = String(err?.message || "").match(/(\d+)\s*second/i);
  if (match) return (parseInt(match[1], 10) + 2) * 1000; // +2s buffer

  // 3. Fallback
  return BASE_RATE_LIMIT_DELAY;
}

// ─── Retry instruction appended on JSON parse failure ───────────────────────
// This suffix is added to the userPrompt on the second attempt when the first
// response was not parseable JSON. It is provider-agnostic.
const JSON_RETRY_SUFFIX =
  "\n\nYour last response was not valid JSON. Return only raw JSON with no explanation and no markdown. Do not include ```json or ``` fences.";

// ─── Core function ───────────────────────────────────────────────────────────

/**
 * @description Sends a prompt to the currently active LLM provider and returns
 * the raw text response. Handles provider resolution, error wrapping, and logging.
 *
 * @param {string} systemPrompt - Instruction context for the LLM
 * @param {string} userPrompt - The actual request/question
 * @param {object} [overrides] - Runtime overrides: { provider, apiKey, model, baseUrl }
 *   These take priority over sessionConfig and process.env.
 * @param {boolean} [isRetry=false] - Internal flag — if true, appends JSON retry suffix
 * @param {number} [maxTokens=null] - Override max output tokens for this call
 * @param {boolean} [retryOnRateLimit=true] - Whether to auto-retry on 429 with back-off.
 *   Set to false for latency-sensitive calls like connection tests, where a fast
 *   failure is more useful than a 48+ second silent wait.
 * @returns {Promise<{text: string, tokensUsed: number}>} Response text and token count
 * @throws {LLMError} With .provider, .code, .model, .statusCode, .retryable fields
 *
 * @example
 *   const text = await callLLM(
 *     "You are a JSON API. Return only valid JSON.",
 *     "Extract all endpoints from: POST /users creates a user",
 *   );
 */
async function callLLM(systemPrompt, userPrompt, overrides = {}, isRetry = false, maxTokens = null, retryOnRateLimit = true) {
  // ── Resolve provider / model / key / baseUrl ──
  // Priority: overrides argument → sessionConfig → process.env → defaults
  const provider =
    overrides.provider ||
    sessionConfig.provider ||
    process.env.LLM_PROVIDER ||
    "anthropic";

  if (!PROVIDERS[provider]) {
    throw new LLMError(`Unknown LLM provider: "${provider}"`, {
      code: "UNKNOWN_PROVIDER",
      provider,
    });
  }

  const envKey = process.env[`${provider.toUpperCase()}_API_KEY`] || "";
  const apiKey = overrides.apiKey || sessionConfig.apiKey || envKey;

  const envModel = process.env[`${provider.toUpperCase()}_MODEL`] || "";
  const model =
    overrides.model ||
    sessionConfig.model ||
    envModel ||
    DEFAULT_MODELS[provider];

  const envBaseUrl = process.env[`${provider.toUpperCase()}_BASE_URL`] ||
                     (provider === "ollama" ? process.env.OLLAMA_BASE_URL : "") || "";
  const baseUrl = overrides.baseUrl || sessionConfig.baseUrl || envBaseUrl || null;

  // ── Call the provider adapter ──
  const adapter = PROVIDERS[provider];
  const startTime = Date.now();

  // Append retry suffix if this is a second attempt due to bad JSON
  const effectiveUserPrompt = isRetry ? userPrompt + JSON_RETRY_SUFFIX : userPrompt;

  logger.info(`LLM call: provider=${provider} model=${model}${isRetry ? " [RETRY]" : ""}`);
  logger.debug("LLM prompt (system)", { systemPrompt: systemPrompt.slice(0, 200) });
  logger.debug("LLM prompt (user)", { userPrompt: effectiveUserPrompt.slice(0, 500) });

  // Rate-limit retry constants and helper are defined at module level
  let result;
  let rateLimitAttempt = 0;

  while (true) {
    try {
      result = await adapter.call(systemPrompt, effectiveUserPrompt, apiKey, model, baseUrl, maxTokens || undefined);
      break; // success — exit retry loop
    } catch (err) {
      const latencyMs = Date.now() - startTime;

      // ── Rate limit (429) — wait and retry ────────────────────────────────
      if (err.code === "RATE_LIMITED" && retryOnRateLimit && rateLimitAttempt < MAX_RATE_LIMIT_RETRIES) {
        rateLimitAttempt++;
        const waitMs = computeRetryDelayMs(err);
        logger.warn(
          `LLM rate limited: provider=${provider} attempt=${rateLimitAttempt}/${MAX_RATE_LIMIT_RETRIES} ` +
          `waiting=${(waitMs / 1000).toFixed(0)}s before retry`
        );
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        logger.info(`LLM rate-limit retry ${rateLimitAttempt}/${MAX_RATE_LIMIT_RETRIES}: provider=${provider}`);
        continue; // retry the adapter call
      }

      // ── Other errors — wrap and throw ────────────────────────────────────
      logger.error(`LLM call failed: provider=${provider} model=${model} latency=${latencyMs}ms`, {
        code: err.code,
        message: err.message,
        statusCode: err.statusCode,
      });

      if (err instanceof LLMError) throw err;

      const retryable = ["NETWORK_ERROR", "RATE_LIMITED", "PROVIDER_DOWN"].includes(err.code);
      throw new LLMError(err.message, {
        code: err.code || "PROVIDER_ERROR",
        provider,
        model,
        statusCode: err.statusCode,
        retryable,
        rawBody: err.rawBody,
      });
    }
  }

  const latencyMs = Date.now() - startTime;
  logger.info(
    `LLM success: provider=${provider} model=${model} ` +
    `tokens=${result.tokensUsed ?? "N/A"} latency=${latencyMs}ms`
  );
  logger.debug("LLM response", { text: result.text.slice(0, 500) });

  return { text: result.text, tokensUsed: result.tokensUsed ?? 0 };
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  callLLM,
  LLMError,
  sessionConfig,  // exported so llm-config.js can mutate it
  PROVIDERS,      // exported so llm-config.js can enumerate keys
  DEFAULT_MODELS, // exported for /api/llm/providers endpoint
};

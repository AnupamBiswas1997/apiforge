/**
 * server/providers/gemini.js — Google Gemini API adapter
 *
 * API docs: https://ai.google.dev/api/generate-content
 *
 * Quirks / notes:
 *   - API key is passed as a URL query parameter (?key=...), NOT a header
 *   - System prompt uses a different field: system_instruction.parts[].text
 *   - User message is under contents[].parts[].text (no role field on outer object)
 *   - The model is part of the URL path, not the request body
 *   - Response is at candidates[0].content.parts[0].text
 *   - Token count is at usageMetadata.totalTokenCount
 *   - Uses v1beta endpoint for system instruction support
 *
 * Required request fields: contents
 * Optional: system_instruction, generationConfig, safetySettings
 *
 * How to get an API key: https://aistudio.google.com/app/apikey
 */

"use strict";

const axios = require("axios");
const logger = require("../logger");

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";
const MAX_TOKENS = 4096;

/**
 * @description Call the Google Gemini generateContent API.
 * @param {string} systemPrompt - Instruction context for the model
 * @param {string} userPrompt - The user's request
 * @param {string} apiKey - Gemini API key (AIza...)
 * @param {string} model - Model string e.g. "gemini-1.5-pro"
 * @param {string} [baseUrl] - Override base URL
 * @returns {Promise<{text: string, tokensUsed: number|null}>}
 * @throws {Error} With classified .code field
 */
async function call(systemPrompt, userPrompt, apiKey, model, baseUrl, maxTokens) {
  const base = baseUrl || GEMINI_BASE_URL;
  // QUIRK: Model is embedded in the URL path for Gemini, not in the body
  // v1beta is required for system_instruction support
  const url = `${base}/v1beta/models/${model}:generateContent?key=${apiKey}`;

  logger.debug("Gemini: sending request", { model, url: url.replace(apiKey, "***") });

  let response;
  try {
    response = await axios.post(
      url,
      {
        // QUIRK: system_instruction is separate from contents (unlike OpenAI)
        system_instruction: {
          parts: [{ text: systemPrompt }],
        },
        contents: [
          {
            // QUIRK: Gemini wraps the user message in parts array
            parts: [{ text: userPrompt }],
          },
        ],
        generationConfig: {
          maxOutputTokens: maxTokens || MAX_TOKENS,
        },
      },
      {
        headers: { "Content-Type": "application/json" },
        timeout: 60000,  // 60s — generation steps with 4096 tokens can be slow
      }
    );
  } catch (err) {
    if (err.response) {
      const status = err.response.status;
      const body = err.response.data;

      if (status === 400 && body?.error?.message?.includes("API_KEY_INVALID")) {
        const e = new Error("Invalid Gemini API key");
        e.code = "INVALID_KEY";
        e.statusCode = 400;
        e.rawBody = body;
        throw e;
      }
      if (status === 401 || status === 403) {
        const e = new Error("Gemini API key unauthorized");
        e.code = "INVALID_KEY";
        e.statusCode = status;
        e.rawBody = body;
        throw e;
      }
      if (status === 429) {
        const e = new Error("Gemini rate limit exceeded");
        e.code = "RATE_LIMITED";
        e.statusCode = 429;
        e.rawBody = body;
        throw e;
      }
      if (status === 404) {
        const e = new Error(`Gemini model not found: ${model}`);
        e.code = "MODEL_NOT_FOUND";
        e.statusCode = 404;
        e.rawBody = body;
        throw e;
      }
      if (status >= 500) {
        const e = new Error("Gemini API is unavailable (5xx)");
        e.code = "PROVIDER_DOWN";
        e.statusCode = status;
        e.rawBody = body;
        throw e;
      }
      const e = new Error(`Gemini API error: ${status}`);
      e.code = "PROVIDER_ERROR";
      e.statusCode = status;
      e.rawBody = body;
      throw e;
    }
    if (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND" ||
        err.code === "ETIMEDOUT" || err.message.includes("timeout")) {
      const e = new Error(`Network error connecting to Gemini: ${err.message}`);
      e.code = "NETWORK_ERROR";
      throw e;
    }
    throw err;
  }

  // QUIRK: Gemini returns candidates array; text is nested inside parts
  const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    // Check if response was blocked by safety filters
    const blockReason = response.data?.candidates?.[0]?.finishReason;
    if (blockReason === "SAFETY") {
      const e = new Error("Gemini blocked the response for safety reasons");
      e.code = "CONTENT_FILTERED";
      e.rawBody = response.data;
      throw e;
    }
    const e = new Error("Gemini returned an unexpected response shape");
    e.code = "UNEXPECTED_RESPONSE";
    e.rawBody = response.data;
    throw e;
  }

  const tokensUsed = response.data?.usageMetadata?.totalTokenCount || null;
  return { text, tokensUsed };
}

module.exports = { call };

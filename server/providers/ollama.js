/**
 * server/providers/ollama.js — Ollama local LLM adapter
 *
 * API docs: https://github.com/ollama/ollama/blob/main/docs/api.md
 *
 * Quirks / notes:
 *   - No API key required — Ollama runs entirely locally
 *   - stream must be false to get a single JSON response (not NDJSON)
 *   - Response text is at message.content (not choices[])
 *   - The user must have Ollama running: `ollama serve`
 *   - The model must be pulled: `ollama pull llama3`
 */

"use strict";

const axios  = require("axios");
const logger = require("../logger");

const DEFAULT_OLLAMA_URL = "http://localhost:11434";

/**
 * @description Call the Ollama local API (non-streaming chat mode).
 * @param {string} systemPrompt - Instruction context
 * @param {string} userPrompt   - The user's request
 * @param {string} _apiKey      - Unused (Ollama needs no key)
 * @param {string} model        - Model name e.g. "llama3", "mistral", "phi3"
 * @param {string} [baseUrl]    - Ollama base URL (default: http://localhost:11434)
 * @returns {Promise<{text: string, tokensUsed: null}>}
 * @throws {Error} With classified .code field
 */
async function call(systemPrompt, userPrompt, _apiKey, model, baseUrl, maxTokens) {
  const base = baseUrl || process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_URL;
  const url  = `${base.replace(/\/$/, "")}/api/chat`;

  logger.debug("Ollama: sending request", { model, url });

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
        stream: false,
        ...(maxTokens ? { options: { num_predict: maxTokens } } : {}), // optional output length limit
      },
      {
        headers: { "Content-Type": "application/json" },
        timeout: 120000, // Ollama on CPU can be slow
      }
    );
  } catch (err) {
    if (err.response) {
      const status = err.response.status;
      const body   = err.response.data;

      if (status === 404) {
        const e = new Error(`Ollama model not found: "${model}". Run: ollama pull ${model}`);
        e.code       = "MODEL_NOT_FOUND";
        e.statusCode = 404;
        e.rawBody    = body;
        throw e;
      }
      if (status >= 500) {
        const e = new Error("Ollama server error");
        e.code       = "PROVIDER_DOWN";
        e.statusCode = status;
        e.rawBody    = body;
        throw e;
      }
      const e = new Error(`Ollama error: ${status}`);
      e.code       = "PROVIDER_ERROR";
      e.statusCode = status;
      e.rawBody    = body;
      throw e;
    }
    if (err.code === "ECONNREFUSED") {
      const e = new Error(`Cannot connect to Ollama at ${base}. Is Ollama running? Run: ollama serve`);
      e.code = "NETWORK_ERROR";
      throw e;
    }
    if (err.code === "ENOTFOUND" || err.code === "ETIMEDOUT" || err.message.includes("timeout")) {
      const e = new Error(`Network error connecting to Ollama: ${err.message}`);
      e.code = "NETWORK_ERROR";
      throw e;
    }
    throw err;
  }

  // Ollama chat response: message.content (not choices[])
  const text = response.data?.message?.content;
  if (!text) {
    const e = new Error("Ollama returned an unexpected response shape");
    e.code    = "UNEXPECTED_RESPONSE";
    e.rawBody = response.data;
    throw e;
  }

  return { text, tokensUsed: null };
}

module.exports = { call };

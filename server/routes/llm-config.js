/**
 * server/routes/llm-config.js — LLM provider configuration endpoints
 *
 * Responsible for:
 *   - GET /api/llm/providers — list all providers with connection status
 *   - POST /api/llm/connect — test + activate a provider config
 *   - GET /api/llm/active — return current active provider (masked)
 *
 * NOT responsible for:
 *   - Persisting API keys to disk (keys are session-memory only)
 *   - Provider adapter implementations (those are in server/providers/)
 *
 * Side effects: Mutates sessionConfig in server/llm.js on successful connect.
 */

"use strict";

const express   = require("express");
const rateLimit = require("express-rate-limit");
const { callLLM, sessionConfig, PROVIDERS, DEFAULT_MODELS, LLMError } = require("../llm");
const logger    = require("../logger");

const router = express.Router();

// Rate limit /api/llm/connect to prevent API key brute-forcing
// 10 attempts per minute per IP — generous for legitimate use, tight for abuse
const connectLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max:      10,
  message:  { error: { code: "RATE_LIMITED", message: "Too many connection attempts. Please wait 1 minute." } },
  standardHeaders: true,
  legacyHeaders:   false,
});

// ─── Provider metadata ────────────────────────────────────────────────────────
// Static metadata for all 5 supported providers.
// "fields" describes what the frontend should render for each provider.
const PROVIDER_META = {
  anthropic: {
    key:             "anthropic",
    displayName:     "Anthropic Claude",
    requiresApiKey:  true,
    requiresBaseUrl: false,
    fields: [
      { name: "apiKey",  label: "API Key",  placeholder: "sk-ant-...", secret: true  },
      { name: "model",   label: "Model",    placeholder: DEFAULT_MODELS.anthropic, secret: false },
    ],
  },
  openai: {
    key:             "openai",
    displayName:     "OpenAI",
    requiresApiKey:  true,
    requiresBaseUrl: false,
    fields: [
      { name: "apiKey",  label: "API Key",  placeholder: "sk-...", secret: true  },
      { name: "model",   label: "Model",    placeholder: DEFAULT_MODELS.openai,    secret: false },
    ],
  },
  gemini: {
    key:             "gemini",
    displayName:     "Google Gemini",
    requiresApiKey:  true,
    requiresBaseUrl: false,
    fields: [
      { name: "apiKey",  label: "API Key",  placeholder: "AIza...", secret: true  },
      { name: "model",   label: "Model",    placeholder: DEFAULT_MODELS.gemini,   secret: false },
    ],
  },
  mistral: {
    key:             "mistral",
    displayName:     "Mistral AI",
    requiresApiKey:  true,
    requiresBaseUrl: false,
    fields: [
      { name: "apiKey",  label: "API Key",  placeholder: "...", secret: true  },
      { name: "model",   label: "Model",    placeholder: DEFAULT_MODELS.mistral,  secret: false },
    ],
  },
  ollama: {
    key:             "ollama",
    displayName:     "Ollama (local)",
    requiresApiKey:  false,
    requiresBaseUrl: true,
    fields: [
      { name: "baseUrl", label: "Base URL", placeholder: "http://localhost:11434", secret: false },
      { name: "model",   label: "Model",    placeholder: DEFAULT_MODELS.ollama,   secret: false },
    ],
  },
  marsmax: {
    key:             "marsmax",
    displayName:     "Mars Max",
    requiresApiKey:  true,
    requiresBaseUrl: false,
    fields: [
      { name: "apiKey",  label: "Bearer Token", placeholder: "pk-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", secret: true  },
      { name: "model",   label: "Model",         placeholder: DEFAULT_MODELS.marsmax, secret: false },
    ],
  },
  openrouter: {
    key:             "openrouter",
    displayName:     "OpenRouter",
    requiresApiKey:  true,
    requiresBaseUrl: false,
    fields: [
      { name: "apiKey",  label: "API Key",  placeholder: "sk-or-v1-...",                  secret: true  },
      { name: "model",   label: "Model",    placeholder: DEFAULT_MODELS.openrouter,        secret: false },
    ],
  },
};

/**
 * @description Mask an API key for display — show only first 8 chars + ●●●●
 * Never returns null/undefined — returns empty string if no key.
 * @param {string} key - Raw API key to mask
 * @returns {string} Masked string e.g. "sk-ant-ap●●●●"
 */
function maskKey(key) {
  if (!key) return "";
  // For short keys/tokens, never reveal the full value — cap the visible
  // prefix at half the key length (min 2, max 8 chars).
  const visibleLen = Math.max(2, Math.min(8, Math.floor(key.length / 2)));
  const prefix = key.slice(0, visibleLen);
  return `${prefix}●●●●`;
}

/**
 * GET /api/llm/providers
 * Returns all provider metadata including which are currently configured.
 * "configured" means the API key is present in env OR was set via /connect this session.
 */
router.get("/providers", (req, res) => {
  const activeProvider = sessionConfig.provider || process.env.LLM_PROVIDER || "anthropic";
  const activeModel    = sessionConfig.model ||
    process.env[`${activeProvider.toUpperCase()}_MODEL`] ||
    DEFAULT_MODELS[activeProvider];

  const providers = Object.values(PROVIDER_META).map((meta) => {
    // A provider is "configured" if we have a key for it (env or session)
    const envKey  = process.env[`${meta.key.toUpperCase()}_API_KEY`];
    const hasKey  = meta.key === "ollama"
      ? true // Ollama never needs a key
      : !!(envKey || (sessionConfig.provider === meta.key && sessionConfig.apiKey));

    return {
      ...meta,
      configured: hasKey,
    };
  });

  res.json({ activeProvider, activeModel, providers });
});

/**
 * POST /api/llm/connect
 * Body: { provider, apiKey?, model?, baseUrl? }
 * Tests the connection and activates the provider for this session.
 */
router.post("/connect", connectLimiter, async (req, res) => {
  const { provider, apiKey, model, baseUrl } = req.body || {};

  // Validate provider key
  if (!provider || !PROVIDERS[provider]) {
    return res.status(400).json({
      error: {
        code:    "INVALID_PROVIDER",
        message: `Unknown provider "${provider}". Supported: ${Object.keys(PROVIDERS).join(", ")}`,
      },
    });
  }

  // Validate that API key is provided for providers that require it
  const meta = PROVIDER_META[provider];
  if (meta.requiresApiKey && !apiKey) {
    // Check env as fallback
    const envKey = process.env[`${provider.toUpperCase()}_API_KEY`];
    if (!envKey) {
      return res.status(400).json({
        error: {
          code:    "MISSING_API_KEY",
          message: `Provider "${provider}" requires an API key.`,
        },
      });
    }
  }

  const effectiveModel   = model || process.env[`${provider.toUpperCase()}_MODEL`] || DEFAULT_MODELS[provider];
  const effectiveApiKey  = apiKey || process.env[`${provider.toUpperCase()}_API_KEY`] || "";
  const effectiveBaseUrl = baseUrl || process.env[`${provider.toUpperCase()}_BASE_URL`] ||
    (provider === "ollama" ? process.env.OLLAMA_BASE_URL : null) || null;

  logger.info(`LLM connect test: provider=${provider} model=${effectiveModel}`);

  const startTime = Date.now();
  let testResponse;
  try {
    // Use a neutral, content-filter-safe prompt.
    // Avoid words like "test", "CONNECTED", "reply" which can trigger
    // Azure OpenAI / corporate content filters at some gateways (e.g. Mars Max).
    // We check that the model returns a number close to 4 to confirm it's working.
    // retryOnRateLimit=false: this is a quick connectivity check triggered by
    // the user clicking "Test Connection" — we want a fast pass/fail, not a
    // silent 48+ second wait if the provider happens to be rate limited right now.
    // maxTokens=20: the expected response is a single digit.
    const llmResult = await callLLM(
      "You are a helpful assistant. Answer concisely.",
      "What is 2 plus 2? Reply with just the number.",
      { provider, apiKey: effectiveApiKey, model: effectiveModel, baseUrl: effectiveBaseUrl },
      false,
      20,
      false
    );
    testResponse = llmResult.text;
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    logger.warn(`LLM connect failed: provider=${provider}`, { code: err.code, message: err.message });

    // All connect-test failures are reported as 400 — from the frontend's
    // perspective, a failed connectivity check is always something the user
    // can act on (fix the key, wait and retry, top up credits, etc.).
    return res.status(400).json({
      success:   false,
      latencyMs,
      error: {
        code:    err.code || "CONNECTION_FAILED",
        message: err.message,
        detail:  err.rawBody
          ? (typeof err.rawBody === "string"
              ? err.rawBody.slice(0, 400)
              : JSON.stringify(err.rawBody).slice(0, 400))
          : undefined,
      },
    });
  }

  const latencyMs = Date.now() - startTime;

  // Accept any response that contains a digit — the model answered the math question.
  // This is intentionally loose so minor formatting differences don't cause false failures.
  if (!/\d/.test(testResponse)) {
    logger.warn(`LLM connect: unexpected response from ${provider}`, { testResponse });
    return res.status(400).json({
      success:      false,
      latencyMs,
      testResponse,
      error: {
        code:    "UNEXPECTED_RESPONSE",
        message: "Provider responded but returned an unexpected answer. The model may not be working correctly.",
      },
    });
  }

  // ── Success — store in session config ──
  // Mutate the exported sessionConfig object so all subsequent callLLM() calls
  // use this provider without needing a server restart.
  sessionConfig.provider = provider;
  sessionConfig.apiKey   = effectiveApiKey;
  sessionConfig.model    = effectiveModel;
  sessionConfig.baseUrl  = effectiveBaseUrl;

  logger.info(`LLM connected: provider=${provider} model=${effectiveModel} latency=${latencyMs}ms`);

  res.json({
    success:      true,
    provider,
    model:        effectiveModel,
    latencyMs,
    testResponse, // Include for debugging on the frontend
  });
});

/**
 * GET /api/llm/active
 * Returns the currently active provider config with the API key masked.
 */
router.get("/active", (req, res) => {
  const activeProvider = sessionConfig.provider || process.env.LLM_PROVIDER || null;
  if (!activeProvider) {
    return res.json({ configured: false });
  }

  const activeModel = sessionConfig.model ||
    process.env[`${activeProvider.toUpperCase()}_MODEL`] ||
    DEFAULT_MODELS[activeProvider];

  const rawKey = sessionConfig.apiKey || process.env[`${activeProvider.toUpperCase()}_API_KEY`] || "";

  res.json({
    configured:  true,
    provider:    activeProvider,
    displayName: PROVIDER_META[activeProvider]?.displayName || activeProvider,
    model:       activeModel,
    maskedKey:   maskKey(rawKey),
    baseUrl:     sessionConfig.baseUrl || null,
  });
});

module.exports = router;

/**
 * server/providers/marsmax.js — Mars Max LLM Gateway adapter
 *
 * Endpoint: https://max-uat-apim.mars-dna.com/llm-gateway/gateway/chat/completions
 *
 * Key characteristics (from reference implementation + reverse engineering):
 *   - Internal Mars corporate API gateway (Azure APIM)
 *   - Bearer token format: pk-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 *   - model: "auto" (gateway selects best available model)
 *   - app_name: "Default" required in request body
 *   - Message content must be an array of content blocks (not plain string)
 *   - System prompt is merged as first text block inside the user message
 *   - Token usage at data.metrics.usage (prompt_tokens, completion_tokens)
 *   - UAT gateway has a self-signed / intercepted TLS certificate —
 *     rejectUnauthorized: false is required
 *   - Uses raw https.request (not axios) to support the insecure agent
 */

"use strict";

const https  = require("https");
const logger = require("../logger");

const MARSMAX_API_URL  = "https://max-uat-apim.mars-dna.com/llm-gateway/gateway/chat/completions";
const MARSMAX_APP_NAME = "Default";

// Dedicated TLS agent that accepts the Mars UAT self-signed certificate.
// Scoped only to this provider — all others still verify TLS normally.
const insecureAgent = new https.Agent({ rejectUnauthorized: false });

/**
 * Low-level HTTP POST using Node's built-in https module.
 * Returns { statusCode, statusMessage, headers, body }.
 */
function httpsPost(url, headers, bodyStr) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method:  "POST",
        headers: {
          ...headers,
          "Content-Length": Buffer.byteLength(bodyStr),
        },
        agent:   insecureAgent,
        timeout: 120000, // 2 minutes — Mars Max generation can be slow for complex prompts
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data",  (chunk) => { raw += chunk; });
        res.on("end",   () => resolve({
          statusCode:    res.statusCode,
          statusMessage: res.statusMessage,
          headers:       res.headers,
          body:          raw,
        }));
        res.on("error", reject);
      }
    );
    req.on("error",   reject);
    req.on("timeout", () => {
      req.destroy();
      reject(Object.assign(new Error("Request timed out after 120s"), { code: "ETIMEDOUT" }));
    });
    req.write(bodyStr);
    req.end();
  });
}

/**
 * @description Call the Mars Max LLM Gateway.
 *
 * @param {string} systemPrompt - Instruction context
 * @param {string} userPrompt   - The actual request
 * @param {string} apiKey       - Bearer token (pk-...)
 * @param {string} model        - "auto" or specific model name
 * @param {string} [baseUrl]    - Override URL (e.g. future prod endpoint)
 * @returns {Promise<{text: string, tokensUsed: number|null}>}
 */
async function call(systemPrompt, userPrompt, apiKey, model, baseUrl, maxTokens) {
  const url = (baseUrl || MARSMAX_API_URL).replace(/\/$/, "");

  // Mars Max gateway format (from reference implementation):
  // - System prompt is prepended into the user message as a text block
  // - Content must be an array of typed blocks, not a plain string
  // - app_name is required at the top level
  const payload = {
    model:      model || "auto",
    app_name:   MARSMAX_APP_NAME,
    max_tokens: maxTokens || 4096,  // caller can reduce for extraction steps to avoid timeout
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: systemPrompt
              ? `${systemPrompt}\n\n${userPrompt}`
              : userPrompt,
          },
        ],
      },
    ],
  };

  const bodyStr = JSON.stringify(payload);
  const headers = {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type":  "application/json",
  };

  logger.debug("MarsMax: sending request", { url, model: payload.model, bodyLength: bodyStr.length });

  let res;
  try {
    res = await httpsPost(url, headers, bodyStr);
  } catch (err) {
    if (err.code === "ETIMEDOUT" || err.message.includes("timed out")) {
      const e = new Error("Mars Max gateway timed out (120s). Try reducing prompt complexity or contact your platform team.");
      e.code = "NETWORK_ERROR";
      throw e;
    }
    if (["ECONNREFUSED", "ENOTFOUND", "ECONNRESET"].includes(err.code)) {
      const e = new Error(`Cannot reach Mars Max gateway (${err.code}): ${url}`);
      e.code = "NETWORK_ERROR";
      throw e;
    }
    throw err;
  }

  logger.debug("MarsMax: response", { status: res.statusCode, bodyLength: res.body.length });

  // Try to parse JSON — gateway may return plain text errors too
  let data = null;
  try { data = JSON.parse(res.body); } catch { /* keep data null */ }

  // ── Error responses ──────────────────────────────────────────────────────
  if (res.statusCode < 200 || res.statusCode >= 300) {
    // Extract the most useful error message from the body
    const bodyMsg = data?.error?.message
      || data?.message
      || (typeof data === "string" ? data : null)
      || res.body.slice(0, 300)
      || res.statusMessage;

    logger.warn("MarsMax: error response", {
      status: res.statusCode,
      body:   res.body.slice(0, 500),
    });

    if (res.statusCode === 401 || res.statusCode === 403) {
      // Distinguish between "host not allowed" (network/IP issue) vs bad token
      const isHostBlocked = res.body.includes("Host not in allowlist") ||
                            res.headers["x-deny-reason"] === "host_not_allowed";
      const e = isHostBlocked
        ? new Error(
            "Mars Max gateway blocked this server's IP address. " +
            "Ensure your APIForge server is running on a machine whose IP is " +
            "on the Mars APIM allowlist. The token itself may be valid."
          )
        : new Error(`Mars Max: unauthorised — ${bodyMsg}`);
      e.code       = isHostBlocked ? "NETWORK_ERROR" : "INVALID_KEY";
      e.statusCode = res.statusCode;
      e.rawBody    = res.body;
      throw e;
    }

    if (res.statusCode === 429) {
      const e = new Error(`Mars Max rate limit exceeded — ${bodyMsg}`);
      e.code       = "RATE_LIMITED";
      e.statusCode = 429;
      e.rawBody    = res.body;
      throw e;
    }

    if (res.statusCode === 404) {
      const e = new Error(
        `Mars Max model not found: "${payload.model}". ` +
        `Contact your Mars platform team for valid model names. (${bodyMsg})`
      );
      e.code       = "MODEL_NOT_FOUND";
      e.statusCode = 404;
      e.rawBody    = res.body;
      throw e;
    }

    if (res.statusCode === 400) {
      // 400 means auth passed but payload is wrong — surface the exact body
      const e = new Error(
        `Mars Max rejected the request (400). Gateway said: ${bodyMsg}. ` +
        `Check that app_name="${MARSMAX_APP_NAME}" and model="${payload.model}" ` +
        `are valid for your token. Contact your Mars platform team if unsure.`
      );
      e.code       = "PROVIDER_ERROR";
      e.statusCode = 400;
      e.rawBody    = res.body;
      throw e;
    }

    if (res.statusCode >= 500) {
      const e = new Error(`Mars Max gateway unavailable (${res.statusCode}): ${bodyMsg}`);
      e.code       = "PROVIDER_DOWN";
      e.statusCode = res.statusCode;
      e.rawBody    = res.body;
      throw e;
    }

    const e = new Error(`Mars Max error ${res.statusCode}: ${bodyMsg}`);
    e.code       = "PROVIDER_ERROR";
    e.statusCode = res.statusCode;
    e.rawBody    = res.body;
    throw e;
  }

  // ── Success ──────────────────────────────────────────────────────────────
  const text = data?.choices?.[0]?.message?.content;
  if (!text) {
    const e = new Error(
      `Mars Max returned an unexpected response shape. ` +
      `Body: ${JSON.stringify(data)?.slice(0, 200)}`
    );
    e.code    = "UNEXPECTED_RESPONSE";
    e.rawBody = data;
    throw e;
  }

  // Usage is at data.metrics.usage; fall back to data.usage for prod endpoints
  const usage      = data?.metrics?.usage || data?.usage || {};
  const tokensUsed =
    ((usage.prompt_tokens    || 0) +
     (usage.completion_tokens || 0)) || usage.total_tokens || null;

  logger.info(`MarsMax: success — tokens=${tokensUsed ?? "N/A"}`);
  return { text, tokensUsed };
}

module.exports = { call };

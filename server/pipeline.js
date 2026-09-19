/**
 * server/pipeline.js — 6-step AI-powered API testing pipeline
 *
 * Steps:
 *   1. Extract Requirements — parse doc into structured requirements + base_url + headers
 *   2. Generate Test Cases  — happy path, negative, edge, auth cases per endpoint
 *   3. Generate Payloads    — ground each test case payload from the example_payload template
 *   4. Execute APIs         — send real HTTP requests and capture responses
 *   5. Analyse Responses    — LLM judges each response using intent-based OR logic
 *   6. Compile Report       — aggregate metrics + write executive summary
 */

"use strict";

const axios   = require("axios");
const https   = require("https");
const { v4: uuidv4 } = require("uuid");
const { callLLM, sessionConfig, DEFAULT_MODELS } = require("./llm");
const storage = require("./storage");
const logger  = require("./logger");

// ─── HTTPS agents for API execution ──────────────────────────────────────────
// Two agents: secure (default) and insecure (fallback or explicit override).
// The insecure agent is used when:
//   a) ALLOW_INSECURE_TLS=true is set in .env (skip the secure attempt entirely), OR
//   b) The secure request fails with a certificate error — auto-retry transparently.
// This mirrors Postman's default behaviour (SSL verification OFF by default).
// insecureAgent is used for auto-fallback on TLS cert errors and when ALLOW_INSECURE_TLS=true
// No separate secureAgent needed — axios uses Node.js default TLS verification by default
const insecureAgent = new https.Agent({ rejectUnauthorized: false });

// Set of error codes / message fragments that indicate a TLS certificate problem
const TLS_ERROR_CODES = new Set([
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "CERT_UNTRUSTED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "UNABLE_TO_GET_ISSUER_CERT",
  "CERT_HAS_EXPIRED",
]);

function isTlsError(err) {
  if (!err) return false;
  if (TLS_ERROR_CODES.has(err.code)) return true;
  const msg = (err.message || "").toLowerCase();
  return (
    msg.includes("certificate") ||
    msg.includes("ssl") ||
    msg.includes("tls") ||
    msg.includes("self signed") ||
    msg.includes("issuer")
  );
}

const forceTlsOff = process.env.ALLOW_INSECURE_TLS === "true";
if (forceTlsOff) {
  logger.warn(
    "⚠ ALLOW_INSECURE_TLS=true — TLS certificate verification disabled for all API requests."
  );
}

// ─── SSE client registry ─────────────────────────────────────────────────────
const sseClients = new Map();

function emit(runId, event, data) {
  const clients = sseClients.get(runId);
  if (!clients || clients.size === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try { res.write(payload); }
    catch { clients.delete(res); }
  }
}

// ─── JSON helpers ─────────────────────────────────────────────────────────────

/**
 * Strip markdown fences, attempt parse, attempt truncation repair on failure.
 */
function parseJSON(text) {
  const stripped = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

  try { return JSON.parse(stripped); }
  catch (firstErr) {
    try {
      const repaired = repairTruncatedJSON(stripped);
      const result   = JSON.parse(repaired);
      logger.warn("parseJSON: repaired truncated JSON", {
        originalLength: stripped.length,
        repairedLength: repaired.length,
      });
      return result;
    } catch {
      throw firstErr;
    }
  }
}

/**
 * Recover a JSON array that was cut off mid-stream by finding the last
 * complete top-level object and closing the array.
 */
function repairTruncatedJSON(text) {
  if (!text.trimStart().startsWith("[")) return text;
  let depth = 0;
  let lastCompleteObjEnd = -1;
  let inString = false;
  let escape   = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape)           { escape = false; continue; }
    if (ch === "\\")    { escape = true;  continue; }
    if (ch === "\"")     { inString = !inString; continue; }
    if (inString)         { continue; } // skip everything inside a string
    if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 1 && ch === "}") lastCompleteObjEnd = i;
    }
  }
  if (lastCompleteObjEnd === -1) return text;
  return text.slice(0, lastCompleteObjEnd + 1) + "]";
}

/**
 * Given a full URL (possibly including an endpoint path) and the endpoint path,
 * reliably extract just the base URL (scheme + host + any shared prefix).
 *
 * Examples:
 *   extractBaseUrl("https://stage.api.example.com/user-validation", "/user-validation")
 *   → "https://stage.api.example.com"
 *
 *   extractBaseUrl("https://api.example.com/v1", "/v1/users")
 *   → "https://api.example.com"
 */
function extractBaseUrl(rawUrl, endpoint) {
  if (!rawUrl) return "";
  try {
    const parsed = new URL(rawUrl);
    // If the full URL ends with the endpoint, strip it
    if (endpoint && parsed.pathname.endsWith(endpoint)) {
      const base = parsed.pathname.slice(0, parsed.pathname.length - endpoint.length);
      return `${parsed.protocol}//${parsed.host}${base}`.replace(/\/$/, "");
    }
    // Otherwise return scheme+host only (safest)
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    // rawUrl isn't a valid URL — return as-is and let the user see the error
    return rawUrl;
  }
}

// ─── Prompts ──────────────────────────────────────────────────────────────────

const JSON_SYSTEM_PROMPT =
  "You are an expert API testing engineer and JSON API.\n" +
  "Return ONLY valid raw JSON — no explanation, no preamble, no markdown fences.\n" +
  "Your entire response must be parseable by JSON.parse().\n" +
  "Do not include ```json or ``` in your response.";

const STEP_LABELS = {
  1: "Extract Requirements",
  2: "Generate Test Cases",
  3: "Generate Payloads",
  4: "Execute APIs",
  5: "Analyze Responses",
  6: "Compile Report",
};

// ─── Provider display names (used in both runPipeline and rerunPipeline) ──────
const PROVIDER_DISPLAY_NAMES = {
  anthropic:  "Anthropic Claude",
  openai:     "OpenAI",
  gemini:     "Google Gemini",
  mistral:    "Mistral AI",
  ollama:     "Ollama (local)",
  marsmax:    "Mars Max",
  openrouter: "OpenRouter",
};

// ─── Pipeline ─────────────────────────────────────────────────────────────────

/**
 * @param {object} config
 * @param {string} config.runId
 * @param {string} config.requirementsText
 * @param {string} [config.baseUrl]     - Optional override; extracted from doc if omitted
 * @param {string} [config.authToken]   - Optional Bearer token override
 * @param {boolean} [config.dryRun]
 */
async function runPipeline({ runId, requirementsText, baseUrl: baseUrlOverride, authToken, dryRun = false }) {

  const activeProvider = sessionConfig.provider || process.env.LLM_PROVIDER || "anthropic";
  const activeModel    =
    sessionConfig.model ||
    process.env[`${activeProvider.toUpperCase()}_MODEL`] ||
    DEFAULT_MODELS[activeProvider];

  // ── Run object — initialised with placeholder baseUrl, updated after Step 1 ──
  const run = {
    runId,
    createdAt:        new Date().toISOString(),
    requirementsText,
    baseUrl:          baseUrlOverride || "",  // filled in properly after Step 1
    dryRun,
    status:           "running",
    llmProvider: {
      key:         activeProvider,
      displayName: PROVIDER_DISPLAY_NAMES[activeProvider] || activeProvider,
      model:       activeModel,
    },
    stepDurations:     {},
    totalTokensUsed:   0,
    tokensByStep:      {},
    totalTests:        0,
    passed:            0,
    failed:            0,
    warnings:          0,
    skipped:           0,
    passRate:          0,
    requirements:   [],
    testCases:      [],
    summary:        "",
    errors:         [],
  };

  function emitStep(step, extra = {}) {
    const label    = STEP_LABELS[step];
    const progress = Math.round(((step - 1) / 6) * 100);
    logger.info(`[${runId}] Step ${step}: ${label}`);
    emit(runId, "step", { step, label, progress, ...extra });
  }

  function emitLog(message) {
    emit(runId, "log", { message, timestamp: new Date().toISOString() });
  }

  /** Accumulate token usage from a callLLM result onto the run object. */
  function trackTokens(result, stepKey) {
    const t = result?.tokensUsed ?? 0;
    run.totalTokensUsed = (run.totalTokensUsed || 0) + t;
    run.tokensByStep[stepKey] = (run.tokensByStep[stepKey] || 0) + t;
  }

  const pipelineStart = Date.now();

  // Pre-clean requirements text: collapse excessive blank lines and trim whitespace.
  // This can significantly reduce token count for docs with lots of spacing.
  const cleanedRequirements = requirementsText
    .replace(/\r\n/g, "\n")          // normalise Windows line endings
    .replace(/\n{3,}/g, "\n\n")       // collapse 3+ blank lines to 2
    .replace(/[ \t]+\n/g, "\n")       // strip trailing spaces per line
    .trim();

  try {

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 1 — Extract Requirements + base URL + global headers from document
    // ══════════════════════════════════════════════════════════════════════════
    emitStep(1);
    emitLog("Extracting requirements, endpoint, and headers from document…");
    const step1Start = Date.now();

    // Small delay so the SSE client can connect and receive the step 1 event
    // before the first (potentially slow) LLM call begins.
    await new Promise((r) => setTimeout(r, 200));

    const step1Prompt = `Extract all testable API requirements from the following document.

Return a JSON object with exactly TWO top-level keys: "meta" and "apis".

"meta" — extracted once for the whole document:
{
  "base_url": "https://full-url-from-document.com",
  "global_headers": {
    "User-Agent": "copy exact User-Agent string if mentioned",
    "Content-Type": "application/json"
  }
}

Rules for base_url:
- If the document contains a full URL like "https://stage.api.example.com/user-validation",
  set base_url to that FULL URL (including the path). The pipeline will separate host from path.
- If a "Stage" or environment label precedes the URL, use that URL.
- Do NOT invent a URL — only use what is explicitly written in the document.

Rules for global_headers:
- Copy the User-Agent string EXACTLY if present. Do not paraphrase or shorten it.
- Always include "Content-Type": "application/json".

"apis" — array of endpoint objects. One object per distinct endpoint:
{
  "endpoint": "/path only — no host",
  "method": "GET|POST|PUT|PATCH|DELETE",
  "description": "what this endpoint does",
  "headers": {},
  "requestFields": [
    {"name": "fieldName", "type": "string|number|boolean|object|array", "required": true}
  ],
  "expectedSuccess": {"statusCode": 200, "description": "success response description"},
  "knownErrorCodes": [
    {"code": 1000, "error_type": "ValidateBody", "trigger": "invalid email", "message": "Invalid email address!"}
  ],
  "authRequired": false,
  "businessRules": ["rule 1"],
  "example_payload": {}
}

CRITICAL RULE FOR example_payload:
Search the document for ANY section labelled "Request", "Payload", "Body", "Sample", or containing a JSON block (curly braces).
Copy that JSON object VERBATIM into example_payload — every field name, every value, exactly as written.
DO NOT rename fields, omit fields, or change values. This is the ground truth template.
If no payload is found, build a minimal JSON object from the listed field names.

CRITICAL RULE FOR knownErrorCodes:
Extract every error response shown in the document. These will be used to validate test results.
Include error_code, error_type, what triggers it, and the message text.

Return ONLY the JSON object. No markdown. No explanation.

Document:
${cleanedRequirements}`;

    let step1Text;
    try {
      const s1r = await callLLM(JSON_SYSTEM_PROMPT, step1Prompt, {}, false, 2000);
      step1Text = s1r.text; trackTokens(s1r, "step1");
    } catch (llmErr) {
      if (llmErr.code === "NETWORK_ERROR") {
        logger.warn(`[${runId}] Step 1 timed out, retrying once…`);
        emitLog("Gateway timed out — retrying Step 1…");
        try {
          const s1r2 = await callLLM(JSON_SYSTEM_PROMPT, step1Prompt, {}, false, 2000);
          step1Text = s1r2.text; trackTokens(s1r2, "step1");
        } catch (retryErr) {
          throw new Error(`Step 1 failed after retry: ${retryErr.message}`);
        }
      } else {
        throw new Error(`Step 1 LLM call failed: ${llmErr.message}`);
      }
    }

    let step1Parsed;
    try {
      step1Parsed = parseJSON(step1Text);
    } catch (parseErr) {
      logger.warn(`[${runId}] Step 1 JSON parse failed, retrying`, { raw: step1Text.slice(0, 200) });
      emitLog("Retrying extraction…");
      const s1retry = await callLLM(JSON_SYSTEM_PROMPT, step1Prompt, {}, true, 2000);
      trackTokens(s1retry, "step1"); step1Parsed = parseJSON(s1retry.text);
    }

    // Accept both {meta, apis} (new) and plain array (legacy fallback)
    const requirements  = Array.isArray(step1Parsed) ? step1Parsed : (step1Parsed.apis || []);
    const meta          = (!Array.isArray(step1Parsed) && step1Parsed.meta) || {};

    // Resolve base URL: UI override → extracted from doc → empty
    const firstEndpoint = requirements[0]?.endpoint || "";
    const resolvedBaseUrl = baseUrlOverride
      || extractBaseUrl(meta.base_url || "", firstEndpoint)
      || "";

    run.baseUrl = resolvedBaseUrl;

    // Global headers from requirements doc (User-Agent, Content-Type, etc.)
    const extractedGlobalHeaders = meta.global_headers || {};

    if (!Array.isArray(requirements) || requirements.length === 0) {
      run.status = "failed";
      run.errors.push({ code: "INSUFFICIENT_REQUIREMENTS", step: 1 });
      storage.saveRun(runId, run);
      emit(runId, "error", {
        message: "No API endpoints could be extracted. Please provide more detail in your requirements.",
        code:    "INSUFFICIENT_REQUIREMENTS",
      });
      return;
    }

    run.requirements      = requirements;
    run.stepDurations.step1 = Date.now() - step1Start;
    storage.saveRun(runId, run);
    emitLog(`Extracted ${requirements.length} endpoint(s). Base URL: ${resolvedBaseUrl || "(not found)"} · ${(run.tokensByStep.step1||0).toLocaleString()} tokens`);
    if (Object.keys(extractedGlobalHeaders).length > 0) {
      emitLog(`Global headers: ${Object.keys(extractedGlobalHeaders).join(", ")}`);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 2 — Generate Test Cases
    // ══════════════════════════════════════════════════════════════════════════
    emitStep(2);
    emitLog("Generating test cases for each requirement…");
    const step2Start = Date.now();

    // Build the per-endpoint prompt for test case generation.
    // Sending all endpoints at once risks truncation for large APIs.
    // Instead, process endpoints in batches of 3 so each LLM call focuses on a
    // small set and produces comprehensive, un-truncated test cases.
    const STEP2_BATCH = 3;
    const step2Batches = [];
    for (let i = 0; i < requirements.length; i += STEP2_BATCH) {
      step2Batches.push(requirements.slice(i, i + STEP2_BATCH));
    }
    emitLog(`Generating test cases in ${step2Batches.length} batch(es) (${requirements.length} endpoint(s))…`);

    const step2PromptFor = (reqBatch) => `Given these API requirements, generate COMPREHENSIVE test cases.

For EACH endpoint generate ALL of the following test case types that apply:
1. Happy path           — valid payload, all required fields present, expect success
2. Email validation     — if email field exists: send malformed email, expect error
3. Phone validation     — if phone field exists: send non-numeric/short value, expect error
4. Missing required     — omit each required field one at a time, expect 400/422
5. Auth/token failure   — if token/auth header present: send invalid value, expect error
6. Duplicate submission — if API guards against re-entry: same data twice, expect limit error
7. Boundary/edge case   — empty string, null, wrong type, max-length value for key fields
8. Invalid barcode      — if barcode field present: send value not in valid list, expect error

Do NOT limit to 5. Generate every test case that makes sense for the endpoint.

For EACH test case:
- "fixed_payload_fields": fields that must NOT change from the example_payload.
  Always keep fixed: tokens, form_name, campaign IDs, barcodes, URLs, brand fields,
  country codes, language codes, IP addresses, UUIDs, optin fields, timestamps.
  Only vary: name, email, phone for uniqueness on happy path.
- "send_body": true for POST/PUT/PATCH; false for GET/DELETE with no body
- "headers": test-specific overrides only (empty {} for most)

Return a JSON array. Each element MUST have EXACTLY:
{
  "id": "tc-unique-id",
  "name": "Human readable name",
  "endpoint": "/path",
  "method": "POST",
  "category": "happy_path|negative|edge_case|auth",
  "description": "what is being tested",
  "expectedStatusCode": 200,
  "expectedBehavior": "what a correct response looks like",
  "send_body": true,
  "headers": {},
  "fixed_payload_fields": ["token", "form_name"]
}

Requirements:
${JSON.stringify(reqBatch.map((req) => ({
  endpoint:       req.endpoint,
  method:         req.method,
  description:    req.description,
  requestFields:  req.requestFields,
  expectedSuccess: req.expectedSuccess,
  authRequired:   req.authRequired,
  businessRules:  req.businessRules,
})), null, 2)}`;

    const allTestCases = [];
    for (let bi = 0; bi < step2Batches.length; bi++) {
      const reqBatch = step2Batches[bi];
      if (step2Batches.length > 1) {
        emitLog(`  Test case batch ${bi + 1}/${step2Batches.length} (${reqBatch.map(r => r.endpoint).join(", ")})…`);
      }
      const prompt = step2PromptFor(reqBatch);

      let s2Text;
      try {
        const s2r = await callLLM(JSON_SYSTEM_PROMPT, prompt, {}, false, 3000);
        s2Text = s2r.text; trackTokens(s2r, "step2");
      } catch (llmErr) {
        if (llmErr.code === "NETWORK_ERROR") {
          logger.warn(`[${runId}] Step 2 batch ${bi + 1} timed out, retrying…`);
          emitLog(`  Retrying test case batch ${bi + 1}…`);
          try {
            const s2r2 = await callLLM(JSON_SYSTEM_PROMPT, prompt, {}, false, 3000);
            s2Text = s2r2.text; trackTokens(s2r2, "step2");
          } catch (retryErr) {
            throw new Error(`Step 2 batch ${bi + 1} failed after retry: ${retryErr.message}`);
          }
        } else {
          throw new Error(`Step 2 LLM call failed (batch ${bi + 1}): ${llmErr.message}`);
        }
      }

      let batchCases;
      try {
        batchCases = parseJSON(s2Text);
      } catch {
        logger.warn(`[${runId}] Step 2 batch ${bi + 1} parse failed, retrying`);
        const s2retry = await callLLM(JSON_SYSTEM_PROMPT, prompt, {}, true, 3000);
        trackTokens(s2retry, "step2");
        batchCases = parseJSON(s2retry.text);
      }
      allTestCases.push(...batchCases);
    }

    // Ensure every test case has a real unique ID
    let testCases = allTestCases.map((tc) => ({
      ...tc,
      id: tc.id && tc.id !== "tc-unique-id" ? tc.id : `tc-${uuidv4().slice(0, 8)}`,
    }));

    run.testCases      = testCases;
    run.totalTests     = testCases.length;
    run.stepDurations.step2 = Date.now() - step2Start;
    storage.saveRun(runId, run);
    emitLog(`Generated ${testCases.length} test case(s) across ${requirements.length} endpoint(s). · ${(run.tokensByStep.step2||0).toLocaleString()} tokens`);

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 3 — Ground Payloads from example_payload template
    // ══════════════════════════════════════════════════════════════════════════
    emitStep(3);
    emitLog("Generating grounded request payloads…");
    const step3Start = Date.now();

    // Build a lookup: "METHOD:endpoint" → { example_payload, headers }
    const reqTemplateMap = {};
    for (const req of requirements) {
      const key = `${req.method?.toUpperCase()}:${req.endpoint}`;
      reqTemplateMap[key] = {
        example_payload: req.example_payload || {},
        headers:         req.headers || {},
      };
    }

    // Compute a real unique suffix once per run so every happy-path test gets
    // unique personal data without the LLM trying to execute JS code.
    const runUniq = String(Date.now()).slice(-5);

    // Process in batches of 5 to stay within token limits
    const STEP3_BATCH = 5;
    const step3Batches = [];
    for (let i = 0; i < testCases.length; i += STEP3_BATCH) {
      step3Batches.push(testCases.slice(i, i + STEP3_BATCH));
    }
    emitLog(`Generating payloads in ${step3Batches.length} batch(es)…`);

    const step3PromptFor = (batch, batchIndex) => {
      // Give each test case in a batch a distinct suffix so names don't collide
      const batchWithTemplates = batch.map((tc, tcIndex) => {
        const exactKey = `${tc.method?.toUpperCase()}:${tc.endpoint}`;
        // Fuzzy fallback: strip path params for matching
        const fuzzyEndpoint = tc.endpoint.replace(/\/:[^/]+/g, "").replace(/\/{[^}]+}/g, "");
        const fuzzyKey = `${tc.method?.toUpperCase()}:${fuzzyEndpoint}`;
        // Final fallback: first non-empty template in the map
        const tmpl =
          reqTemplateMap[exactKey] ||
          reqTemplateMap[fuzzyKey] ||
          Object.values(reqTemplateMap).find((t) => Object.keys(t.example_payload || {}).length > 0) ||
          {};

        const suffix = `${runUniq}${batchIndex}${tcIndex}`;

        return {
          ...tc,
          _example_payload:  tmpl.example_payload || {},
          _req_headers:      tmpl.headers || {},
          _unique_suffix:    suffix,
        };
      });

      return `You are an expert API tester. Generate a grounded request payload for each test case.

RULES — follow exactly:
1. "_example_payload" is the GROUND TRUTH TEMPLATE. Copy ALL its fields into request_body.
2. Fields in "fixed_payload_fields" MUST be copied verbatim from _example_payload — no changes.
3. "Content-Type": "application/json" must always be in headers. Merge _req_headers into headers.
4. Use "_unique_suffix" value (already computed — do NOT change it) to make personal data unique:
   - happy_path: append _unique_suffix to first_name, last_name; insert before @ in email;
     replace last digits of phone with _unique_suffix. Keep all other fields from template.
     If the template has a consumer_submission_date or similar timestamp field, update it to today's date.
   - negative email test: use "not-an-email" as the email value, keep everything else from template.
   - negative phone test: use "abc" as the phone value, keep everything else from template.
   - missing field test: remove ONE required field from template body, keep rest intact.
   - token/auth test: set token field to "invalid-token-99999", keep everything else from template.
5. If send_body is false → set request_body to null.
6. If _example_payload is empty ({}) → set request_body to null.

Auth token for authorised requests: ${authToken ? `Bearer ${authToken}` : "none provided"}
Base URL: ${resolvedBaseUrl}

Return a JSON array — one object per test case — with ONLY:
{
  "id": "same id as input",
  "request": {
    "headers": {"Content-Type": "application/json"},
    "query_params": null,
    "request_body": {},
    "pathParams": {}
  }
}

Test cases:
${JSON.stringify(batchWithTemplates, null, 2)}`;
    };

    const allEnriched = [];
    for (let bi = 0; bi < step3Batches.length; bi++) {
      const batch = step3Batches[bi];
      if (step3Batches.length > 1) emitLog(`  Payload batch ${bi + 1}/${step3Batches.length}…`);
      const prompt = step3PromptFor(batch, bi);

      let batchText;
      try {
        const s3r = await callLLM(JSON_SYSTEM_PROMPT, prompt, {}, false, 4096);
        batchText = s3r.text; trackTokens(s3r, "step3");
      } catch (llmErr) {
        if (llmErr.code === "NETWORK_ERROR") {
          logger.warn(`[${runId}] Step 3 batch ${bi + 1} timed out, retrying…`);
          emitLog(`  Step 3 batch ${bi + 1} timed out — retrying…`);
          try {
            const s3r2 = await callLLM(JSON_SYSTEM_PROMPT, prompt, {}, false, 4096);
            batchText = s3r2.text; trackTokens(s3r2, "step3");
          } catch (retryErr) {
            throw new Error(`Step 3 batch ${bi + 1} failed after retry: ${retryErr.message}`);
          }
        } else {
          throw new Error(`Step 3 batch ${bi + 1} failed: ${llmErr.message}`);
        }
      }

      let batchEnriched;
      try {
        batchEnriched = parseJSON(batchText);
      } catch (parseErr) {
        logger.warn(`[${runId}] Step 3 batch ${bi + 1} parse failed, retrying`, { err: parseErr.message });
        emitLog(`  Retrying payload batch ${bi + 1}…`);
        const s3retry = await callLLM(JSON_SYSTEM_PROMPT, prompt, {}, true, 4096);
        trackTokens(s3retry, "step3");
        try {
          batchEnriched = parseJSON(s3retry.text);
        } catch (retryErr) {
          logger.warn(`[${runId}] Step 3 batch ${bi + 1} retry also failed — using empty requests`, { err: retryErr.message });
          batchEnriched = batch.map((tc) => ({ id: tc.id, request: null }));
        }
      }
      allEnriched.push(...batchEnriched);
    }

    // Merge enriched payloads back — single canonical field names only (no duplicates)
    run.testCases = testCases.map((tc) => {
      const enriched = allEnriched.find((e) => e.id === tc.id) || {};
      const r        = enriched.request || {};
      return {
        ...tc,
        request: {
          headers:      { ...extractedGlobalHeaders, ...(r.headers || {}) },
          query_params: r.query_params ?? null,
          request_body: r.request_body ?? null,
          pathParams:   r.pathParams   || {},
        },
      };
    });

    run.stepDurations.step3 = Date.now() - step3Start;
    storage.saveRun(runId, run);
    emitLog(`Payloads generated. · ${(run.tokensByStep.step3||0).toLocaleString()} tokens`);

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 4 — Execute API Requests
    // ══════════════════════════════════════════════════════════════════════════
    emitStep(4);

    if (dryRun) {
      emitLog("Dry run — skipping API execution.");
      run.testCases = run.testCases.map((tc) => ({
        ...tc,
        actualResponse: {
          skipped:   true,
          durationMs: 0,
          // Include the URL that would have been called so report can display it
          actualUrl: resolvedBaseUrl
            ? `${resolvedBaseUrl.replace(/\/$/, "")}${tc.endpoint}`
            : tc.endpoint,
        },
      }));
    } else {
      if (!resolvedBaseUrl) {
        throw new Error(
          "No base URL found. Include a full endpoint URL in your requirements document " +
          "(e.g. 'https://stage.api.example.com/user-validation')."
        );
      }

      emitLog(`Executing ${run.testCases.length} request(s) against ${resolvedBaseUrl}…`);
      const step4Start = Date.now();

      // Global headers for every request:
      // extracted from document (User-Agent etc) + optional UI auth token.
      // Test-case-specific headers in tc.request.headers will override these in executeRequest.
      const globalHeaders = {
        "Content-Type": "application/json",
        ...extractedGlobalHeaders,
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      };

      for (let i = 0; i < run.testCases.length; i++) {
        const tc = run.testCases[i];
        emitLog(`  [${i + 1}/${run.testCases.length}] ${tc.method} ${tc.endpoint}`);

        let actualResponse;
        try {
          actualResponse = await executeRequest(tc, resolvedBaseUrl, globalHeaders);
        } catch (execErr) {
          logger.warn(`[${runId}] Request failed, retrying in 2s: ${tc.id}`, { err: execErr.message });
          emitLog(`  Retrying ${tc.method} ${tc.endpoint}…`);
          await new Promise((r) => setTimeout(r, 2000));
          try {
            actualResponse = await executeRequest(tc, resolvedBaseUrl, globalHeaders);
          } catch (retryErr) {
            logger.warn(`[${runId}] Request failed after retry: ${tc.id}`, { err: retryErr.message });
            actualResponse = {
              error:            retryErr.message,
              actualStatusCode: null,
              actualUrl:        `${resolvedBaseUrl}${tc.endpoint}`,
              responseBody:     null,
              durationMs:       0,
            };
            run.errors.push({ testCaseId: tc.id, step: 4, error: retryErr.message });
          }
        }

        run.testCases[i] = { ...tc, actualResponse };
      }

      run.stepDurations.step4 = Date.now() - step4Start;
      storage.saveRun(runId, run);
      emitLog("API execution complete.");
    }

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 5 — Analyse Responses (intent-based OR logic)
    // ══════════════════════════════════════════════════════════════════════════
    emitStep(5);
    emitLog("Analysing API responses…");
    const step5Start = Date.now();

    // Extract known error codes from requirements to give the LLM more context
    const knownErrorCodes = requirements.flatMap((r) => r.knownErrorCodes || []);

    const BATCH_SIZE = 10;
    const batches    = [];
    for (let i = 0; i < run.testCases.length; i += BATCH_SIZE) {
      batches.push(run.testCases.slice(i, i + BATCH_SIZE));
    }
    emitLog(`Analysing ${run.testCases.length} test(s) in ${batches.length} batch(es)…`);

    const step5PromptFor = (batch) => `You are a Senior API Quality Engineer performing FLEXIBLE SEMANTIC VALIDATION.

APPROACH — INTENT-BASED OR LOGIC:
- Apply a LENIENT approach. If ANY part of the response signals the API correctly handled the scenario → "pass".
- Only "fail" if the response completely contradicts expected behaviour.

KNOWN ERROR CODES FROM THIS API:
${JSON.stringify(knownErrorCodes, null, 2)}

EVALUATION RULES:
1. Status code matches expectedStatusCode → strong pass signal.
2. For happy_path tests: look for "error": false OR a CUSTOMER_ID OR Winner field → pass.
   "Not a Winner" response (error_code 1020) is a VALID response for happy path — the submission
   succeeded even if the user didn't win. Count it as pass if status is 200.
3. For negative/validation tests: look for matching error_code OR error_type OR message keyword.
   If the API returned the expected error code from knownErrorCodes → pass.
4. For auth/token tests: error_code 1004 (Token error) → pass.
5. DO NOT require exact message text matches. Partial keyword matches count.
6. If actualResponse.skipped → "skipped". If actualResponse.error (network) → "fail".
7. "warning": status matches but response structure has minor unexpected differences.

Return a JSON array — one object per test case:
{
  "id": "same id as input",
  "verdict": {
    "result": "pass|fail|warning|skipped",
    "analysis": "What signals confirmed pass or fail. Reference specific fields/codes found.",
    "issues": ["specific problem if failed"],
    "suggestions": ["actionable fix if failed"]
  }
}

Test cases:
${JSON.stringify(
  batch.map((tc) => ({
    id:                  tc.id,
    name:                tc.name,
    category:            tc.category,
    method:              tc.method,
    endpoint:            tc.endpoint,
    expectedStatusCode:  tc.expectedStatusCode,
    expectedBehavior:    tc.expectedBehavior,
    sentBody:            tc.request?.request_body ?? null,
    actualResponse:      tc.actualResponse,
  })),
  null, 2
)}`;

    const verdicts = [];
    for (let bi = 0; bi < batches.length; bi++) {
      const batch  = batches[bi];
      if (batches.length > 1) emitLog(`  Analysis batch ${bi + 1}/${batches.length}…`);
      const prompt = step5PromptFor(batch);

      let batchText;
      try {
        const s5r = await callLLM(JSON_SYSTEM_PROMPT, prompt, {}, false, 4096);
        batchText = s5r.text; trackTokens(s5r, "step5");
      } catch (llmErr) {
        if (llmErr.code === "NETWORK_ERROR") {
          logger.warn(`[${runId}] Step 5 batch ${bi + 1} timed out, retrying…`);
          emitLog(`  Step 5 batch ${bi + 1} timed out — retrying…`);
          try {
            const s5r2 = await callLLM(JSON_SYSTEM_PROMPT, prompt, {}, false, 4096);
            batchText = s5r2.text; trackTokens(s5r2, "step5");
          } catch (retryErr) {
            throw new Error(`Step 5 batch ${bi + 1} failed after retry: ${retryErr.message}`);
          }
        } else {
          throw new Error(`Step 5 batch ${bi + 1} failed: ${llmErr.message}`);
        }
      }

      let batchVerdicts;
      try {
        batchVerdicts = parseJSON(batchText);
      } catch {
        logger.warn(`[${runId}] Step 5 batch ${bi + 1} parse failed, retrying`);
        const s5retry = await callLLM(JSON_SYSTEM_PROMPT, prompt, {}, true, 4096);
        trackTokens(s5retry, "step5"); batchVerdicts = parseJSON(s5retry.text);
      }
      verdicts.push(...batchVerdicts);
    }

    run.testCases = run.testCases.map((tc) => {
      const v = verdicts.find((x) => x.id === tc.id);
      return {
        ...tc,
        verdict: v?.verdict || {
          result:      "fail",
          analysis:    "Analysis unavailable",
          issues:      [],
          suggestions: [],
        },
      };
    });

    run.stepDurations.step5 = Date.now() - step5Start;
    storage.saveRun(runId, run);
    emitLog(`Analysis complete. · ${(run.tokensByStep.step5||0).toLocaleString()} tokens`);

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 6 — Compile Report
    // ══════════════════════════════════════════════════════════════════════════
    emitStep(6);
    emitLog("Compiling report…");
    const step6Start = Date.now();

    let passed = 0, failed = 0, warnings = 0, skipped = 0;
    for (const tc of run.testCases) {
      const r = tc.verdict?.result;
      if      (r === "pass")    passed++;
      else if (r === "fail")    failed++;
      else if (r === "warning") warnings++;
      else if (r === "skipped") skipped++;
      else                      failed++;
    }

    run.passed    = passed;
    run.failed    = failed;
    run.warnings  = warnings;
    run.skipped   = skipped;
    run.totalTests = run.testCases.length;
    const countable = run.totalTests - skipped;
    run.passRate = countable > 0 ? Math.round((passed / countable) * 100) : 0;

    const summaryPrompt =
      `Write a concise 2-paragraph executive summary for this API test run.\n` +
      `Paragraph 1: Overall health — what passed, what failed, notable patterns.\n` +
      `Paragraph 2: Top recommendations for the development team.\n` +
      `Write in professional, direct language. No bullet points.\n\n` +
      `Stats: ${passed} passed, ${failed} failed, ${warnings} warnings out of ${countable} tests.\n` +
      `Pass rate: ${run.passRate}%.\n` +
      `Provider: ${run.llmProvider.displayName} (${run.llmProvider.model}).\n` +
      `API tested: ${resolvedBaseUrl || "unknown"}\n\n` +
      `Failed tests:\n` +
      (run.testCases
        .filter((tc) => tc.verdict?.result === "fail")
        .slice(0, 8)
        .map((tc) => `- ${tc.name}: ${tc.verdict?.analysis}`)
        .join("\n") || "None");

    try {
      const s6r = await callLLM(
        "You are an expert API testing consultant. Write clear, actionable summaries.",
        summaryPrompt,
        {},
        false,
        800  // summary needs ~500-800 tokens; no need for the full 4096
      );
      run.summary = s6r.text;
      trackTokens(s6r, "step6");
    } catch (sumErr) {
      logger.warn(`[${runId}] Summary generation failed`, { err: sumErr.message });
      run.summary = "Summary generation failed. See test results above for details.";
      run.errors.push({ step: 6, error: sumErr.message });
    }

    run.duration          = Date.now() - pipelineStart;
    run.stepDurations.step6 = Date.now() - step6Start;
    run.status            = "complete";

    storage.saveRun(runId, run);
    emitLog(`Run complete. ${passed}/${countable} tests passed (${run.passRate}%). Total tokens used: ${run.totalTokensUsed.toLocaleString()}.`);
    emit(runId, "complete", { runId });

  } catch (err) {
    logger.error(`[${runId}] Pipeline failed`, { err: err.message, stack: err.stack });
    run.status = "failed";
    run.errors.push({ error: err.message, fatal: true });
    run.duration = Date.now() - pipelineStart;
    storage.saveRun(runId, run);
    emit(runId, "error", { message: err.message });
  }
}

// ─── HTTP execution ───────────────────────────────────────────────────────────

/**
 * Execute a single HTTP request. Test-case headers override global headers.
 */
async function executeRequest(tc, baseUrl, globalHeaders = {}) {
  const req        = tc.request || {};
  const pathParams = req.pathParams || {};

  // Substitute path parameters: /users/{id} → /users/123
  let endpoint = tc.endpoint;
  for (const [key, val] of Object.entries(pathParams)) {
    endpoint = endpoint
      .replace(`{${key}}`, encodeURIComponent(String(val)))
      .replace(`:${key}`,  encodeURIComponent(String(val)));
  }

  const url   = `${baseUrl.replace(/\/$/, "")}${endpoint}`;
  const start = Date.now();

  // Merge: global headers first, then test-specific headers override
  const headers     = { ...globalHeaders, ...req.headers };
  const requestBody = req.request_body ?? null;
  const queryParams = req.query_params  ?? null;

  const axiosOpts = {
    method:         tc.method.toLowerCase(),
    url,
    headers,
    params:         queryParams || undefined,
    data:           requestBody || undefined,
    timeout:        15000,
    validateStatus: () => true, // capture all HTTP status codes, never throw
  };

  // If ALLOW_INSECURE_TLS=true, skip straight to the insecure agent
  if (forceTlsOff) {
    axiosOpts.httpsAgent = insecureAgent;
  }

  let response;
  try {
    response = await axios(axiosOpts);
  } catch (err) {
    // Auto-fallback: if it's a certificate error and we haven't already bypassed TLS,
    // retry with the insecure agent — exactly as Postman does by default.
    if (isTlsError(err) && !forceTlsOff) {
      logger.warn(
        `TLS cert error for ${url} — retrying without certificate verification. ` +
        `Set ALLOW_INSECURE_TLS=true in .env to skip this first attempt.`
      );
      try {
        response = await axios({ ...axiosOpts, httpsAgent: insecureAgent });
      } catch (retryErr) {
        throw new Error(
          retryErr.code === "ECONNABORTED"
            ? `Request timed out after 15s: ${tc.method} ${url}`
            : `Network error: ${retryErr.message}`
        );
      }
    } else {
      throw new Error(
        err.code === "ECONNABORTED"
          ? `Request timed out after 15s: ${tc.method} ${url}`
          : `Network error: ${err.message}`
      );
    }
  }

  // Omit responseHeaders — they add noise and waste tokens when sent to Step 5.
  return {
    actualStatusCode: response.status,
    actualUrl:        url,
    responseBody:     response.data,
    durationMs:       Date.now() - start,
  };
}

// ─── Re-run Pipeline (Steps 4–6 only) ────────────────────────────────────────

/**
 * Re-executes Steps 4 (Execute), 5 (Analyse), and 6 (Report) against an
 * existing run's already-generated test cases and payloads. The requirements
 * and test case generation steps are skipped entirely.
 *
 * @param {object} config
 * @param {string} config.runId        - New run ID for the re-run
 * @param {object} config.sourceRun    - The original run object (with testCases + request payloads)
 * @param {boolean} [config.dryRun]    - Skip actual HTTP execution
 */
async function rerunPipeline({ runId, sourceRun, dryRun = false }) {
  const activeProvider = sessionConfig.provider || process.env.LLM_PROVIDER || "anthropic";
  const activeModel    = sessionConfig.model ||
    process.env[`${activeProvider.toUpperCase()}_MODEL`] || DEFAULT_MODELS[activeProvider];

  // Build a fresh run object seeded from the source run
  const run = {
    runId,
    createdAt:        new Date().toISOString(),
    sourceRunId:      sourceRun.runId,
    requirementsText: sourceRun.requirementsText || "",
    baseUrl:          sourceRun.baseUrl || "",
    dryRun,
    status:           "running",
    llmProvider: {
      key:         activeProvider,
      displayName: PROVIDER_DISPLAY_NAMES[activeProvider] || activeProvider,
      model:       activeModel,
    },
    stepDurations:   {},
    totalTokensUsed: 0,
    tokensByStep:    {},
    totalTests:      0,
    passed: 0, failed: 0, warnings: 0, skipped: 0, passRate: 0,
    requirements:    sourceRun.requirements || [],
    testCases:       sourceRun.testCases.map((tc) => ({
      ...tc,
      actualResponse: undefined,
      verdict:        undefined,
    })),
    summary: "",
    errors:  [],
  };

  function emitStep(step, extra = {}) {
    const label    = STEP_LABELS[step];
    const progress = Math.round(((step - 1) / 6) * 100);
    logger.info(`[${runId}] (Re-run) Step ${step}: ${label}`);
    emit(runId, "step", { step, label, progress, ...extra });
  }
  function emitLog(message) {
    emit(runId, "log", { message, timestamp: new Date().toISOString() });
  }
  function trackTokens(result, stepKey) {
    const t = result?.tokensUsed ?? 0;
    run.totalTokensUsed = (run.totalTokensUsed || 0) + t;
    run.tokensByStep[stepKey] = (run.tokensByStep[stepKey] || 0) + t;
  }

  const pipelineStart = Date.now();
  const resolvedBaseUrl = run.baseUrl;
  const knownErrorCodes = (run.requirements || []).flatMap((r) => r.knownErrorCodes || []);

  storage.saveRun(runId, run);
  emitLog(`Re-running Steps 4–6 on ${run.testCases.length} existing test case(s) from ${sourceRun.runId}…`);

  try {
    // ── Synthetic step markers so the UI progress bar works ──
    emitStep(1); emitLog("(skipped — using existing requirements)");
    emitStep(2); emitLog("(skipped — using existing test cases)");
    emitStep(3); emitLog("(skipped — using existing payloads)");

    // ── STEP 4 — Execute ──────────────────────────────────────────────────────
    emitStep(4);
    // Global headers were already merged into each tc.request.headers during the original run.
    // Use a minimal base here — test-case headers take priority in executeRequest.
    const globalHeaders = { "Content-Type": "application/json" };

    if (dryRun) {
      emitLog("Dry run — skipping API execution.");
      run.testCases = run.testCases.map((tc) => ({
        ...tc,
        actualResponse: {
          skipped:   true,
          durationMs: 0,
          actualUrl: resolvedBaseUrl
            ? `${resolvedBaseUrl.replace(/\/$/, "")}${tc.endpoint}`
            : tc.endpoint,
        },
      }));
    } else {
      if (!resolvedBaseUrl) {
        throw new Error("No base URL found in original run. Cannot re-execute requests.");
      }
      emitLog(`Executing ${run.testCases.length} request(s) against ${resolvedBaseUrl}…`);
      const step4Start = Date.now();

      for (let i = 0; i < run.testCases.length; i++) {
        const tc = run.testCases[i];
        emitLog(`  [${i + 1}/${run.testCases.length}] ${tc.method} ${tc.endpoint}`);
        let actualResponse;
        try {
          actualResponse = await executeRequest(tc, resolvedBaseUrl, globalHeaders);
        } catch (execErr) {
          logger.warn(`[${runId}] Request failed, retrying: ${tc.id}`, { err: execErr.message });
          await new Promise((r) => setTimeout(r, 2000));
          try {
            actualResponse = await executeRequest(tc, resolvedBaseUrl, globalHeaders);
          } catch (retryErr) {
            actualResponse = {
              error: retryErr.message, actualStatusCode: null,
              actualUrl: `${resolvedBaseUrl}${tc.endpoint}`, responseBody: null, durationMs: 0,
            };
            run.errors.push({ testCaseId: tc.id, step: 4, error: retryErr.message });
          }
        }
        run.testCases[i] = { ...tc, actualResponse };
      }
      run.stepDurations.step4 = Date.now() - step4Start;
      storage.saveRun(runId, run);
      emitLog("API execution complete.");
    }

    // ── STEP 5 — Analyse ─────────────────────────────────────────────────────
    emitStep(5);
    emitLog("Analysing responses…");
    const step5Start = Date.now();
    const BATCH_SIZE = 10;
    const batches    = [];
    for (let i = 0; i < run.testCases.length; i += BATCH_SIZE) {
      batches.push(run.testCases.slice(i, i + BATCH_SIZE));
    }

    const step5PromptFor = (batch) => `You are a Senior API Quality Engineer performing FLEXIBLE SEMANTIC VALIDATION.

APPROACH — INTENT-BASED OR LOGIC:
- LENIENT: if ANY part of the response signals correct handling → "pass".
- Only "fail" if response completely contradicts expected behaviour.

KNOWN ERROR CODES:
${JSON.stringify(knownErrorCodes, null, 2)}

RULES:
1. Status matches expectedStatusCode → strong pass.
2. happy_path: "error":false OR CUSTOMER_ID OR success field → pass. "Not a Winner" (1020) is valid.
3. negative: matching error_code/error_type/keyword → pass.
4. auth: error_code 1004 → pass.
5. skipped → "skipped". network error → "fail".

Return JSON array:
{"id":"...","verdict":{"result":"pass|fail|warning|skipped","analysis":"...","issues":[],"suggestions":[]}}

Test cases:
${JSON.stringify(batch.map((tc) => ({
  id: tc.id, name: tc.name, category: tc.category,
  method: tc.method, endpoint: tc.endpoint,
  expectedStatusCode: tc.expectedStatusCode,
  expectedBehavior:   tc.expectedBehavior,
  sentBody:           tc.request?.request_body ?? null,
  actualResponse:     tc.actualResponse,
})), null, 2)}`;

    const verdicts = [];
    for (let bi = 0; bi < batches.length; bi++) {
      const prompt = step5PromptFor(batches[bi]);
      let batchText;
      try {
        const s5r = await callLLM(JSON_SYSTEM_PROMPT, prompt, {}, false, 4096);
        batchText = s5r.text; trackTokens(s5r, "step5");
      } catch (llmErr) {
        if (llmErr.code === "NETWORK_ERROR") {
          emitLog(`  Step 5 batch ${bi + 1} timed out — retrying…`);
          const s5r2 = await callLLM(JSON_SYSTEM_PROMPT, prompt, {}, false, 4096);
          batchText = s5r2.text; trackTokens(s5r2, "step5");
        } else throw new Error(`Step 5 batch ${bi + 1} failed: ${llmErr.message}`);
      }
      let batchVerdicts;
      try { batchVerdicts = parseJSON(batchText); }
      catch {
        const s5retry = await callLLM(JSON_SYSTEM_PROMPT, prompt, {}, true, 4096);
        trackTokens(s5retry, "step5"); batchVerdicts = parseJSON(s5retry.text);
      }
      verdicts.push(...batchVerdicts);
    }

    run.testCases = run.testCases.map((tc) => ({
      ...tc,
      verdict: verdicts.find((v) => v.id === tc.id)?.verdict || {
        result: "fail", analysis: "Analysis unavailable", issues: [], suggestions: [],
      },
    }));
    run.stepDurations.step5 = Date.now() - step5Start;
    storage.saveRun(runId, run);
    emitLog(`Analysis complete. · ${(run.tokensByStep.step5||0).toLocaleString()} tokens`);

    // ── STEP 6 — Report ──────────────────────────────────────────────────────
    emitStep(6);
    const step6Start = Date.now();
    let passed = 0, failed = 0, warnings = 0, skipped = 0;
    for (const tc of run.testCases) {
      const r = tc.verdict?.result;
      if      (r === "pass")    passed++;
      else if (r === "fail")    failed++;
      else if (r === "warning") warnings++;
      else if (r === "skipped") skipped++;
      else                      failed++;
    }
    run.passed = passed; run.failed = failed; run.warnings = warnings; run.skipped = skipped;
    run.totalTests = run.testCases.length;
    const countable = run.totalTests - skipped;
    run.passRate = countable > 0 ? Math.round((passed / countable) * 100) : 0;

    const summaryPrompt =
      `Write a concise 2-paragraph executive summary.\n` +
      `Stats: ${passed} passed, ${failed} failed, ${warnings} warnings, ${countable} total.\n` +
      `Pass rate: ${run.passRate}%. API: ${resolvedBaseUrl}.\n` +
      `This is a re-run of ${sourceRun.runId}.\n` +
      `Failed: ${run.testCases.filter(tc => tc.verdict?.result === "fail").slice(0, 5).map(tc => tc.name).join(", ") || "None"}`;

    try {
      const s6r = await callLLM(
        "You are an expert API testing consultant. Write clear, actionable summaries.",
        summaryPrompt, {}, false, 800
      );
      run.summary = s6r.text; trackTokens(s6r, "step6");
    } catch { run.summary = "Summary unavailable."; }

    run.duration = Date.now() - pipelineStart;
    run.stepDurations.step6 = Date.now() - step6Start;
    run.status   = "complete";
    storage.saveRun(runId, run);
    emitLog(`Re-run complete. ${passed}/${countable} tests passed (${run.passRate}%).`);
    emit(runId, "complete", { runId });

  } catch (err) {
    logger.error(`[${runId}] Re-run failed`, { err: err.message });
    run.status = "failed";
    run.errors.push({ error: err.message, fatal: true });
    run.duration = Date.now() - pipelineStart;
    storage.saveRun(runId, run);
    emit(runId, "error", { message: err.message });
  }
}

module.exports = { runPipeline, rerunPipeline, sseClients };

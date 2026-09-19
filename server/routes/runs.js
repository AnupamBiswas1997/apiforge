/**
 * server/routes/runs.js — Run management API endpoints
 *
 * Responsible for:
 *   - POST /api/runs/start — validate + kick off pipeline
 *   - GET  /api/runs/:runId/stream — SSE progress stream
 *   - GET  /api/runs/:runId — fetch a single run report
 *   - GET  /api/runs — list all past runs
 *   - DELETE /api/runs/:runId — delete a run
 *
 * NOT responsible for: Pipeline logic (pipeline.js), storage I/O (storage.js)
 *
 * Side effects: Registers SSE clients in pipeline.sseClients map.
 */

"use strict";

const express   = require("express");
const rateLimit = require("express-rate-limit");
const { v4: uuidv4 } = require("uuid");
const { runPipeline, rerunPipeline, sseClients } = require("../pipeline");
const storage   = require("../storage");
const logger    = require("../logger");

const router = express.Router();

// Rate limiter: max 5 run starts per minute per IP
// Prevents abuse of the LLM pipeline (which costs API credits)
const startLimiter = rateLimit({
  windowMs: 60 * 1000, // 1-minute window
  max:      5,
  message:  { error: { code: "RATE_LIMITED", message: "Too many runs started. Please wait 1 minute." } },
  standardHeaders: true,
  legacyHeaders:   false,
});

/**
 * POST /api/runs/start
 * Body: { requirementsText, baseUrl, authToken?, dryRun? }
 * Validates input, creates a runId, starts the pipeline asynchronously.
 */
router.post("/start", startLimiter, (req, res) => {
  const { requirementsText, baseUrl, authToken, dryRun } = req.body || {};

  // ── Validation ──
  const errors = [];
  if (!requirementsText || typeof requirementsText !== "string" || requirementsText.trim().length < 20) {
    errors.push("requirementsText must be at least 20 characters");
  }
  // baseUrl is now optional — the pipeline extracts it from the requirements document.
  // If explicitly provided it will be used as an override; otherwise Step 1 extracts it.
  if (baseUrl) {
    try {
      const parsed = new URL(baseUrl);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        errors.push("baseUrl must use http or https protocol");
      }
    } catch {
      errors.push("baseUrl must be a valid URL (e.g. https://api.example.com)");
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: errors.join("; "), details: errors },
    });
  }

  // Generate a short human-readable runId for logs and UI
  const runId = "run-" + uuidv4().replace(/-/g, "").slice(0, 8);

  logger.info(`Starting pipeline: runId=${runId} baseUrl=${baseUrl} dryRun=${!!dryRun}`);

  // Start pipeline asynchronously — respond immediately with runId
  // The frontend will connect to /stream to track progress
  runPipeline({ runId, requirementsText: requirementsText.trim(), baseUrl, authToken, dryRun: !!dryRun })
    .catch((err) => {
      // Unhandled pipeline errors are caught here as a last resort
      // (pipeline.js should handle its own errors, but this is belt-and-suspenders)
      logger.error(`[${runId}] Unhandled pipeline error`, { err: err.message });
    });

  res.json({ runId });
});

/**
 * GET /api/runs/:runId/stream
 * SSE endpoint — streams progress events from the pipeline to the frontend.
 * Sends heartbeat comments every 5 seconds to keep the connection alive.
 */
router.get("/:runId/stream", (req, res) => {
  const { runId } = req.params;

  // ── SSE headers ──
  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection",    "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // Disable Nginx buffering if present
  res.flushHeaders();

  // Register this response object in the global SSE client map
  if (!sseClients.has(runId)) {
    sseClients.set(runId, new Set());
  }
  sseClients.get(runId).add(res);
  logger.debug(`SSE client connected: runId=${runId}`);

  // Send heartbeat every 5 seconds to keep the connection alive through proxies
  // The ": heartbeat" format is an SSE comment — ignored by EventSource but
  // prevents connection timeout on many proxy/load-balancer configurations.
  const heartbeat = setInterval(() => {
    try {
      res.write(": heartbeat\n\n");
    } catch {
      clearInterval(heartbeat);
    }
  }, 5000);

  // ── Cleanup on disconnect ──
  req.on("close", () => {
    clearInterval(heartbeat);
    const clients = sseClients.get(runId);
    if (clients) {
      clients.delete(res);
      if (clients.size === 0) {
        sseClients.delete(runId);
      }
    }
    logger.debug(`SSE client disconnected: runId=${runId}`);
  });

  // If the run is already complete (client reconnecting), send complete event immediately
  const existingRun = storage.loadRun(runId);
  if (existingRun && (existingRun.status === "complete" || existingRun.status === "failed")) {
    const event = existingRun.status === "complete" ? "complete" : "error";
    const data  = existingRun.status === "complete"
      ? { runId }
      : { message: existingRun.errors?.[0]?.error || "Run failed" };
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
});

/**
 * GET /api/runs/:runId
 * Returns the full run report JSON.
 */
router.get("/:runId", (req, res) => {
  const { runId } = req.params;
  const run = storage.loadRun(runId);

  if (!run) {
    return res.status(404).json({
      error: { code: "RUN_NOT_FOUND", message: `Run "${runId}" not found` },
    });
  }

  res.json(run);
});

/**
 * GET /api/runs
 * Returns a summary list of all past runs, most recent first.
 */
router.get("/", (req, res) => {
  const runs = storage.listRuns();
  res.json(runs);
});

/**
 * DELETE /api/runs/:runId
 * Deletes a run from disk.
 */
router.delete("/:runId", (req, res) => {
  const { runId } = req.params;
  const deleted = storage.deleteRun(runId);

  if (!deleted) {
    return res.status(404).json({
      error: { code: "RUN_NOT_FOUND", message: `Run "${runId}" not found` },
    });
  }

  res.json({ success: true, runId });
});

/**
 * POST /api/runs/:runId/rerun
 * Re-executes Steps 4–6 only (Execute → Analyze → Report) on an existing run's
 * already-generated test cases and payloads, without re-reading requirements or
 * re-generating test cases. Useful for retrying failed API calls or re-scoring
 * after fixing a bug in the target API.
 *
 * The new results are saved as a fresh run (new runId) so the original is preserved.
 */
router.post("/:runId/rerun", startLimiter, (req, res) => {
  const { runId }    = req.params;
  const { dryRun }   = req.body || {};
  const existingRun  = storage.loadRun(runId);

  if (!existingRun) {
    return res.status(404).json({
      error: { code: "RUN_NOT_FOUND", message: `Run "${runId}" not found` },
    });
  }

  if (!existingRun.testCases?.length) {
    return res.status(400).json({
      error: {
        code:    "NO_TEST_CASES",
        message: "This run has no test cases to re-execute. Run a full pipeline first.",
      },
    });
  }

  // Verify test cases have request payloads
  // Check that at least one test case has a non-null request body
  const hasPayloads = existingRun.testCases.some((tc) => tc.request != null);
  if (!hasPayloads) {
    return res.status(400).json({
      error: {
        code:    "NO_PAYLOADS",
        message: "This run's test cases have no payloads. Run a full pipeline first.",
      },
    });
  }

  const newRunId = "run-" + uuidv4().replace(/-/g, "").slice(0, 8);
  logger.info(`Re-run: newRunId=${newRunId} sourceRunId=${runId}`);

  rerunPipeline({
    runId:      newRunId,
    sourceRun:  existingRun,
    dryRun:     !!dryRun,
  }).catch((err) => {
    logger.error(`[${newRunId}] Unhandled re-run error`, { err: err.message });
  });

  res.json({ runId: newRunId, sourceRunId: runId });
});

module.exports = router;

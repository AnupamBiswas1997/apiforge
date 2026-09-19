/**
 * server/index.js — Express application entry point
 *
 * Responsible for:
 *   - Creating and configuring the Express app
 *   - Mounting all route modules
 *   - Global error handler
 *   - Environment validation on startup
 *   - Starting the HTTP server
 *
 * NOT responsible for: Pipeline logic, LLM calls, file storage — those are
 * handled by their respective modules.
 *
 * Side effects:
 *   - Reads .env via dotenv
 *   - Logs startup warnings if LLM_PROVIDER is set but key is missing
 *   - Binds to PORT (default 3001)
 */

"use strict";

require("dotenv").config();

const express    = require("express");
const cors       = require("cors");
const path       = require("path");
const logger     = require("./logger");

const runsRouter     = require("./routes/runs");
const llmRouter      = require("./routes/llm-config");
const parseRouter    = require("./routes/parse");

const app  = express();
const PORT = process.env.PORT || 3001;

// ─── Startup environment validation ──────────────────────────────────────────
// Warn if LLM_PROVIDER is set to a provider that requires a key but has none.
// We do NOT exit — the user can still connect via the frontend.
(function validateEnv() {
  // Warn if TLS verification is disabled
  if (process.env.ALLOW_INSECURE_TLS === "true") {
    logger.warn(
      "⚠ ALLOW_INSECURE_TLS=true — Certificate verification is DISABLED for API test requests. " +
      "Use only for internal/UAT environments with self-signed certificates."
    );
  }

  const provider = process.env.LLM_PROVIDER;
  const KEYED_PROVIDERS = ["anthropic", "openai", "gemini", "mistral", "marsmax", "openrouter"];

  if (provider && KEYED_PROVIDERS.includes(provider)) {
    const key = process.env[`${provider.toUpperCase()}_API_KEY`];
    if (!key) {
      logger.warn(
        `⚠ LLM_PROVIDER=${provider} but ${provider.toUpperCase()}_API_KEY is not set in .env. ` +
        `The app will start, but you must connect via the /connect page before running tests.`
      );
    } else {
      logger.info(`✓ LLM provider configured: ${provider}`);
    }
  } else if (!provider) {
    logger.warn(
      "⚠ LLM_PROVIDER is not set in .env. Defaulting to 'anthropic'. " +
      "Use the /connect page to configure a provider."
    );
  }
})();

// ─── Middleware ───────────────────────────────────────────────────────────────

// CORS — origins are configurable via CORS_ORIGINS env var for production
const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map((o) => o.trim())
  : ["http://localhost:3000", "http://localhost:5173"]; // Vite dev server

app.use(cors({
  origin: corsOrigins,
  credentials: true,
}));

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

// Development request logging — only when NODE_ENV=development
if (process.env.NODE_ENV === "development") {
  app.use((req, _res, next) => {
    logger.debug(`${req.method} ${req.path}`, {
      body:    req.body && Object.keys(req.body).length > 0 ? "[body present]" : undefined,
      query:   Object.keys(req.query).length > 0 ? req.query : undefined,
    });
    next();
  });
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use("/api/runs",  runsRouter);
app.use("/api/llm",   llmRouter);
app.use("/api",       parseRouter);

// Health check — useful for Docker and monitoring
app.get("/api/health", (_req, res) => {
  res.json({
    status:           "ok",
    timestamp:        new Date().toISOString(),
    version:          process.env.npm_package_version || "1.0.0",
    allowInsecureTls: process.env.ALLOW_INSECURE_TLS === "true",
  });
});

// ─── Static files (production build) ─────────────────────────────────────────
// In production, serve the React build from client/dist
// In development, the Vite dev server handles this
if (process.env.NODE_ENV === "production") {
  const distPath = path.join(__dirname, "..", "client", "dist");
  app.use(express.static(distPath));
  // SPA fallback — send index.html for all non-API routes
  app.get("*", (req, res) => {
    if (!req.path.startsWith("/api")) {
      res.sendFile(path.join(distPath, "index.html"));
    }
  });
}

// ─── Global error handler ─────────────────────────────────────────────────────
// This is the last-resort error handler for any unhandled Express errors.
// It should never receive LLM or pipeline errors (those are handled upstream).
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const requestId = `req-${Date.now()}`;
  logger.error(`[${requestId}] Unhandled error in ${req.method} ${req.path}`, {
    err:   err.message,
    stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });

  // Multer / file parse errors
  if (err.code === "INVALID_FILE_TYPE" || err.code === "LIMIT_FILE_SIZE" ||
      (err.message && (err.message.includes("Only PDF") || err.message.includes("file type")))) {
    return res.status(400).json({
      error: { code: "INVALID_FILE_TYPE", message: err.message },
    });
  }

  res.status(err.status || 500).json({
    error: {
      code:      err.code || "INTERNAL_ERROR",
      message:   process.env.NODE_ENV === "development" ? err.message : "An internal error occurred",
      requestId, // Include requestId for correlating with server logs
    },
  });
});

// ─── Start server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`🚀 APIForge server running on http://localhost:${PORT}`);
  logger.info(`   NODE_ENV=${process.env.NODE_ENV || "development"}`);
  logger.info(`   DATA_DIR=${process.env.DATA_DIR || path.join(__dirname, "..", "data")}`);
});

module.exports = app; // Export for testing

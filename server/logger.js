/**
 * logger.js — Structured logging utility for APIForge backend
 *
 * Responsible for: Providing a consistent, grep-friendly logging interface
 * with level prefixes, timestamps, and optional context objects.
 *
 * NOT responsible for: Log rotation, external log aggregation, or
 * anything beyond stdout/stderr output.
 *
 * Side effects: Writes to process.stdout (info/debug) and process.stderr (warn/error).
 */

"use strict";

/**
 * @description Formats a Date object as an ISO timestamp string (UTC).
 * @param {Date} date - The date to format
 * @returns {string} ISO 8601 timestamp string
 */
function timestamp(date = new Date()) {
  return date.toISOString();
}

/**
 * @description Serialises an optional context object for appending to log lines.
 * Arrays and objects are JSON-stringified; primitives are coerced to string.
 * @param {*} ctx - Any value to serialise. Undefined → empty string.
 * @returns {string} Formatted context string or empty string
 */
function formatContext(ctx) {
  if (ctx === undefined || ctx === null) return "";
  if (typeof ctx === "object") {
    try {
      return " " + JSON.stringify(ctx);
    } catch {
      return " [unserializable context]";
    }
  }
  return " " + String(ctx);
}

/**
 * @description Core log writer. Writes a structured log line to stdout or stderr.
 * Format: [LEVEL] [TIMESTAMP] [CONTEXT?] message
 * @param {"INFO"|"WARN"|"ERROR"|"DEBUG"} level - Log severity level
 * @param {string} message - Human-readable log message
 * @param {*} [context] - Optional structured context (object, string, etc.)
 */
function write(level, message, context) {
  const line = `[${level.padEnd(5)}] [${timestamp()}]${formatContext(context)} ${message}`;
  if (level === "ERROR" || level === "WARN") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}

const logger = {
  /**
   * @description Log an informational message.
   * @param {string} message - Log message
   * @param {*} [context] - Optional context
   */
  info: (message, context) => write("INFO", message, context),

  /**
   * @description Log a warning. Does not indicate a failure, but something unexpected.
   * @param {string} message - Log message
   * @param {*} [context] - Optional context
   */
  warn: (message, context) => write("WARN", message, context),

  /**
   * @description Log an error. Should accompany a thrown error or a failure state.
   * @param {string} message - Log message
   * @param {*} [context] - Optional context (often an Error object or { err, ...extra })
   */
  error: (message, context) => write("ERROR", message, context),

  /**
   * @description Log a debug message. Only printed when NODE_ENV=development
   * or PIPELINE_DEBUG=true.
   * @param {string} message - Log message
   * @param {*} [context] - Optional context
   */
  debug: (message, context) => {
    // Only emit debug lines in development or when PIPELINE_DEBUG is set
    if (process.env.NODE_ENV === "development" || process.env.PIPELINE_DEBUG === "true") {
      write("DEBUG", message, context);
    }
  },
};

module.exports = logger;

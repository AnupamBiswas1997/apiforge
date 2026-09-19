/**
 * server/storage.js — Run persistence layer
 *
 * Responsible for: Reading and writing run JSON files to /data/runs/.
 * Uses simple JSON file storage — one file per run, named {runId}.json.
 *
 * NOT responsible for: In-memory caching, indexing, or search.
 * All reads go directly to disk; no caching is performed here.
 *
 * Side effects: Creates DATA_DIR and DATA_DIR/runs/ if they do not exist.
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const logger = require("./logger");

// DATA_DIR is configurable via env, defaults to /data relative to project root
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "..", "data");

const RUNS_DIR = path.join(DATA_DIR, "runs");

// Ensure the runs directory exists on module load
(function ensureRunsDir() {
  try {
    fs.mkdirSync(RUNS_DIR, { recursive: true });
    logger.info(`Storage: runs directory ready at ${RUNS_DIR}`);
  } catch (err) {
    logger.error("Storage: failed to create runs directory", { err: err.message });
  }
})();

/**
 * @description Save a run object to disk as {runId}.json.
 * Overwrites any existing file with the same runId.
 * @param {string} runId - The unique run identifier
 * @param {object} runData - The full run object to persist
 * @returns {void}
 * @throws {Error} If the file cannot be written (permissions, disk full, etc.)
 */
function saveRun(runId, runData) {
  const filePath = path.join(RUNS_DIR, `${runId}.json`);
  try {
    fs.writeFileSync(filePath, JSON.stringify(runData, null, 2), "utf8");
    logger.debug(`Storage: saved run ${runId}`);
  } catch (err) {
    logger.error(`Storage: failed to save run ${runId}`, { err: err.message, filePath });
    throw err;
  }
}

/**
 * @description Load a single run from disk by runId.
 * @param {string} runId - The run identifier to load
 * @returns {object|null} Parsed run object, or null if not found
 */
function loadRun(runId) {
  const filePath = path.join(RUNS_DIR, `${runId}.json`);
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return null; // File not found — not an error
    logger.error(`Storage: failed to load run ${runId}`, { err: err.message });
    return null;
  }
}

/**
 * @description List all saved runs, returning summary metadata for each.
 * Reads every .json file in RUNS_DIR and extracts key fields.
 * Invalid/corrupted files are skipped with a warning.
 * @returns {Array<{runId, createdAt, passRate, totalTests, baseUrl, llmProvider}>}
 *   Sorted by createdAt descending (most recent first).
 */
function listRuns() {
  let files;
  try {
    files = fs.readdirSync(RUNS_DIR).filter((f) => f.endsWith(".json"));
  } catch (err) {
    logger.error("Storage: failed to list runs directory", { err: err.message });
    return [];
  }

  const summaries = [];
  for (const file of files) {
    const filePath = path.join(RUNS_DIR, file);
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const run = JSON.parse(raw);
      summaries.push({
        id:          run.runId,   // alias for frontend compatibility
        runId:       run.runId,
        createdAt:   run.createdAt,
        passRate:    run.passRate,
        totalTests:  run.totalTests,
        passed:      run.passed,
        failed:      run.failed,
        warnings:    run.warnings,
        baseUrl:     run.baseUrl,
        status:      run.status,
        llmProvider: run.llmProvider || null,
      });
    } catch (err) {
      // Skip corrupted files — log and move on
      logger.warn(`Storage: skipping corrupted run file ${file}`, { err: err.message });
    }
  }

  // Sort most recent first
  summaries.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return summaries;
}

/**
 * @description Delete a run file from disk.
 * @param {string} runId - The run to delete
 * @returns {boolean} True if deleted, false if not found
 */
function deleteRun(runId) {
  const filePath = path.join(RUNS_DIR, `${runId}.json`);
  try {
    fs.unlinkSync(filePath);
    logger.info(`Storage: deleted run ${runId}`);
    return true;
  } catch (err) {
    if (err.code === "ENOENT") return false;
    logger.error(`Storage: failed to delete run ${runId}`, { err: err.message });
    throw err;
  }
}

module.exports = { saveRun, loadRun, listRuns, deleteRun, RUNS_DIR };

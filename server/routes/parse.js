/**
 * server/routes/parse.js — Unified file extraction endpoint
 *
 * Supports:
 *   - PDF (.pdf)           → pdf-parse text extraction
 *   - Word (.docx)         → mammoth paragraph extraction
 *   - Word (.doc)          → mammoth raw extraction (best-effort)
 *   - Excel (.xlsx/.xls)   → xlsx sheet-to-text conversion
 *   - Postman Collection   → parsed into APIForge requirement format
 *   - Plain text / JSON    → returned as-is
 *
 * All file types flow into the same downstream pipeline via the
 * extracted text (or pre-structured JSON for Postman collections).
 */

"use strict";

const express  = require("express");
const multer   = require("multer");
const pdfParse = require("pdf-parse");
const mammoth  = require("mammoth");
const XLSX     = require("xlsx");
const logger   = require("../logger");

const router = express.Router();

// Memory storage — extract and discard, never write to disk
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 20 * 1024 * 1024 }, // 20MB
});

// ─── Postman collection detection ────────────────────────────────────────────

function isPostmanCollection(obj) {
  return (
    obj &&
    typeof obj === "object" &&
    obj.info &&
    (obj.info.schema?.includes("collection") || obj.info._postman_id) &&
    Array.isArray(obj.item)
  );
}

/**
 * Recursively flatten Postman items (folders & requests) into a flat
 * request list.
 */
function flattenPostmanItems(items, result = []) {
  for (const item of items) {
    if (Array.isArray(item.item)) {
      // Folder — recurse
      flattenPostmanItems(item.item, result);
    } else if (item.request) {
      result.push(item);
    }
  }
  return result;
}

/**
 * Convert a Postman collection to a plain-text requirements description
 * that the pipeline's Step 1 prompt can parse naturally.
 */
function postmanToText(collection) {
  const name   = collection.info?.name || "API Collection";
  const items  = flattenPostmanItems(collection.item || []);
  const lines  = [`# ${name}`, ""];

  for (const item of items) {
    const req    = item.request;
    const method = (typeof req.method === "string" ? req.method : "GET").toUpperCase();
    const url    = typeof req.url === "string"
      ? req.url
      : req.url?.raw
        || (req.url?.host?.length
            ? req.url.host.filter(Boolean).join(".") +
              (req.url.port ? `:${req.url.port}` : "") +
              "/" + (req.url.path || []).filter(Boolean).join("/")
            : null)
        || "(unknown url)";

    lines.push(`## ${item.name || "Request"}`);
    lines.push(`Method: ${method}`);
    lines.push(`URL: ${url}`);

    // Headers
    const headers = req.header || [];
    if (headers.length > 0) {
      lines.push("Headers:");
      for (const h of headers) {
        if (!h.disabled) lines.push(`  ${h.key}: ${h.value}`);
      }
    }

    // Body
    const body = req.body;
    if (body?.mode === "raw" && body.raw) {
      lines.push("Request Body:");
      lines.push(body.raw.trim());
    } else if (body?.mode === "urlencoded" && body.urlencoded) {
      lines.push("Form Fields:");
      for (const f of body.urlencoded) {
        if (!f.disabled) lines.push(`  ${f.key}: ${f.value}`);
      }
    }

    // Description
    const desc = typeof req.description === "string"
      ? req.description
      : req.description?.content;
    if (desc) lines.push(`Description: ${desc}`);

    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Convert an XLSX workbook to human-readable text.
 * Each sheet becomes a section; rows become tab-separated lines.
 */
function xlsxToText(buffer) {
  const wb    = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const parts = [];
  for (const sheetName of wb.SheetNames) {
    const ws   = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    parts.push(`## Sheet: ${sheetName}`);
    for (const row of rows) {
      const line = row.map((cell) => {
        if (cell instanceof Date) {
          // Format date as ISO string (YYYY-MM-DD) for readability
          return cell.toISOString().slice(0, 10);
        }
        return String(cell ?? "");
      }).join("\t");
      if (line.trim()) parts.push(line);
    }
    parts.push("");
  }
  return parts.join("\n");
}

// ─── Main parse endpoint ──────────────────────────────────────────────────────

/**
 * POST /api/parse-file
 * Accepts any supported file type and returns:
 *   { text: string, pages?: number, fileType: string, filename: string }
 */
router.post("/parse-file", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      error: { code: "NO_FILE", message: "No file uploaded. Use field name 'file'." },
    });
  }

  const { originalname, mimetype, buffer } = req.file;
  const ext = originalname.split(".").pop().toLowerCase();

  logger.info(`File upload: ${originalname} (${mimetype}, ${buffer.length} bytes)`);

  try {
    // ── PDF ──────────────────────────────────────────────────────────────────
    if (mimetype === "application/pdf" || ext === "pdf") {
      const data = await pdfParse(buffer);
      logger.info(`PDF parsed: ${originalname}, ${data.numpages} pages`);
      return res.json({
        text:     data.text,
        pages:    data.numpages,
        fileType: "pdf",
        filename: originalname,
      });
    }

    // ── Word (.docx / .doc) ──────────────────────────────────────────────────
    if (
      ext === "docx" ||
      mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      const result = await mammoth.extractRawText({ buffer });
      logger.info(`DOCX parsed: ${originalname}, ${result.value.length} chars`);
      return res.json({
        text:     result.value,
        fileType: "docx",
        filename: originalname,
      });
    }

    if (ext === "doc" || mimetype === "application/msword") {
      // .doc is legacy binary format — mammoth has partial support
      try {
        const result = await mammoth.extractRawText({ buffer });
        return res.json({
          text:     result.value,
          fileType: "doc",
          filename: originalname,
        });
      } catch {
        return res.status(400).json({
          error: {
            code: "PARSE_FAILED",
            message: "Legacy .doc format could not be parsed. Please save as .docx and retry.",
          },
        });
      }
    }

    // ── Excel (.xlsx / .xls) ─────────────────────────────────────────────────
    if (
      ext === "xlsx" ||
      ext === "xls" ||
      mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      mimetype === "application/vnd.ms-excel"
    ) {
      const text = xlsxToText(buffer);
      logger.info(`Excel parsed: ${originalname}, ${text.length} chars`);
      return res.json({
        text,
        fileType: "xlsx",
        filename: originalname,
      });
    }

    // ── JSON / Postman Collection ─────────────────────────────────────────────
    if (ext === "json" || mimetype === "application/json") {
      let obj;
      try { obj = JSON.parse(buffer.toString("utf8")); }
      catch {
        return res.status(400).json({
          error: { code: "PARSE_FAILED", message: "File is not valid JSON." },
        });
      }

      if (isPostmanCollection(obj)) {
        const text = postmanToText(obj);
        logger.info(`Postman collection parsed: ${originalname}`);
        return res.json({
          text,
          fileType: "postman",
          filename: originalname,
        });
      }

      // Plain JSON — return stringified
      return res.json({
        text:     JSON.stringify(obj, null, 2),
        fileType: "json",
        filename: originalname,
      });
    }

    // ── Plain text / Markdown ─────────────────────────────────────────────────
    if (
      ext === "txt" || ext === "md" ||
      mimetype?.startsWith("text/")
    ) {
      return res.json({
        text:     buffer.toString("utf8"),
        fileType: "text",
        filename: originalname,
      });
    }

    // ── Unsupported ────────────────────────────────────────────────────────────
    return res.status(400).json({
      error: {
        code:    "UNSUPPORTED_FILE_TYPE",
        message: `File type .${ext} is not supported. Supported: .pdf, .docx, .doc, .xlsx, .xls, .json, .txt, .md`,
      },
    });

  } catch (err) {
    logger.error(`File parse failed: ${originalname}`, { err: err.message });
    res.status(400).json({
      error: { code: "PARSE_FAILED", message: `Failed to parse ${originalname}: ${err.message}` },
    });
  }
});

// ── Keep backward-compatible alias ───────────────────────────────────────────
router.post("/parse-pdf", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: { code: "NO_FILE", message: "No PDF file uploaded." } });
  }
  try {
    const data = await pdfParse(req.file.buffer);
    res.json({ text: data.text, pages: data.numpages });
  } catch (err) {
    res.status(400).json({ error: { code: "PARSE_FAILED", message: err.message } });
  }
});

module.exports = router;

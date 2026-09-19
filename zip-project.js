#!/usr/bin/env node
/**
 * zip-project.js
 *
 * What this file does:
 *   Creates apiforge.zip containing the entire project, excluding:
 *   - node_modules/ directories (user runs npm install)
 *   - .env (contains secrets — user must configure their own)
 *   - data/runs/*.json EXCEPT data/runs/demo.json (the seed file)
 *   - .git/ directory
 *   - The zip file itself (avoid self-inclusion)
 *
 * Responsible for:
 *   - Recursively collecting files
 *   - Writing a zip archive using the built-in Node.js zlib + fs streams
 *
 * NOT responsible for:
 *   - Building the project
 *   - Running tests
 *
 * Usage: node zip-project.js
 * Output: apiforge.zip in the project root
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const OUT_ZIP = path.join(ROOT, 'apiforge.zip');

// ── Patterns to exclude (relative paths from root) ───────────────────────────
const EXCLUDE_DIRS = new Set(['node_modules', '.git', 'dist', 'build']);

const EXCLUDE_FILES = new Set([
  '.env',          // secrets — never zip
  'apiforge.zip',   // avoid self-inclusion
]);

/**
 * @description Checks whether a given path should be excluded from the zip.
 * @param {string} relPath - Path relative to project root
 * @param {boolean} isDir - Whether the path is a directory
 * @returns {boolean} true if the path should be excluded
 */
function shouldExclude(relPath, isDir) {
  const parts = relPath.split(path.sep);

  // Exclude any directory named in EXCLUDE_DIRS (at any depth)
  if (isDir && EXCLUDE_DIRS.has(parts[parts.length - 1])) return true;

  // Exclude if any ancestor directory is in EXCLUDE_DIRS
  if (parts.some((p) => EXCLUDE_DIRS.has(p))) return true;

  const basename = path.basename(relPath);

  // Exclude specific files
  if (EXCLUDE_FILES.has(basename)) return true;

  // Exclude data/runs/*.json EXCEPT demo.json
  if (
    relPath.startsWith(path.join('data', 'runs')) &&
    relPath.endsWith('.json') &&
    basename !== 'demo.json'
  ) {
    return true;
  }

  return false;
}

/**
 * @description Recursively collects all files that should be included in the zip.
 * @param {string} dir - Absolute directory path to scan
 * @param {string} base - Absolute root path (for computing relative paths)
 * @returns {string[]} Array of absolute file paths
 */
function collectFiles(dir, base) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    const absPath = path.join(dir, entry.name);
    const relPath = path.relative(base, absPath);

    if (entry.isDirectory()) {
      if (shouldExclude(relPath, true)) continue;
      results.push(...collectFiles(absPath, base));
    } else if (entry.isFile()) {
      if (shouldExclude(relPath, false)) continue;
      results.push(absPath);
    }
  }

  return results;
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('\n📦 Building apiforge.zip...\n');

// Check if 'zip' command is available (Unix/macOS/Linux)
let useNativeZip = false;
try {
  execSync('which zip', { stdio: 'ignore' });
  useNativeZip = true;
} catch {
  // zip not available — fall back to manual archive
}

const files = collectFiles(ROOT, ROOT);
console.log(`  Found ${files.length} files to include\n`);

if (useNativeZip) {
  // ── Use native zip command (fast, reliable) ─────────────────────────────

  // Build the exclusion arguments for the zip command
  const excludeArgs = [
    '--exclude=*/node_modules/*',
    '--exclude=*/.git/*',
    '--exclude=*/.env',
    '--exclude=*/apiforge.zip',
    '--exclude=*/dist/*',
    '--exclude=*/build/*',
    // Exclude run data except demo
    '--exclude=*/data/runs/*.json',
  ].join(' ');

  // We include demo.json explicitly after, since the exclude above would catch it
  const cmd = `cd "${ROOT}" && zip -r "${OUT_ZIP}" . ${excludeArgs}`;

  try {
    execSync(cmd, { stdio: 'pipe' });

    // Add demo.json back explicitly
    const demoPath = path.join('data', 'runs', 'demo.json');
    if (fs.existsSync(path.join(ROOT, demoPath))) {
      execSync(`cd "${ROOT}" && zip "${OUT_ZIP}" "${demoPath}"`, { stdio: 'pipe' });
    }
  } catch (err) {
    console.error('zip command failed:', err.message);
    process.exit(1);
  }
} else {
  // ── Manual zip creation using archiver-like byte writing ────────────────
  // Since we can't install packages here, use a simple tar.gz fallback

  const outTar = path.join(ROOT, 'apiforge.tar.gz');
  const fileList = files.map((f) => `"${path.relative(ROOT, f)}"`).join(' ');

  try {
    execSync(
      `cd "${ROOT}" && tar -czf "${outTar}" ${fileList}`,
      { stdio: 'pipe', maxBuffer: 50 * 1024 * 1024 }
    );
    console.log('  Note: zip not found — created apiforge.tar.gz instead\n');
    const stat = fs.statSync(outTar);
    const kb = Math.round(stat.size / 1024);
    console.log(`✅ Created apiforge.tar.gz (${kb} KB)\n`);
    return;
  } catch (err) {
    console.error('Archive creation failed:', err.message);
    process.exit(1);
  }
}

// ── Report ────────────────────────────────────────────────────────────────────

if (fs.existsSync(OUT_ZIP)) {
  const stat = fs.statSync(OUT_ZIP);
  const kb = Math.round(stat.size / 1024);
  const mb = (stat.size / (1024 * 1024)).toFixed(2);
  console.log(`✅  apiforge.zip created successfully`);
  console.log(`    Size: ${kb} KB (${mb} MB)`);
  console.log(`    Path: ${OUT_ZIP}`);
  console.log(`\n    Files included: ${files.length}`);
  console.log('    node_modules, .env, and run data excluded.\n');
} else {
  console.error('❌  apiforge.zip was not created. Check errors above.');
  process.exit(1);
}

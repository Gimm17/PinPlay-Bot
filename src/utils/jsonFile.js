/**
 * jsonFile.js - Atomic JSON file read/write helpers
 *
 * Provides two functions used across AI persistence modules:
 *
 *   atomicWriteJsonSync(filePath, data)
 *     Writes data as JSON to a temp file, then renames atomically.
 *     Prevents partial writes if the process is killed mid-write
 *     (e.g., crash, kill -9, power loss). The rename is atomic on
 *     POSIX and Windows NTFS.
 *
 *   readJsonSafeSync(filePath, fallback = {})
 *     Reads + parses JSON, returns fallback on any error
 *     (missing file, parse error, etc.). Never throws.
 *
 * Used by:
 *   - src/utils/aiSettings.js
 *   - src/utils/aiMemory.js
 *   - src/utils/aiLimits.js
 *   - src/utils/aiTokenUsage.js
 */

const fs = require("fs");
const path = require("path");

/**
 * Atomically write JSON to a file using temp + rename.
 *
 * Steps:
 *   1. Serialize data to pretty JSON.
 *   2. Write to <filePath>.tmp (overwrites if exists).
 *   3. Rename tmp -> filePath (atomic on same filesystem).
 *
 * On any error during step 2-3, the .tmp file is cleaned up.
 * Callers should wrap in try/catch if they need to handle failures.
 */
function atomicWriteJsonSync(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmp = `${filePath}.tmp`;
  let ok = false;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tmp, filePath);
    ok = true;
  } finally {
    if (!ok && fs.existsSync(tmp)) {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* ignore cleanup errors */
      }
    }
  }
}

/**
 * Safely read a JSON file. Returns parsed object or fallback on any failure.
 * Never throws. Does NOT return a deep copy — caller should clone if mutating.
 */
function readJsonSafeSync(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf-8");
    if (!raw || !raw.trim()) return fallback;
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

module.exports = {
  atomicWriteJsonSync,
  readJsonSafeSync,
};

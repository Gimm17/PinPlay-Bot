const fs = require("fs");
const path = require("path");
const { atomicWriteJsonSync } = require("./jsonFile");

const dataDir = path.join(process.cwd(), "data");
const settingsFile = path.join(dataDir, "guildSettings.json");

// In-memory cache to prevent race conditions from concurrent file reads/writes.
// All reads/writes go through this cache; file is only read on cold start.
let _cache = null;
let _writeTimer = null;
const WRITE_DEBOUNCE_MS = 500;

function ensure() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(settingsFile))
    fs.writeFileSync(settingsFile, "{}", "utf-8");
}

/**
 * Load settings from disk into cache (cold start only).
 */
function _loadCache() {
  if (_cache !== null) return;
  ensure();
  const raw = fs.readFileSync(settingsFile, "utf-8");
  try {
    _cache = JSON.parse(raw);
  } catch (e) {
    // NOTE: this is still fail-OPEN, not fail-closed — resetting to {} means every
    // guild falls back to controlMode "all". That is a deliberate, pre-existing
    // tradeoff we are NOT changing here (locking everyone out on a parse error is
    // worse for a music bot than defaulting open). The only change is that it is
    // no longer silent: previously a wiped file left zero trace in the logs.
    // Follow-up: restore from the last-good backup instead of resetting.
    console.error(
      "[ERROR] guildSettings.json is corrupt — resetting to empty. Access control reverts to default (controlMode: \"all\"). Cause:",
      e?.message || e
    );
    _cache = {};
  }
}

/**
 * Schedule a debounced write to disk.
 * Multiple rapid changes are coalesced into a single write.
 */
function _scheduleSave() {
  if (_writeTimer) clearTimeout(_writeTimer);
  _writeTimer = setTimeout(() => {
    _writeTimer = null;
    try {
      // atomicWriteJsonSync does temp-file + rename (and mkdir), so a crash
      // mid-write can never truncate the live file the way writeFileSync did.
      atomicWriteJsonSync(settingsFile, _cache);
    } catch (e) {
      console.error("[WARN ] Failed to persist guildSettings:", e?.message || e);
    }
  }, WRITE_DEBOUNCE_MS);
}

/**
 * Flush any pending debounced write immediately and synchronously.
 * MUST be called from SIGINT/SIGTERM handlers — otherwise a change made
 * inside the 500ms debounce window (e.g. `.access mode restricted`) is lost
 * on Ctrl-C, silently reverting access control.
 */
function flushNow() {
  if (_writeTimer) {
    clearTimeout(_writeTimer);
    _writeTimer = null;
  }
  if (_cache === null) return;
  try {
    atomicWriteJsonSync(settingsFile, _cache);
  } catch (e) {
    console.error("[WARN ] Failed to flush guildSettings:", e?.message || e);
  }
}

function readAll() {
  _loadCache();
  return _cache;
}

function getGuildSettings(guildId) {
  _loadCache();
  return (
    _cache[guildId] || {
      // Music behavior
      stay247: false,
      voiceChannelId: null,
      textChannelId: null,
      djRoleId: null,
      volume: null,

      // Access control
      controlMode: "all", // "all" | "restricted"
      allowedUserIds: [], // tambahan user yang boleh kontrol
      allowedRoleIds: [], // tambahan role yang boleh kontrol

      // Panel (interface)
      panelChannelId: null,
      panelMessageId: null,

      // Optional: batasi command hanya di satu channel (request channel)
      requestChannelId: null,

      // Autoplay
      autoplayOn: false,
    }
  );
}

function setGuildSettings(guildId, patch) {
  _loadCache();
  const current = _cache[guildId] || {};
  _cache[guildId] = { ...current, ...patch };
  _scheduleSave();
  return _cache[guildId];
}

module.exports = { getGuildSettings, setGuildSettings, readAll, flushNow };

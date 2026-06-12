const fs = require("fs");
const path = require("path");

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
  } catch {
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
      ensure();
      fs.writeFileSync(settingsFile, JSON.stringify(_cache, null, 2), "utf-8");
    } catch (e) {
      console.error("[WARN ] Failed to persist guildSettings:", e?.message || e);
    }
  }, WRITE_DEBOUNCE_MS);
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

module.exports = { getGuildSettings, setGuildSettings, readAll };

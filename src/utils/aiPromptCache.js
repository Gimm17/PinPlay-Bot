/**
 * aiPromptCache.js - Per-user LRU prompt cache for stateless AI commands
 *
 * Used by /roast (and future stateless queries) to skip repeat calls.
 * NOT used by /chat (context-dependent) or /aiplaylist (output is list of tracks).
 *
 * LRU per user: max 50 entries, 1-hour TTL.
 * Key: hash(prompt + personality + small context signature)
 *
 * API:
 *   get(userId, key) -> cached string | null
 *   set(userId, key, response) -> void
 *   clear(userId?) -> void (omit userId for full wipe)
 *   size(userId) -> number
 *   stats() -> { totalEntries, totalUsers }
 */

const crypto = require("crypto");

const MAX_ENTRIES_PER_USER = 50;
const TTL_MS = 60 * 60 * 1000; // 1 hour

// userId -> Map<cacheKey, { response, timestamp }>
const _cache = new Map();

// GC timer
const _gcInterval = setInterval(() => {
  const now = Date.now();
  for (const [uid, entries] of _cache) {
    for (const [k, v] of entries) {
      if (now - v.timestamp >= TTL_MS) entries.delete(k);
    }
    if (entries.size === 0) _cache.delete(uid);
  }
}, 5 * 60 * 1000);
_gcInterval.unref();

function _hashKey(prompt, personality, contextSig = "") {
  const raw = `${personality || ""}::${contextSig}::${prompt || ""}`;
  return crypto.createHash("sha1").update(raw).digest("hex").slice(0, 16);
}

function get(userId, key) {
  if (!userId) return null;
  const entries = _cache.get(userId);
  if (!entries) return null;
  const entry = entries.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp >= TTL_MS) {
    entries.delete(key);
    if (entries.size === 0) _cache.delete(userId);
    return null;
  }
  return entry.response;
}

function set(userId, key, response) {
  if (!userId || !key || typeof response !== "string") return;
  let entries = _cache.get(userId);
  if (!entries) {
    entries = new Map();
    _cache.set(userId, entries);
  }
  // LRU: delete oldest if at cap
  if (entries.size >= MAX_ENTRIES_PER_USER) {
    const firstKey = entries.keys().next().value;
    if (firstKey !== undefined) entries.delete(firstKey);
  }
  entries.set(key, { response, timestamp: Date.now() });
}

function clear(userId) {
  if (userId) {
    _cache.delete(userId);
  } else {
    _cache.clear();
  }
}

function size(userId) {
  if (!userId) return 0;
  return _cache.get(userId)?.size || 0;
}

function stats() {
  let totalEntries = 0;
  for (const entries of _cache.values()) totalEntries += entries.size;
  return {
    totalUsers: _cache.size,
    totalEntries,
    maxPerUser: MAX_ENTRIES_PER_USER,
    ttlMs: TTL_MS,
  };
}

module.exports = {
  get,
  set,
  clear,
  size,
  stats,
  _hashKey,
  MAX_ENTRIES_PER_USER,
  TTL_MS,
};

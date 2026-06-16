/**
 * aiLimits.js - Per-user hourly rate limiter for AI features (Phase B upgrade)
 *
 * Sliding 1-hour window per userId. Shared across /chat, /aiplaylist, /roast.
 * Owner (config.discord.ownerId) bypasses the limit.
 *
 * Phase B upgrade:
 *   - Per-user override limit via userLimits map (takes precedence)
 *   - Per-user additive bonus via userBonuses map (can be negative)
 *   - Effective limit = userLimits[id] || (base + userBonuses[id])
 *   - resetForUser(id) and resetAll() for owner manual reset
 *
 * API:
 *   checkAndIncrement(userId) -> { allowed, remaining, resetAt, reason?, limit }
 *   peek(userId)             -> { count, limit, resetAt, effectiveLimit }
 *   resetForUser(userId)     -> void
 *   resetAll()               -> void
 *   getEffectiveLimit(userId) -> number
 *   listLimitOverrides()     -> [{ userId, limit, bonus, effective }]
 */

const path = require("path");
const { config } = require("../config");
const { getAISettings } = require("./aiSettings");
const { atomicWriteJsonSync, readJsonSafeSync } = require("./jsonFile");

// userId -> { count, windowStart }
const _windows = new Map();
let _writeTimer = null;
const WRITE_DEBOUNCE_MS = 500;

const dataDir = path.join(process.cwd(), "data");
const file = path.join(dataDir, "aiLimits.json");

const WINDOW_MS = 60 * 60 * 1000; // 1 hour

function _loadWindows() {
  if (_writeTimer !== null) return; // already loaded (writeTimer null = fresh module, but we use a flag)
  // Use _windows.size as the "loaded" indicator — it's set on load
  // Better: explicit flag
}

let _loaded = false;
function _ensureLoaded() {
  if (_loaded) return;
  _loaded = true;
  const parsed = readJsonSafeSync(file, { windows: {} });
  const windows = parsed.windows || {};
  const now = Date.now();
  for (const [userId, w] of Object.entries(windows)) {
    if (!w || typeof w.count !== "number" || typeof w.windowStart !== "number") continue;
    // Skip expired windows on load — fresh start
    if (now - w.windowStart >= WINDOW_MS) continue;
    _windows.set(userId, { count: w.count, windowStart: w.windowStart });
  }
}

function _scheduleWindowsSave() {
  if (_writeTimer) clearTimeout(_writeTimer);
  _writeTimer = setTimeout(() => {
    _writeTimer = null;
    try {
      const out = { windows: {} };
      for (const [userId, w] of _windows) {
        out.windows[userId] = { count: w.count, windowStart: w.windowStart };
      }
      atomicWriteJsonSync(file, out);
    } catch (e) {
      console.error("[WARN] Failed to persist aiLimits:", e?.message || e);
    }
  }, WRITE_DEBOUNCE_MS);
}

function _getBaseLimit() {
  const s = getAISettings();
  const n = Number(s?.userHourlyLimit);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

function getEffectiveLimit(userId) {
  const s = getAISettings();
  if (!userId) return _getBaseLimit();
  if (config.discord.ownerId && userId === config.discord.ownerId) return Infinity;
  if (s.userLimits && s.userLimits[userId]) {
    const v = Number(s.userLimits[userId]);
    if (Number.isFinite(v) && v >= 1) return Math.floor(v);
  }
  const bonus = s.userBonuses && s.userBonuses[userId] ? Number(s.userBonuses[userId]) : 0;
  return Math.max(1, _getBaseLimit() + (Number.isFinite(bonus) ? Math.floor(bonus) : 0));
}

/**
 * Atomically check and increment the counter for a user.
 * Returns { allowed, remaining, resetAt, reason?, limit }.
 *
 * - If the user is the owner: always allowed, remaining = Infinity.
 * - If within current window and count < effective limit: allowed, incremented.
 * - If within current window and count >= effective limit: NOT allowed.
 * - If no current window or window expired: starts a new one (count = 1).
 */
function checkAndIncrement(userId) {
  _ensureLoaded();
  if (!userId) {
    return { allowed: false, remaining: 0, resetAt: null, reason: "no-user", limit: 0 };
  }

  // Owner bypass
  if (config.discord.ownerId && userId === config.discord.ownerId) {
    return {
      allowed: true,
      remaining: Infinity,
      resetAt: null,
      reason: "owner-bypass",
      limit: Infinity,
    };
  }

  const limit = getEffectiveLimit(userId);
  const now = Date.now();
  let w = _windows.get(userId);

  // No window yet, or window has expired -> start a new one
  if (!w || now - w.windowStart >= WINDOW_MS) {
    w = { count: 1, windowStart: now };
    _windows.set(userId, w);
    _scheduleWindowsSave();
    return {
      allowed: true,
      remaining: limit - 1,
      resetAt: now + WINDOW_MS,
      limit,
    };
  }

  // Existing window, check limit
  if (w.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: w.windowStart + WINDOW_MS,
      reason: "limit-exceeded",
      limit,
    };
  }

  w.count += 1;
  _scheduleWindowsSave();
  return {
    allowed: true,
    remaining: limit - w.count,
    resetAt: w.windowStart + WINDOW_MS,
    limit,
  };
}

/** Get current state without mutating. */
function peek(userId) {
  _ensureLoaded();
  const effectiveLimit = getEffectiveLimit(userId);
  if (!userId) return { count: 0, limit: effectiveLimit, resetAt: null, effectiveLimit };
  if (config.discord.ownerId && userId === config.discord.ownerId) {
    return { count: 0, limit: Infinity, resetAt: null, effectiveLimit: Infinity };
  }
  const w = _windows.get(userId);
  if (!w) return { count: 0, limit: effectiveLimit, resetAt: null, effectiveLimit };
  const now = Date.now();
  if (now - w.windowStart >= WINDOW_MS) {
    return { count: 0, limit: effectiveLimit, resetAt: null, effectiveLimit };
  }
  return {
    count: w.count,
    limit: effectiveLimit,
    resetAt: w.windowStart + WINDOW_MS,
    effectiveLimit,
  };
}

/** Reset limit counter for a specific user (owner only). */
function resetForUser(userId) {
  _ensureLoaded();
  if (!userId) return false;
  const had = _windows.has(userId);
  _windows.delete(userId);
  if (had) _scheduleWindowsSave();
  return had;
}

/** Reset all limit counters (owner only). Returns number of users cleared. */
function resetAll() {
  _ensureLoaded();
  const count = _windows.size;
  _windows.clear();
  if (count > 0) _scheduleWindowsSave();
  return count;
}

/** List all users with current override (limit/bonus), for /ai-set view */
function listLimitOverrides() {
  const s = getAISettings();
  const out = new Set([
    ...Object.keys(s.userLimits || {}),
    ...Object.keys(s.userBonuses || {}),
  ]);
  return Array.from(out).map((userId) => ({
    userId,
    limit: s.userLimits?.[userId] ?? null,
    bonus: s.userBonuses?.[userId] ?? 0,
    effective: getEffectiveLimit(userId),
  }));
}

/**
 * List all users currently in an active window (Phase D).
 * Returns array of { userId, count, limit, resetAt, minutesLeft, status }
 * Status: "ok" | "near-limit" | "limit-exceeded"
 *
 * Owner is excluded (they have no window).
 */
function listAllLimits() {
  _ensureLoaded();
  const now = Date.now();
  const out = [];
  for (const [userId, w] of _windows) {
    if (now - w.windowStart >= WINDOW_MS) {
      // Expired — clean up and skip
      _windows.delete(userId);
      continue;
    }
    const limit = getEffectiveLimit(userId);
    const resetAt = w.windowStart + WINDOW_MS;
    const minutesLeft = Math.max(0, Math.ceil((resetAt - now) / 60000));
    const ratio = w.count / limit;
    let status = "ok";
    if (w.count >= limit) status = "limit-exceeded";
    else if (ratio >= 0.8) status = "near-limit";
    out.push({
      userId,
      count: w.count,
      limit,
      resetAt,
      minutesLeft,
      status,
    });
  }
  // Sort: exceeded > near-limit > ok; within group, highest count first
  const order = { "limit-exceeded": 0, "near-limit": 1, ok: 2 };
  out.sort((a, b) => {
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    return b.count - a.count;
  });
  return out;
}

/**
 * Get limit status summary for a single user (Phase D).
 * Returns { count, limit, remaining, resetAt, minutesLeft, percent, isOwner, effectiveLimit, status }
 */
function getUserLimitStatus(userId) {
  _ensureLoaded();
  const isOwner = config.discord.ownerId && userId === config.discord.ownerId;
  if (isOwner) {
    return {
      count: 0,
      limit: Infinity,
      remaining: Infinity,
      resetAt: null,
      minutesLeft: null,
      percent: 0,
      isOwner: true,
      effectiveLimit: Infinity,
      status: "bypass",
    };
  }
  const effectiveLimit = getEffectiveLimit(userId);
  const w = _windows.get(userId);
  if (!w) {
    return {
      count: 0,
      limit: effectiveLimit,
      remaining: effectiveLimit,
      resetAt: null,
      minutesLeft: null,
      percent: 0,
      isOwner: false,
      effectiveLimit,
      status: "ok",
    };
  }
  const now = Date.now();
  if (now - w.windowStart >= WINDOW_MS) {
    // Expired
    _windows.delete(userId);
    return {
      count: 0,
      limit: effectiveLimit,
      remaining: effectiveLimit,
      resetAt: null,
      minutesLeft: null,
      percent: 0,
      isOwner: false,
      effectiveLimit,
      status: "ok",
    };
  }
  const resetAt = w.windowStart + WINDOW_MS;
  const minutesLeft = Math.max(0, Math.ceil((resetAt - now) / 60000));
  const remaining = Math.max(0, effectiveLimit - w.count);
  const percent = Math.min(100, Math.round((w.count / effectiveLimit) * 100));
  let status = "ok";
  if (w.count >= effectiveLimit) status = "limit-exceeded";
  else if (percent >= 80) status = "near-limit";
  return {
    count: w.count,
    limit: effectiveLimit,
    remaining,
    resetAt,
    minutesLeft,
    percent,
    isOwner: false,
    effectiveLimit,
    status,
  };
}

// GC: clear entries whose window has expired
setInterval(() => {
  _ensureLoaded();
  const now = Date.now();
  let removed = 0;
  for (const [uid, w] of _windows) {
    if (now - w.windowStart >= WINDOW_MS) {
      _windows.delete(uid);
      removed++;
    }
  }
  if (removed > 0) _scheduleWindowsSave();
}, 5 * 60 * 1000).unref();

module.exports = {
  checkAndIncrement,
  peek,
  resetForUser,
  resetAll,
  getEffectiveLimit,
  listLimitOverrides,
  listAllLimits,
  getUserLimitStatus,
  WINDOW_MS,
};

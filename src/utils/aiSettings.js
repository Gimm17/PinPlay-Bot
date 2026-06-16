/**
 * aiSettings.js - Global AI settings persistence
 *
 * Stores a single global config object (not per-guild) in
 * data/aiSettings.json. In-memory cache + debounced writes.
 *
 * Schema:
 *   {
 *     provider: "nvidia" | "tokenrouter" | null,   // null = use config.ai.defaultProvider
 *     model:    string | null,                     // null = use provider's hardcoded default
 *     userHourlyLimit: number,                      // default 5
 *     whitelist: string[],                          // user IDs allowed to use /chat
 *
 *     // --- New fields (Phase A upgrade) ---
 *     userLimits: { [userId]: number },             // override limit per user (takes precedence)
 *     userBonuses: { [userId]: number },            // additive bonus/penalty (can be negative)
 *     globalNotes: string,                          // free-form notes about the server / vibe
 *     fallbackEnabled: boolean,                     // auto-fallback to other provider on 5xx (default true)
 *     memoryEnabled: boolean,                       // AI memory system on/off (default true)
 *     personality: string | null,                   // owner-only default forced personality
 *     costPerMillion: { [modelKey]: number },       // USD per 1M tokens, configurable pricing for token monitoring
 *   }
 *
 * Dipakai oleh:
 *   - src/utils/ai.js              (read provider/model)
 *   - src/utils/aiLimits.js        (read userHourlyLimit + userLimits + userBonuses)
 *   - src/utils/aiMemory.js        (read memoryEnabled)
 *   - src/utils/aiProviderFallback (read fallbackEnabled)
 *   - src/commands/chat.js         (read whitelist)
 *   - src/commands/ai-set.js       (CRUD)
 */

const fs = require("fs");
const path = require("path");
const { atomicWriteJsonSync, readJsonSafeSync } = require("./jsonFile");

const dataDir = path.join(process.cwd(), "data");
const file = path.join(dataDir, "aiSettings.json");

let _cache = null;
let _writeTimer = null;
const WRITE_DEBOUNCE_MS = 500;

const DEFAULTS = {
  provider: null,
  model: null,
  userHourlyLimit: 5,
  whitelist: [],
  // New
  userLimits: {},
  userBonuses: {},
  globalNotes: "",
  fallbackEnabled: true,
  memoryEnabled: true,
  personality: null,
  costPerMillion: {},
};

function ensure() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, "{}", "utf-8");
  }
}

function _loadCache() {
  if (_cache !== null) return;
  ensure();
  const parsed = readJsonSafeSync(file, {});
  _cache = { ...DEFAULTS, ...parsed };
  // Normalize whitelist to array
  if (!Array.isArray(_cache.whitelist)) {
    _cache.whitelist = [];
  }
  // Normalize userLimits / userBonuses to object
  if (typeof _cache.userLimits !== "object" || _cache.userLimits === null || Array.isArray(_cache.userLimits)) {
    _cache.userLimits = {};
  }
  if (typeof _cache.userBonuses !== "object" || _cache.userBonuses === null || Array.isArray(_cache.userBonuses)) {
    _cache.userBonuses = {};
  }
  if (typeof _cache.globalNotes !== "string") {
    _cache.globalNotes = "";
  }
  // Normalize costPerMillion to object
  if (typeof _cache.costPerMillion !== "object" || _cache.costPerMillion === null || Array.isArray(_cache.costPerMillion)) {
    _cache.costPerMillion = {};
  }
}

function _scheduleSave() {
  if (_writeTimer) clearTimeout(_writeTimer);
  _writeTimer = setTimeout(() => {
    _writeTimer = null;
    try {
      atomicWriteJsonSync(file, _cache);
    } catch (e) {
      console.error("[WARN] Failed to persist aiSettings:", e?.message || e);
    }
  }, WRITE_DEBOUNCE_MS);
}

function getAISettings() {
  _loadCache();
  return _cache;
}

function setAISettings(patch) {
  _loadCache();
  _cache = { ...DEFAULTS, ..._cache, ...patch };
  _scheduleSave();
  return _cache;
}

// === Mutating helpers ===

function setProvider(name) {
  if (name !== null && typeof name !== "string") {
    throw new Error("Provider name must be a string or null");
  }
  return setAISettings({ provider: name || null });
}

function setModel(name) {
  if (name !== null && typeof name !== "string") {
    throw new Error("Model name must be a string or null");
  }
  return setAISettings({ model: name && name.trim() ? name.trim() : null });
}

function setUserHourlyLimit(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || num < 1) {
    throw new Error("Limit must be a positive number");
  }
  return setAISettings({ userHourlyLimit: Math.max(1, Math.floor(num)) });
}

function addToWhitelist(userId) {
  if (!userId) return _cache;
  _loadCache();
  const list = Array.isArray(_cache.whitelist) ? _cache.whitelist : [];
  if (list.includes(userId)) return _cache;
  _cache = { ..._cache, whitelist: [...list, userId] };
  _scheduleSave();
  return _cache;
}

function removeFromWhitelist(userId) {
  if (!userId) return _cache;
  _loadCache();
  const list = Array.isArray(_cache.whitelist) ? _cache.whitelist : [];
  _cache = { ..._cache, whitelist: list.filter((id) => id !== userId) };
  _scheduleSave();
  return _cache;
}

// === New: per-user limits & bonuses ===

function setUserLimit(userId, value) {
  if (!userId) throw new Error("userId required");
  const num = Number(value);
  if (!Number.isFinite(num) || num < 1) {
    throw new Error("Limit must be a positive number");
  }
  _loadCache();
  _cache.userLimits[userId] = Math.max(1, Math.floor(num));
  _scheduleSave();
  return _cache;
}

function removeUserLimit(userId) {
  if (!userId) return _cache;
  _loadCache();
  if (_cache.userLimits[userId] !== undefined) {
    delete _cache.userLimits[userId];
    _scheduleSave();
  }
  return _cache;
}

function setUserBonus(userId, value) {
  if (!userId) throw new Error("userId required");
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error("Bonus must be a number");
  }
  _loadCache();
  _cache.userBonuses[userId] = Math.floor(num);
  _scheduleSave();
  return _cache;
}

function removeUserBonus(userId) {
  if (!userId) return _cache;
  _loadCache();
  if (_cache.userBonuses[userId] !== undefined) {
    delete _cache.userBonuses[userId];
    _scheduleSave();
  }
  return _cache;
}

function setGlobalNotes(notes) {
  _loadCache();
  _cache.globalNotes = typeof notes === "string" ? notes : "";
  _scheduleSave();
  return _cache;
}

function setFallbackEnabled(enabled) {
  _loadCache();
  _cache.fallbackEnabled = Boolean(enabled);
  _scheduleSave();
  return _cache;
}

function setMemoryEnabled(enabled) {
  _loadCache();
  _cache.memoryEnabled = Boolean(enabled);
  _scheduleSave();
  return _cache;
}

function setDefaultPersonality(name) {
  _loadCache();
  _cache.personality = name || null;
  _scheduleSave();
  return _cache;
}

// === Cost per million tokens (for token monitoring) ===

function getCostPerMillion(modelKey) {
  _loadCache();
  if (!modelKey) return 0;
  const v = Number(_cache.costPerMillion?.[modelKey]);
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

function setCostPerMillion(modelKey, value) {
  if (!modelKey) throw new Error("modelKey required");
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    throw new Error("Cost must be a non-negative number");
  }
  _loadCache();
  _cache.costPerMillion[modelKey] = num;
  _scheduleSave();
  return _cache;
}

function removeCostPerMillion(modelKey) {
  if (!modelKey) return _cache;
  _loadCache();
  if (_cache.costPerMillion[modelKey] !== undefined) {
    delete _cache.costPerMillion[modelKey];
    _scheduleSave();
  }
  return _cache;
}

function listCostPerMillion() {
  _loadCache();
  return { ..._cache.costPerMillion };
}

module.exports = {
  getAISettings,
  setAISettings,
  setProvider,
  setModel,
  setUserHourlyLimit,
  addToWhitelist,
  removeFromWhitelist,
  setUserLimit,
  removeUserLimit,
  setUserBonus,
  removeUserBonus,
  setGlobalNotes,
  setFallbackEnabled,
  setMemoryEnabled,
  setDefaultPersonality,
  getCostPerMillion,
  setCostPerMillion,
  removeCostPerMillion,
  listCostPerMillion,
  DEFAULTS,
};

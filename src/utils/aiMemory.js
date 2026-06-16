/**
 * aiMemory.js - Per-user AI memory + global notes persistence
 *
 * Stores structured memory in data/aiMemory.json with debounced writes.
 * AI uses this to "remember" users across sessions.
 *
 * Schema:
 *   {
 *     users: {
 *       [userId]: {
 *         nickname: string,
 *         favoriteGenre: string[],
 *         favoriteArtist: string[],
 *         currentMood: string,
 *         interests: string[],
 *         facts: string[],                // auto-extracted insights, max 100 (LRU)
 *         lastSeen: ISO string,
 *         lastUpdated: ISO string
 *       }
 *     },
 *     global: {
 *       serverVibe: string,
 *       commonGenres: string[],
 *       ownerNotes: string
 *     }
 *   }
 *
 * API:
 *   getUserMemory(userId)            -> profile object (with defaults)
 *   updateUserMemory(userId, patch)  -> merge + save
 *   addUserFact(userId, fact)        -> append to facts (LRU cap 100)
 *   setUserField(userId, key, value) -> set specific field
 *   removeUserField(userId, key)     -> remove specific field
 *   clearUserMemory(userId)          -> wipe user profile
 *   listUserMemories()               -> array of {userId, profile}
 *
 *   getGlobalMemory()                -> global object
 *   updateGlobalMemory(patch)        -> merge + save
 *   setGlobalNotes(notes)            -> shortcut for global.ownerNotes
 *   clearGlobalMemory()              -> wipe global
 *
 *   formatMemoryForPrompt(userId)    -> string untuk inject ke system prompt
 *   formatGlobalForPrompt()          -> string untuk inject ke system prompt
 *
 *   isMemoryEnabled()                -> reads aiSettings.memoryEnabled
 *   extractFactsFromMessage(userId, userText, assistantText) -> background AI call
 *
 * Dipakai oleh:
 *   - src/commands/chat.js     (read memory, format for prompt, auto-extract)
 *   - src/commands/roast.js    (read memory for context)
 *   - src/commands/ai-set.js   (CRUD via /ai-set memory ...)
 */

const fs = require("fs");
const path = require("path");
const { atomicWriteJsonSync, readJsonSafeSync } = require("./jsonFile");
const { getAISettings } = require("./aiSettings");
const { callAI, isAIAvailable } = require("./ai");
const { makeLogger } = require("./logger");
const { config } = require("../config");

const log = makeLogger(config.logLevel);

const dataDir = path.join(process.cwd(), "data");
const file = path.join(dataDir, "aiMemory.json");

let _cache = null;
let _writeTimer = null;
const WRITE_DEBOUNCE_MS = 500;

const MAX_FACTS_PER_USER = 100;
const MAX_INJECT_CHARS = 400;

const EMPTY_USER = {
  nickname: "",
  favoriteGenre: [],
  favoriteArtist: [],
  currentMood: "",
  interests: [],
  facts: [],
  lastSeen: null,
  lastUpdated: null,
};

const EMPTY_GLOBAL = {
  serverVibe: "",
  commonGenres: [],
  ownerNotes: "",
};

function ensure() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, "{}", "utf-8");
}

function _loadCache() {
  if (_cache !== null) return;
  ensure();
  const parsed = readJsonSafeSync(file, {});
  _cache = {
    users: typeof parsed.users === "object" && parsed.users ? parsed.users : {},
    global: { ...EMPTY_GLOBAL, ...(parsed.global || {}) },
  };
}

function _scheduleSave() {
  if (_writeTimer) clearTimeout(_writeTimer);
  _writeTimer = setTimeout(() => {
    _writeTimer = null;
    try {
      atomicWriteJsonSync(file, _cache);
    } catch (e) {
      console.error("[WARN] Failed to persist aiMemory:", e?.message || e);
    }
  }, WRITE_DEBOUNCE_MS);
}

// === User memory ===

function getUserMemory(userId) {
  _loadCache();
  if (!userId) return { ...EMPTY_USER };
  const u = _cache.users[userId];
  if (!u) return { ...EMPTY_USER };
  return { ...EMPTY_USER, ...u };
}

function updateUserMemory(userId, patch) {
  if (!userId) return getUserMemory(userId);
  _loadCache();
  const current = _cache.users[userId] || { ...EMPTY_USER };
  const merged = { ...current, ...patch };
  merged.lastUpdated = new Date().toISOString();
  _cache.users[userId] = merged;
  _scheduleSave();
  return merged;
}

function addUserFact(userId, fact) {
  if (!userId || !fact) return getUserMemory(userId);
  const f = String(fact).trim();
  if (!f) return getUserMemory(userId);
  _loadCache();
  const current = _cache.users[userId] || { ...EMPTY_USER };
  const facts = Array.isArray(current.facts) ? current.facts : [];
  // Avoid duplicate
  if (facts.includes(f)) {
    // Refresh lastUpdated
    current.lastUpdated = new Date().toISOString();
    _cache.users[userId] = current;
    _scheduleSave();
    return current;
  }
  facts.push(f);
  // LRU cap
  if (facts.length > MAX_FACTS_PER_USER) {
    facts.splice(0, facts.length - MAX_FACTS_PER_USER);
  }
  current.facts = facts;
  current.lastUpdated = new Date().toISOString();
  current.lastSeen = current.lastSeen || new Date().toISOString();
  _cache.users[userId] = current;
  _scheduleSave();
  return current;
}

function setUserField(userId, key, value) {
  if (!userId || !key) return getUserMemory(userId);
  const allowed = ["nickname", "currentMood", "favoriteGenre", "favoriteArtist", "interests"];
  if (!allowed.includes(key)) {
    throw new Error(`Field "${key}" gak bisa di-set langsung. Gunakan addUserFact untuk insight.`);
  }
  _loadCache();
  const current = _cache.users[userId] || { ...EMPTY_USER };
  if (Array.isArray(value)) {
    current[key] = value.map(String).map((s) => s.trim()).filter(Boolean);
  } else if (typeof value === "string") {
    current[key] = value.trim();
  } else {
    throw new Error(`Value untuk ${key} harus string atau array of strings`);
  }
  current.lastUpdated = new Date().toISOString();
  _cache.users[userId] = current;
  _scheduleSave();
  return current;
}

function removeUserField(userId, key) {
  if (!userId || !key) return getUserMemory(userId);
  const allowed = ["nickname", "currentMood", "favoriteGenre", "favoriteArtist", "interests", "facts"];
  if (!allowed.includes(key)) return getUserMemory(userId);
  _loadCache();
  const current = _cache.users[userId] || { ...EMPTY_USER };
  if (Array.isArray(current[key])) current[key] = [];
  else current[key] = "";
  current.lastUpdated = new Date().toISOString();
  _cache.users[userId] = current;
  _scheduleSave();
  return current;
}

function clearUserMemory(userId) {
  if (!userId) return;
  _loadCache();
  if (_cache.users[userId]) {
    delete _cache.users[userId];
    _scheduleSave();
  }
}

function touchUserSeen(userId) {
  if (!userId) return;
  _loadCache();
  const current = _cache.users[userId] || { ...EMPTY_USER };
  current.lastSeen = new Date().toISOString();
  current.lastUpdated = current.lastUpdated || current.lastSeen;
  _cache.users[userId] = current;
  _scheduleSave();
}

function listUserMemories() {
  _loadCache();
  return Object.entries(_cache.users).map(([userId, profile]) => ({ userId, profile }));
}

// === Global memory ===

function getGlobalMemory() {
  _loadCache();
  return { ...EMPTY_GLOBAL, ..._cache.global };
}

function updateGlobalMemory(patch) {
  _loadCache();
  _cache.global = { ...EMPTY_GLOBAL, ..._cache.global, ...patch };
  _scheduleSave();
  return _cache.global;
}

function setGlobalNotes(notes) {
  _loadCache();
  _cache.global.ownerNotes = String(notes || "").trim();
  _scheduleSave();
  return _cache.global;
}

function clearGlobalMemory() {
  _loadCache();
  _cache.global = { ...EMPTY_GLOBAL };
  _scheduleSave();
}

// === Format for prompt injection ===

function _truncate(s, n) {
  s = String(s || "").trim();
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function formatUserForPrompt(userId) {
  if (!isMemoryEnabled()) return "";
  const mem = getUserMemory(userId);
  const hasContent =
    mem.nickname ||
    mem.currentMood ||
    mem.favoriteGenre?.length ||
    mem.favoriteArtist?.length ||
    mem.interests?.length ||
    mem.facts?.length;
  if (!hasContent) return "";
  const lines = [];
  if (mem.nickname) lines.push(`- Panggil dia: ${mem.nickname}`);
  if (mem.currentMood) lines.push(`- Mood terakhir: ${mem.currentMood}`);
  if (mem.favoriteGenre?.length)
    lines.push(`- Genre favorit: ${mem.favoriteGenre.join(", ")}`);
  if (mem.favoriteArtist?.length)
    lines.push(`- Artis favorit: ${mem.favoriteArtist.join(", ")}`);
  if (mem.interests?.length)
    lines.push(`- Minat: ${mem.interests.join(", ")}`);
  if (mem.facts?.length) {
    // Take last 5 facts (most recent)
    const recent = mem.facts.slice(-5);
    lines.push(`- Fakta tentang dia: ${recent.join("; ")}`);
  }
  return _truncate(lines.join("\n"), MAX_INJECT_CHARS);
}

function formatGlobalForPrompt() {
  if (!isMemoryEnabled()) return "";
  const g = getGlobalMemory();
  const hasContent = g.serverVibe || g.commonGenres?.length || g.ownerNotes;
  if (!hasContent) return "";
  const lines = [];
  if (g.serverVibe) lines.push(`- Vibe server: ${g.serverVibe}`);
  if (g.commonGenres?.length) lines.push(`- Genre umum: ${g.commonGenres.join(", ")}`);
  if (g.ownerNotes) lines.push(`- Catatan owner: ${g.ownerNotes}`);
  return _truncate(lines.join("\n"), MAX_INJECT_CHARS);
}

function isMemoryEnabled() {
  const s = getAISettings();
  return s?.memoryEnabled !== false; // default true
}

// === Background: extract facts from conversation ===

const EXTRACT_PROMPT = `Lo analis yang extract insight dari chat user. Dari pesan user di bawah, output JSON array berisi fakta-fakta BARU yang worth disimpan (skip yang sudah umum kayak "suka musik").

CONTOH OUTPUT:
["nama asli dia Andi", "lagi belajar MLBB", "punya kucing namanya Mochi"]

ATURAN:
- Maks 3 fakta per pesan.
- Singkat, 2-8 kata per fakta.
- WAJIB Bahasa Indonesia.
- Kalau pesannya gak ada insight baru, output [].
- HANYA balas JSON array. Tidak ada teks lain.`;

async function extractFactsFromMessage(userId, userText, _assistantText) {
  if (!isMemoryEnabled() || !userId || !userText) return;
  if (!isAIAvailable()) return;
  try {
    const raw = await callAI({
      messages: [
        { role: "system", content: EXTRACT_PROMPT },
        { role: "user", content: `User: ${String(userText).slice(0, 400)}` },
      ],
      temperature: 0.3,
      maxTokens: 120,
      _source: "extractFacts",
    });
    // Parse JSON array (defensive)
    const match = raw.match(/\[[\s\S]*?\]/);
    if (!match) return;
    const arr = JSON.parse(match[0]);
    if (!Array.isArray(arr)) return;
    for (const fact of arr.slice(0, 3)) {
      if (typeof fact === "string" && fact.trim()) {
        addUserFact(userId, fact.trim());
      }
    }
  } catch (e) {
    log.debug("extractFactsFromMessage failed:", e?.message || e);
  }
}

module.exports = {
  // User
  getUserMemory,
  updateUserMemory,
  addUserFact,
  setUserField,
  removeUserField,
  clearUserMemory,
  touchUserSeen,
  listUserMemories,
  // Global
  getGlobalMemory,
  updateGlobalMemory,
  setGlobalNotes,
  clearGlobalMemory,
  // Format
  formatUserForPrompt,
  formatGlobalForPrompt,
  isMemoryEnabled,
  // Background
  extractFactsFromMessage,
  // Constants
  MAX_FACTS_PER_USER,
  MAX_INJECT_CHARS,
};

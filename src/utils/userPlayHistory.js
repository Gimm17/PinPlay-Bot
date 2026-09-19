/**
 * userPlayHistory.js - Per-user music profile data (top tracks / servers / friends).
 *
 * WHY THIS EXISTS: `commands/history.js` keeps the last 20 tracks per GUILD in
 * memory and drops them on restart — it answers "what played here", not "what
 * does this user listen to". A profile needs per-user aggregation that survives
 * a restart, so this module mirrors the storage pattern used by aiMemory.js and
 * storage.js: in-memory cache + debounced atomic write via jsonFile.js.
 *
 * Schema (data/userPlayHistory.json):
 *   {
 *     "users": {
 *       "<userId>": {
 *         "tracks": {
 *           "<trackKey>": { "count": 3, "title": "...", "author": "..." }
 *         },
 *         "guilds": { "<guildId>": <count> },
 *         "lastSeen": "ISO"
 *       }
 *     }
 *   }
 *
 * The track title/author live INSIDE the file on purpose. Keeping them only in
 * memory would mean every restart renders raw URIs in the profile, which is the
 * one thing this feature is supposed to avoid.
 *
 * Top friends are INFERRED, not recorded: the bot never listens to voice
 * channel membership over time, so there is no co-listening log to read. We
 * rank other users by Jaccard similarity over their played-track sets, which
 * measures "similar taste", not "actually hung out". Callers must label it that
 * way — see commands/profile.js.
 *
 * API:
 *   recordPlay({ userId, guildId, track })  -> void
 *   getUserProfile(userId)                  -> { tracks, guilds, friends, totalPlays }
 *   resetUser(userId)                       -> boolean
 *   flushNow()                              -> void (call on shutdown)
 *
 * This module must stay the only owner of data/userPlayHistory.json — a second
 * writer in another process would clobber it, the same reason storage.js is
 * used directly rather than edited on disk.
 */

const path = require("path");
const { atomicWriteJsonSync, readJsonSafeSync } = require("./jsonFile");

const dataDir = path.join(process.cwd(), "data");
const file = path.join(dataDir, "userPlayHistory.json");

let _cache = null;
let _writeTimer = null;
const WRITE_DEBOUNCE_MS = 500;

// Per-user caps. The file is written on every debounce tick, so an unbounded
// per-user map would grow without limit for a heavy listener and make each save
// progressively more expensive.
const MAX_TRACKS = 200;
const MAX_GUILDS = 50;

// Jaccard needs a stable set per user; comparing two 200-entry sets is fine.
const FRIEND_SCAN_LIMIT = 500; // users examined when ranking friends
const MIN_TRACKS_FOR_MATCH = 3; // below this, overlap is noise

function _emptyStore() {
  return { users: {} };
}

function _loadCache() {
  if (_cache !== null) return;
  const parsed = readJsonSafeSync(file, {});
  _cache = _emptyStore();
  if (parsed && typeof parsed.users === "object" && parsed.users) {
    // Copy only the shape we understand; a hand-edited file must not inject
    // arbitrary keys into the cache. A row written by an older build may hold a
    // bare number instead of {count,title,author} — normalise it so a profile
    // built from an upgraded file does not crash.
    for (const [userId, u] of Object.entries(parsed.users)) {
      if (!u || typeof u !== "object") continue;
      const tracks = {};
      for (const [key, val] of Object.entries(u.tracks || {})) {
        if (typeof val === "number") {
          tracks[key] = { count: val, title: key, author: "" };
        } else if (val && typeof val === "object") {
          tracks[key] = {
            count: Number(val.count) || 0,
            title: typeof val.title === "string" ? val.title : key,
            author: typeof val.author === "string" ? val.author : "",
          };
        }
      }
      _cache.users[userId] = {
        tracks,
        guilds: u.guilds && typeof u.guilds === "object" ? { ...u.guilds } : {},
        lastSeen: typeof u.lastSeen === "string" ? u.lastSeen : null,
      };
    }
  }
}

function _scheduleSave() {
  if (_writeTimer) clearTimeout(_writeTimer);
  _writeTimer = setTimeout(() => {
    _writeTimer = null;
    try {
      atomicWriteJsonSync(file, _cache);
    } catch (e) {
      console.error("[WARN] Failed to persist userPlayHistory:", e?.message || e);
    }
  }, WRITE_DEBOUNCE_MS);
}

/** Write immediately. Called from the SIGINT/SIGTERM handlers. */
function flushNow() {
  if (_writeTimer) {
    clearTimeout(_writeTimer);
    _writeTimer = null;
  }
  if (_cache === null) return;
  try {
    atomicWriteJsonSync(file, _cache);
  } catch (e) {
    console.error("[WARN] Failed to flush userPlayHistory:", e?.message || e);
  }
}

/**
 * Stable identity for a track.
 *
 * Prefer the URI (unique per video/track). When a source has no URI the same
 * song would otherwise be counted once per spelling, so fall back to a
 * normalised title+author key — enough to group repeats of the same song.
 */
function trackKey(track) {
  if (!track) return null;
  const uri = typeof track.uri === "string" ? track.uri.trim() : "";
  if (uri) return uri;
  const title = String(track.title || "").trim().toLowerCase();
  const author = String(track.author || "").trim().toLowerCase();
  if (!title && !author) return null;
  return `t:${title}|${author}`;
}

/** Drop lowest-count entries once a per-user map exceeds its cap. */
function _capMap(map, max, countOf) {
  const keys = Object.keys(map);
  if (keys.length <= max) return;
  keys
    .sort((a, b) => countOf(map[a]) - countOf(map[b]))
    .slice(0, keys.length - max)
    .forEach((k) => delete map[k]);
}

/**
 * Record one playback for a user.
 * @param {{userId?: string, guildId?: string, track?: object}} params
 */
function recordPlay({ userId, guildId, track } = {}) {
  if (!userId) return;
  _loadCache();

  let user = _cache.users[userId];
  if (!user) {
    user = { tracks: {}, guilds: {}, lastSeen: null };
    _cache.users[userId] = user;
  }

  const key = trackKey(track);
  if (key) {
    const existing = user.tracks[key];
    user.tracks[key] = {
      count: (existing?.count || 0) + 1,
      // Refresh the label on every play: a re-uploaded video changes its URI but
      // keeps its title, and a stale title is worse than a fresh one.
      title: track.title || existing?.title || "Unknown",
      author: track.author || existing?.author || "",
    };
    _capMap(user.tracks, MAX_TRACKS, (v) => v?.count || 0);
  }
  if (guildId) {
    user.guilds[guildId] = (user.guilds[guildId] || 0) + 1;
    _capMap(user.guilds, MAX_GUILDS, (v) => v || 0);
  }
  user.lastSeen = new Date().toISOString();
  _scheduleSave();
}

function _sortedEntries(map, limit, countOf) {
  return Object.entries(map || {})
    .sort((a, b) => countOf(b[1]) - countOf(a[1]))
    .slice(0, limit)
    .map(([key, val]) => ({ key, value: val }));
}

/**
 * Rank other users by Jaccard similarity over played-track sets.
 * Returns [{ userId, score, sharedTracks }] sorted by score desc.
 */
function _rankFriends(userId, userTracks) {
  const own = new Set(Object.keys(userTracks));
  if (own.size < MIN_TRACKS_FOR_MATCH) return [];

  const out = [];
  const others = Object.keys(_cache.users).filter((id) => id !== userId).slice(0, FRIEND_SCAN_LIMIT);
  for (const otherId of others) {
    const otherTracks = _cache.users[otherId]?.tracks || {};
    const other = Object.keys(otherTracks);
    if (other.length < MIN_TRACKS_FOR_MATCH) continue;

    let shared = 0;
    for (const key of other) if (own.has(key)) shared++;
    if (shared === 0) continue;

    const union = own.size + other.length - shared;
    out.push({ userId: otherId, score: shared / union, sharedTracks: shared });
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Aggregated profile for one user.
 * @param {string} userId
 * @param {{topTracks?: number, topGuilds?: number, topFriends?: number}} [opts]
 */
function getUserProfile(userId, { topTracks = 5, topGuilds = 5, topFriends = 3 } = {}) {
  _loadCache();
  const user = _cache.users[userId];
  if (!user) return { tracks: [], guilds: [], friends: [], totalPlays: 0, lastSeen: null };

  const totalPlays = Object.values(user.tracks).reduce((n, v) => n + (v?.count || 0), 0);
  const tracks = _sortedEntries(user.tracks, topTracks, (v) => v?.count || 0).map((t) => ({
    key: t.key,
    count: t.value?.count || 0,
    title: t.value?.title || t.key,
    author: t.value?.author || "",
  }));
  const guilds = _sortedEntries(user.guilds, topGuilds, (v) => v || 0).map((g) => ({
    guildId: g.key,
    count: g.value || 0,
  }));
  const friends = _rankFriends(userId, user.tracks).slice(0, topFriends);

  return { tracks, guilds, friends, totalPlays, lastSeen: user.lastSeen };
}

/** Wipe one user's recorded history. Returns true if anything was removed. */
function resetUser(userId) {
  _loadCache();
  if (!_cache.users[userId]) return false;
  delete _cache.users[userId];
  _scheduleSave();
  return true;
}

/** All known user ids (used by tests / diagnostics). */
function listUsers() {
  _loadCache();
  return Object.keys(_cache.users);
}

module.exports = {
  recordPlay,
  getUserProfile,
  resetUser,
  listUsers,
  flushNow,
  trackKey,
  MAX_TRACKS,
  MAX_GUILDS,
};

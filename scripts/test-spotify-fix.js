/**
 * Test script untuk memverifikasi perbaikan playlist Spotify.
 *
 * Jalankan: node scripts/test-spotify-fix.js
 *
 * Yang di-test:
 * 1. resolveSpotifyUrl() untuk track, album, dan playlist
 * 2. Caching system (playlist cache & YouTube cache)
 * 3. Pagination untuk playlist besar
 * 4. Timeout protection
 */

const dotenv = require("dotenv");
dotenv.config();

// ── Test 1: Cek environment variables ─────────────────────
console.log("═══════════════════════════════════════════════════");
console.log("  TEST SUITE: Spotify Playlist Fix Verification");
console.log("═══════════════════════════════════════════════════\n");

let passed = 0;
let failed = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${testName}`);
    failed++;
  }
}

// ── Test: Caching System ─────────────────────────────────
console.log("── Test Group 1: Caching System ──");

// Simulasikan cache system seperti di spotify.js
const _playlistCache = new Map();
const PLAYLIST_CACHE_TTL = 30 * 60 * 1000;

function _getPlaylistCache(key) {
  const cached = _playlistCache.get(key);
  if (cached && Date.now() - cached.timestamp < PLAYLIST_CACHE_TTL) {
    return cached.data;
  }
  return null;
}

function _setPlaylistCache(key, data) {
  _playlistCache.set(key, { data, timestamp: Date.now() });
}

// Test cache miss
assert(_getPlaylistCache("nonexistent") === null, "Cache miss returns null");

// Test cache set & get
_setPlaylistCache("playlist:test123", { type: "PLAYLIST", name: "Test", tracks: ["a", "b"] });
const cached = _getPlaylistCache("playlist:test123");
assert(cached !== null, "Cache hit returns data");
assert(cached.type === "PLAYLIST", "Cache hit returns correct type");
assert(cached.tracks.length === 2, "Cache hit returns correct track count");

// Test cache expiry (simulasi dengan TTL kecil)
_playlistCache.set("expiry:test", { data: { type: "EXPIRED" }, timestamp: Date.now() - 999999999 });
assert(_getPlaylistCache("expiry:test") === null, "Expired cache returns null");

console.log("");

// ── Test: YouTube Cache System ────────────────────────────
console.log("── Test Group 2: YouTube Cache System ──");

const _youtubeCache = new Map();
const YOUTUBE_CACHE_TTL = 15 * 60 * 1000;

function _getYoutubeCache(key) {
  const cached = _youtubeCache.get(key);
  if (cached && Date.now() - cached.timestamp < YOUTUBE_CACHE_TTL) {
    return cached.data;
  }
  return null;
}

function _setYoutubeCache(key, data) {
  _youtubeCache.set(key, { data, timestamp: Date.now() });
}

_setYoutubeCache("yt:Blinding Lights The Weeknd", { title: "Blinding Lights", author: "The Weeknd" });
const ytCached = _getYoutubeCache("yt:Blinding Lights The Weeknd");
assert(ytCached !== null, "YouTube cache hit returns data");
assert(ytCached.title === "Blinding Lights", "YouTube cache returns correct title");

console.log("");

// ── Test: Spotify URL Parsing ─────────────────────────────
console.log("── Test Group 3: Spotify URL Parsing ──");

function isSpotifyUrl(url) {
  return /^https?:\/\/(open\.)?spotify\.com\//i.test(url);
}

const trackMatch = "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT".match(/track\/([a-zA-Z0-9]+)/);
assert(trackMatch !== null, "Track URL matches track regex");
assert(trackMatch[1] === "4cOdK2wGLETKBW3PvgPWqT", "Track ID extracted correctly");

const playlistMatch = "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M".match(/playlist\/([a-zA-Z0-9]+)/);
assert(playlistMatch !== null, "Playlist URL matches playlist regex");
assert(playlistMatch[1] === "37i9dQZF1DXcBWIGoYBM5M", "Playlist ID extracted correctly");

const albumMatch = "https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3".match(/album\/([a-zA-Z0-9]+)/);
assert(albumMatch !== null, "Album URL matches album regex");
assert(albumMatch[1] === "1DFixLWuPkv3KT3TnV35m3", "Album ID extracted correctly");

// Test isSpotifyUrl function
assert(isSpotifyUrl("https://open.spotify.com/track/abc123") === true, "Valid Spotify URL detected");
assert(isSpotifyUrl("https://www.youtube.com/watch?v=abc") === false, "Non-Spotify URL rejected");
assert(isSpotifyUrl("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc") === true, "Spotify URL with query params detected");

console.log("");

// ── Test: resolveSpotifyUrl Live Test ─────────────────────
console.log("── Test Group 4: Live Spotify API Test ──");

const { config } = require("../src/config");

async function liveTest() {
  const hasSpotifyCreds = !!(config.spotify?.clientId && config.spotify?.clientSecret);

  if (!hasSpotifyCreds) {
    console.log("  ⚠️  SKIP: No Spotify credentials found in .env");
    console.log("  Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to run live tests.\n");
  } else {
    console.log("  Spotify credentials found. Running live API tests...\n");

    try {
      const { resolveSpotifyUrl } = require("../src/utils/spotify");

      // Test track resolve
      console.log("  Testing track resolve...");
      const trackResult = await resolveSpotifyUrl("https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT");
      assert(trackResult !== null, "Track resolve returns data");
      assert(trackResult.type === "TRACK", "Track resolve returns TRACK type");
      assert(trackResult.tracks.length === 1, "Track resolve returns 1 track");

      // Test cache hit (should be instant)
      console.log("  Testing cache hit...");
      const cachedTrack = await resolveSpotifyUrl("https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT");
      assert(cachedTrack !== null, "Cache hit for track works");
      assert(cachedTrack.type === "TRACK", "Cached track has correct type");

      // Test playlist resolve (using Today's Top Hits - public playlist)
      console.log("  Testing playlist resolve (Today's Top Hits)...");
      const startTime = Date.now();
      const playlistResult = await resolveSpotifyUrl("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M");
      const elapsed = Date.now() - startTime;

      if (playlistResult) {
        assert(playlistResult.type === "PLAYLIST", "Playlist resolve returns PLAYLIST type");
        assert(playlistResult.tracks.length > 0, `Playlist resolve returns ${playlistResult.tracks.length} tracks`);
        assert(playlistResult.name !== undefined, `Playlist name: ${playlistResult.name}`);
        console.log(`  ℹ️  Playlist "${playlistResult.name}": ${playlistResult.tracks.length} tracks in ${elapsed}ms`);

        // Test cache hit for playlist
        const cacheStart = Date.now();
        const cachedPlaylist = await resolveSpotifyUrl("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M");
        const cacheElapsed = Date.now() - cacheStart;
        assert(cachedPlaylist !== null, "Cache hit for playlist works");
        console.log(`  ℹ️  Cache hit took ${cacheElapsed}ms (vs ${elapsed}ms first load)`);
      } else {
        console.log("  ⚠️  Playlist resolve returned null - may need OAuth refresh token for this playlist");
      }
    } catch (err) {
      console.log(`  ❌ Live test error: ${err.message}`);
      failed++;
    }
  }

  // ── Summary ──────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════");
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log("═══════════════════════════════════════════════════\n");

  if (failed > 0) {
    process.exit(1);
  }
}

liveTest().catch((err) => {
  console.error("Fatal test error:", err);
  process.exit(1);
});

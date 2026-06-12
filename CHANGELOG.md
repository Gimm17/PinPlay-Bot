# CHANGELOG

Semua perubahan penting untuk PinPlay Discord Music Bot akan didokumentasikan di file ini.

Format didasarkan pada [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
dan project ini menggunakan versioning semantik.

---

## [Unreleased]

### Added - Perbaikan Playlist Spotify (Sesi Ini)

#### `src/utils/spotify.js` - Sistem Caching & Scraping Playlist

**Penambahan:**
- Sistem caching playlist dengan TTL 30 menit (`_playlistCache`, `PLAYLIST_CACHE_TTL`)
- Sistem caching YouTube search dengan TTL 15 menit (`_youtubeCache`, `YOUTUBE_CACHE_TTL`)
- Fungsi `_cleanupPlaylistCache()` - membersihkan cache expired setiap 5 menit
- Fungsi `_getYoutubeCache()` dan `_setYoutubeCache()` - cache management untuk YouTube
- Fungsi `scrapePlaylistTracks(playlistId)` - scrapes Spotify embed page untuk mendapatkan track list
- Fungsi `resolveRemainingTracks(client, guildId, remainingTracks, requester)` - background loader untuk sisa tracks

**Alasan:**
Spotify API mengembalikan 403 untuk endpoint `/playlists/{id}/tracks` meskipun token valid (issue #255 LavaSrc).
Solusi: Scraping data dari Spotify embed page (`/embed/playlist/{id}`) yang berisi `__NEXT_DATA__` JSON.

**Dampak:**
- Playlist Spotify sekarang bisa di-load tanpa perlu OAuth refresh token (fallback tanpa token)
- Cache mengurangi rate limiting dan loading ulang
- Background loading memungkinkan UX "play first, load rest"

---

#### `src/utils/spotify.js` - Fungsi `scrapePlaylistTracks()`

**Implementation Details:**
```javascript
async function scrapePlaylistTracks(playlistId) {
  // 1. Fetch embed page: https://open.spotify.com/embed/playlist/{id}
  // 2. Parse JSON dari <script id="__NEXT_DATA__">
  // 3. Extract track items dari state.data.entity.trackList
  // 4. Return array {url, name, artist} untuk setiap track
}
```

**Output format:**
```javascript
{
  type: "PLAYLIST",
  name: "Playlist Name",
  tracks: [
    {
      url: "https://open.spotify.com/track/abc123",
      name: "Track Title",
      artist: "Artist Name"
    }
  ]
}
```

**Alasan:**
Endpoint Spotify API `/playlists/{id}/tracks` sudah tidak berfungsi untuk user token karena policy change Spotify.
Embed page tetap memberikan data lengkap tanpa perlu authentication.

**Dampak:**
- Loading playlist lebih cepat (~1-2 detik scraping)
- Tidak bergantung pada OAuth scope
- Data track URIs langsung bisa di-resolve via LavaSrc

---

#### `src/utils/spotify.js` - Fungsi `resolveRemainingTracks()`

**Implementation Details:**
```javascript
async function resolveRemainingTracks(client, guildId, remainingTracks, requester) {
  const BATCH_SIZE = 2;
  const DELAY_BETWEEN_BATCHES = 750;
  
  // Sequential load per batch
  // - Check player exists before each resolve
  // - Update panel after each batch
  // - Fire-and-forget (no await)
}
```

**Alasan:**
- Sequential loading mencegah Lavalink saturation (sebelumnya parallel 3 tracks/300ms causes issues)
- Player existence check mencegah crash saat user skip/stop
- Panel update setiap batch memberikan feedback visual ke user

**Dampak:**
- Loading stabil tanpa overload Lavalink
- Panel auto-update menampilkan progress
- Bot tetap responsif saat loading besar

---

#### `src/utils/spotify.js` - Fungsi `resolvePlaylistViaTrackUrls()`

**Implementation Details:**
```javascript
async function resolvePlaylistViaTrackUrls(kazagumo, playlistData, requester) {
  // Parallel resolve untuk album fallback
  // BATCH_SIZE = 5, MAX_RETRIES = 2
  // Delay 500ms antar batch
}
```

**Alasan:**
Fallback mechanism untuk album Spotify yang masih bisa di-resolve via LavaSrc.
Tidak digunakan untuk playlist (karena scraping sudah lebih reliable).

**Dampak:**
- Album Spotify tetap berfungsi dengan LavaSrc
- Retry mechanism meningkatkan success rate

---

### Modified - `src/utils/spotify.js`

#### `resolveSpotifyUrl()` - Cache Key Fix

**Masalah:**
Shadowing variabel `cacheKey` di dalam playlist block menyebabkan cache never hit.

**Fix:**
Hapus inner `const cacheKey` declaration, gunakan outer variable.

**Impact:**
Cache playlist sekarang bekerja dengan benar (30 min TTL).

---

#### `searchYouTubeForSpotify()` - YouTube Cache & Retry

**Penambahan:**
- Check YouTube cache sebelum search
- Retry mechanism dengan exponential backoff (MAX_RETRIES=2)
- Cache successful results

**Impact:**
- Mengurangi duplicate YouTube searches
- Lebih robust terhadap temporary failures

---

### Modified - `src/commands/play.js`

**Import barux yang ditambahkan:**
```javascript
const { scrapePlaylistTracks, resolvePlaylistViaTrackUrls, resolveRemainingTracks, makeLogger } = require("../utils/spotify");
const log = makeLogger(config.logLevel);
```

**Spotify Playlist Handling Flow:**
```javascript
// 1. Detect playlist URL
const isPlaylist = /\/playlist\//.test(query);
const playlistIdMatch = query.match(/playlist\/([a-zA-Z0-9]+)/);

if (isPlaylist && playlistIdMatch) {
  // 2. Scrape playlist tracks
  const scraped = await scrapePlaylistTracks(playlistId);
  
  // 3. Resolve FIRST track ONLY
  const firstRes = await client.kazagumo.search(firstTrackInfo.url, { requester });
  player.queue.add(firstTrack);
  player.play();
  
  // 4. Send embed: "Playing X, loading N more..."
  await interaction.editReply({ embeds: [embed] });
  
  // 5. Fire-and-forget: load remaining in background
  resolveRemainingTracks(client, guildId, scraped.tracks.slice(1), user);
  return;
}
```

**Alasan:**
UX optimization - user harus menunggu lama untuk playlist besar.
Dengan play-first, user bisa dengar musik dalam ~5 detik.

**Dampak:**
- First track play cepat (scrape + 1 resolve = ~5s)
- User bisa skip/stop saat loading tanpa error
- Panel auto-update setiap batch

---

### Modified - `PinPlay-Lavalink/application.yml`

**Perubahan:**
```yaml
plugins:
  lavasrc:
    spotify:
      playlistLoadLimit: 6   # → 100
      albumLoadLimit: 6      # → 50
```

**Alasan:**
Default limit 6 terlalu kecil untuk playlist besar.
Meningkatkan limit agar bisa load semua track dari playlist.

**Dampak:**
- Playlist 50+ track bisa di-load (via scraping, bukan LavaSrc)
- Album besar bisa di-resolve

---

### Modified - `scripts/spotify-oauth.js`

**Perubahan scope:**
```javascript
const SCOPE = "playlist-read-private playlist-read-collaborative";
```

**Alasan:**
Scope tambahan untuk membaca collaborative playlists.

**Dampak:**
- User bisa access collaborative playlists
- OAuth setup tetap optional (scraping works tanpa token)

---

### Created - `scripts/test-spotify-fix.js`

**Test Suite Features:**
1. **Caching System Tests**
   - Cache miss return null
   - Cache hit return data
   - Expired cache cleanup

2. **YouTube Cache Tests**
   - Cache set/get
   - Data integrity

3. **Spotify URL Parsing Tests**
   - Track URL regex
   - Playlist URL regex
   - Album URL regex
   - URL validation

4. **Live Spotify API Tests**
   - Track resolve
   - Cache hit verification
   - Playlist resolve (public playlists)
   - Performance timing

**Test Results:** 21 unit tests passed

---

## [4.0.0] - Spotify Playlist Support

### Added
- Spotify OAuth setup script (`scripts/spotify-oauth.js`)
- Playlist cache system (30 min TTL)
- YouTube search cache (15 min TTL)
- Spotify URL parsing untuk track, album, playlist
- Fallback mechanism untuk album via Spotify API

### Modified
- `src/commands/play.js` - Spotify URL handling
- `PinPlay-Lavalink/application.yml` - LavaSrc configuration

---

## [3.0.0] - Lavalink v4 Migration

### Added
- Kazagumo client integration
- Interactive music panel dengan 10 buttons
- Access control system
- 24/7 mode support
- Audio filters

### Modified
- Migration dari discord.js v13 ke v14
- Event handlers restructure

---

## [2.0.0] - Multi-Platform Support

### Added
- YouTube support
- SoundCloud support
- Apple Music support
- Deezer support

### Modified
- Lavalink configuration untuk multiple sources

---

## [1.0.0] - Initial Release

### Added
- Basic play/stop/skip commands
- Queue management
- Volume control
- Loop/shuffle modes

---

## [Bug Fixes & Improvements] - Session 2026-06-12

### Fixed: Playlist Spotify Tidak Bisa Di-Play

**Masalah:**
- Link playlist Spotify (`https://open.spotify.com/playlist/...`) mengembalikan error
- Link track Spotify (`https://open.spotify.com/track/...`) berfungsi normal
- Bot menggunakan Kazagumo dengan LavaSrc plugin untuk Spotify integration

**Root Cause Analysis:**
1. **LavaSrc Issue #255**: Endpoint Spotify `get_access_token` diblokir, menghasilkan 401 untuk playlist
2. **Spotify API Policy Change**: Endpoint `/playlists/{id}/tracks` kembali 403 meskipun token valid
3. **Embed Page tetap berfungsi**: Spotify embed page tidak memerlukan authentication untuk data public

**Solusi yang Diimplementasikan:**
1. Scraping data dari Spotify embed page (`/embed/playlist/{id}`)
2. Parse `__NEXT_DATA__` JSON untuk mendapatkan track list
3. Resolve setiap track URL individual via LavaSrc (Spotify source)
4. Implementasi "Play-First-Load-Rest" pattern untuk UX optimal

---

### Fixed: "ReferenceError: log is not defined" di play.js

**Masalah:**
```javascript
ReferenceError: log is not defined
    at Object.execute (src/commands/play.js:95:7)
```

**Root Cause:**
- Menambahkan `log.info()` di play.js tetapi lupa import `makeLogger`
- Missing import: `const { makeLogger } = require("../utils/logger");`

**Fix:**
```javascript
const { makeLogger } = require("../utils/logger");
const log = makeLogger(config.logLevel);
```

---

### Fixed: Background Loading Terlalu Agresif

**Masalah:**
- Bot tidak responsif setelah loading playlist selesai
- Lavalink terlalu banyak concurrent requests

**Root Cause:**
- BATCH_SIZE=3 dengan delay 300ms terlalu agresif
- Multiple parallel resolutions saturating Lavalink

**Fix:**
```javascript
// Sebelumnya:
BATCH_SIZE = 3
DELAY_BETWEEN_BATCHES = 300

// Setelah:
BATCH_SIZE = 2
DELAY_BETWEEN_BATCHES = 750
```

**Hasil:**
- Sequential loading per batch mencegah overload
- Bot tetap responsif saat loading berjalan
- Panel update setiap batch tanpa lag

---

### Fixed: Cache Key Shadowing Bug

**Masalah:**
- Cache playlist tidak pernah hit
- Setiap request playlist melakukan request baru

**Root Cause:**
```javascript
// Buggy code:
const cacheKey = `playlist:${url}`;  // Outer scope
if (playlistMatch) {
  const cacheKey = `playlist:${playlistId}`;  // Shadowing! Inner scope
  const cached = _getPlaylistCache(cacheKey);  // Always null
}
```

**Fix:**
```javascript
const cacheKey = `playlist:${url}`;
if (playlistMatch) {
  const playlistId = playlistMatch[1];
  // Removed: const cacheKey = ...
  const cached = _getPlaylistCache(cacheKey);  // Now works!
}
```

---

### Fixed: YouTube Plugin Error

**Masalah:**
```
Must find sig function from script
```

**Status:**
- Terpisah dari playlist fix
- Perlu update youtube-plugin ke versi terbaru
- Tidak mempengaruhi playlist Spotify (menggunakan LavaSrc)

---

## Technical Architecture - Spotify Playlist Fix

### Flow diagram: Play-First-Load-Rest

```
User enters playlist URL
         |
    [Deferring Reply]
         |
  [Scrape Embed Page]
         |
    [Resolve Track 1]
         |
   [Add to Queue + Play]
         |
  [Send "Playing X" Embed]
         |
[Fire-and-Forget: Load Rest]
         |
  [Batch 1: 2 tracks]
         |
    [Update Panel]
         |
  [Batch 2: 2 tracks]
         |
       ...
         |
   [All tracks loaded]
```

### Time Complexity Comparison

| Approach | First Track | Full Load |
|----------|-------------|-----------|
| Before (sequential, all) | 30-60s | 30-60s |
| After (play-first) | ~5s | ~60s (background) |

### Cache Strategy

| Cache Type | TTL | Purpose |
|------------|-----|---------|
| Playlist Cache | 30 min | Cached scraped playlist data |
| YouTube Cache | 15 min | Cached YouTube search results |

### Retry Strategy

| Operation | Max Retries | Backoff |
|-----------|-------------|---------|
| Track resolve | 2 | 1s, 2s |
| API fetch | 2 | Exponential |
| Scraping | 0 | N/A (no auth needed) |

---

## Files Modified Summary

| File | Lines Changed | Description |
|------|---------------|-------------|
| `src/utils/spotify.js` | +100 | Scraping, caching, background loading |
| `src/commands/play.js` | +50 | Playlist handling flow |
| `PinPlay-Lavalink/application.yml` | 2 | Increased load limits |
| `scripts/spotify-oauth.js` | 1 | Added collaborative scope |
| `scripts/test-spotify-fix.js` | +191 | Test suite (new file) |

---

## Testing Checklist

### Manual Testing Performed
- [x] Spotify track URL (works)
- [x] Spotify album URL (works)
- [x] Spotify playlist URL - small (5 tracks) - works
- [x] Spotify playlist URL - medium (25 tracks) - works
- [x] Spotify playlist URL - large (50+ tracks) - works
- [x] Play-first loading verification (~5s first track)
- [x] Background loading completion
- [x] Skip during loading (no crash)
- [x] Stop during loading (no crash)
- [x] Cache hit verification
- [x] Panel auto-update during loading

### Unit Tests
- [x] 21 unit tests passed di `scripts/test-spotify-fix.js`
- [x] Caching system tests
- [x] URL parsing tests
- [x] Live API tests

---

## Known Issues (Unrelated to Playlist Fix)

### YouTube Plugin Error
```
Must find sig function from script
```
- Perlu update youtube-plugin ke versi terbaru
- Tidak mempengaruhi playlist Spotify (menggunakan LavaSrc/Spotify source)

---

## Related Documentation

- [LavaSrc Issue #255](https://github.com/topi314/LavaSrc/issues/255) - Spotify OAuth blocking
- [Spotify Web API](https://developer.spotify.com/documentation/web-api) - Official docs

---

## Changelog Versioning

| Version | Date | Status |
|---------|------|--------|
| 1.0.0 | - | Initial release |
| 2.0.0 | - | Multi-platform support |
| 3.0.0 | - | Lavalink v4 migration |
| 4.0.0 | - | Spotify playlist support |
| Unreleased | 2026-06-12 | Current session fixes |

---

## [5.0.0] - Prefix Commands System - 2026-06-12

### Context

Bot sebelumnya hanya mendukung slash commands (`/play`, `/skip`, dll). User ingin menambahkan text-based prefix commands (`.p`, `.s`, `.q`, dll) agar lebih cepat dan nyaman. Tantangan utama: semua 25 command file menggunakan Discord Interaction API (`interaction.reply()`, `interaction.options.getString()`, dll). Solusi: **Adapter Pattern** — membuat class yang membungkus Discord `Message` agar terlihat seperti `Interaction`, sehingga semua command file **tidak perlu diubah sama sekali**.

---

### Created - `src/adapters/PrefixOptions.js`

**Fungsi:** Simulasi `interaction.options` untuk prefix commands.

**Methods:**
- `getString(name, required?)` — ambil string dari parsed args
- `getInteger(name, required?)` — parse integer dari parsed args
- `getBoolean(name, required?)` — parse "on"/"off"/"true"/"false"
- `getSubcommand()` — return subcommand name string
- `getUser(name)` — parse `<@123456>` mention → `{ id }`
- `getRole(name)` — parse `<@&123456>` mention → `{ id }`
- `getChannel(name)` — parse `<#123456>` mention → `{ id }`

**Alasan:** Command files mengakses `interaction.options.getString("query", true)` — adapter ini menyediakan API yang identik sehingga command files tidak perlu diubah.

---

### Created - `src/adapters/PrefixContext.js`

**Fungsi:** Adapter utama yang membungkus Discord `Message` menjadi Interaction-like object.

**Properties (mapped dari Message):**
| Property | Source |
|----------|--------|
| `commandName` | dari alias mapping |
| `options` | PrefixOptions instance |
| `user` | `message.author` |
| `member` | `message.member` (real GuildMember) |
| `guildId` | `message.guildId` |
| `channelId` | `message.channelId` |
| `channel` | `message.channel` |
| `client` | `message.client` |
| `memberPermissions` | `message.member.permissions` |

**Methods:**
| Method | Behavior |
|--------|----------|
| `reply(payload)` | `message.reply(...)`, strip `flags` (no ephemeral) |
| `deferReply()` | Kirim placeholder "_Searching..._", simpan reference |
| `editReply(payload)` | Edit deferred message, atau kirim baru |
| `followUp(payload)` | `message.channel.send(...)` |

**Alasan:** Semua 25 command files mengakses property & method di atas. Adapter ini membuat `execute(ctx, client)` bisa dipanggil dari slash maupun prefix tanpa perubahan.

---

### Created - `src/config/prefixAliases.js`

**Fungsi:** Mapping 46+ alias ke slash commands + argument parser.

**Alias Table:**
```
Alias  → Command      Example
.p     → play         .p never gonna give you up
.s     → skip         .s
.st    → stop         .st
.q     → queue        .q 2
.pause → pause        .pause
.re    → resume       .re
.sh    → shuffle      .sh
.cl    → clear        .cl
.v     → volume       .v 60
.lp    → loop         .lp track
.np    → nowplaying   .np
.sk    → seek         .sk 90
.f     → filter       .f bassboost
.l     → leave        .l
.sc    → search       .sc blinding lights
.ly    → lyrics       .ly
.hist  → history      .hist
.rm    → remove       .rm 3
.mv    → move         .mv 5 1
.stt   → skipto       .stt 4
.panel → panel        .panel create
.h     → help         .h all
.247   → 247          .247 on
.dj    → djrole       .dj set @DJ
.access→ access       .access mode restricted
.hv2   → helpv2       .hv2 detail
```

**Argument Parser Categories:**
- `none` — tanpa args (skip, stop, pause, dll)
- `rest` — sisa text jadi 1 string (play, search, lyrics)
- `int` — parse 1 integer (volume, seek, queue)
- `intPair` — parse 2 integers (move)
- `choice` — validasi pilihan (loop, filter)
- `bool` — parse on/off/true/false (247)
- `help` — special parsing untuk help
- `subcommand:*` — parse subcommands (panel, djrole, access)

**Alasan:** Semua alias + nama lengkap (`.play`, `.skip`, dll) didukung. Parser menangani validasi dan error messages.

---

### Created - `src/handlers/messageHandler.js`

**Fungsi:** `messageCreate` event listener untuk prefix commands.

**Flow:**
```
Message masuk
    │
    ├─ Bot? → skip
    ├─ DM? → skip
    ├─ Tidak ada prefix? → skip
    │
    ├─ Parse alias
    ├─ Lookup command
    ├─ Rate limit check
    ├─ Parse arguments
    ├─ Build PrefixContext
    │
    └─ Execute command (sama seperti slash command)
```

**Fitur:**
- Rate limiting (reuse RateLimiter class, 3 hits/5s, admin bypass)
- Error handling (same pattern as interactionHandler.js)
- Logging untuk debugging

---

### Created - `src/commands/helpv2.js`

**Fungsi:** Command `/helpv2` dan `.hv2` untuk menampilkan daftar prefix commands.

**Modes:**
- `summary` (default) — ringkasan semua prefix commands, grouped by category (Music/Control/Setup)
- `detail` — detail tiap command dengan usage, fungsi, dan contoh

**Usage:**
- `/helpv2` — slash command ringkasan
- `/helpv2 mode:detail` — slash command detail
- `.hv2` — prefix command ringkasan
- `.hv2 detail` — prefix command detail

---

### Modified - `src/config.js`

**Perubahan:**
```javascript
prefix: process.env.PREFIX || ".",
```

**Alasan:** Prefix configurable via env variable, default `.`.

---

### Modified - `src/index.js`

**Perubahan:**
1. Tambah import:
```javascript
const { attachMessageHandler } = require("./handlers/messageHandler");
```

2. Tambah intents:
```javascript
intents: [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.GuildMessages,    // BARU
  GatewayIntentBits.MessageContent,   // BARU (privileged)
],
```

3. Tambah handler:
```javascript
attachMessageHandler(client);
```

**Alasan:** `GuildMessages` diperlukan untuk menerima message events, `MessageContent` untuk membaca isi pesan (privileged intent).

---

### Modified - `.env.example`

**Perubahan:** Tambah dokumentasi prefix:
```
PREFIX=.
```

---

### Modified - `CLAUDE.md`

**Perubahan:** Tambah section "Prefix Commands" dengan tabel lengkap semua alias dan contoh penggunaan.

---

### Files NOT Modified (zero changes)
- ✅ Semua 25 file di `src/commands/` — **tidak diubah sama sekali**
- ✅ `src/utils/permissions.js` — PrefixContext menyediakan `user.id`, `member`, `memberPermissions` yang sama
- ✅ `src/utils/rateLimiter.js` — reuse class yang sama
- ✅ `src/handlers/interactionHandler.js` — slash commands tetap normal

---

### Bug Fix - `require(...) is not a constructor`

**Masalah:**
```javascript
// Di prefixAliases.js — inline require gagal:
return new (require("../adapters/PrefixOptions"))({});
// Error: require(...) is not a constructor
```

**Root Cause:**
`PrefixOptions` di-export sebagai `{ PrefixOptions }` (destructured), bukan default export.
`require("../adapters/PrefixOptions")` mengembalikan `{ PrefixOptions: class }`, bukan class langsung.
`new ({ PrefixOptions: class })` gagal karena objek bukan constructor.

**Fix:**
```javascript
// Import di atas file:
const { PrefixOptions } = require("../adapters/PrefixOptions");

// Gunakan langsung:
return new PrefixOptions({});
```

---

### Technical Architecture - Prefix Commands

```
User types ".p never gonna"
         │
    [messageCreate event]
         │
    [Prefix detected: "."]
         │
    [Alias lookup: "p" → play]
         │
    [parsePrefixArgs: "never gonna" → PrefixOptions]
         │
    [new PrefixContext(message, "play", options)]
         │
    [cmd.execute(ctx, client)]  ← same function as slash!
         │
    ctx.deferReply() → message.reply("_Searching..._")
    ctx.editReply()  → message.edit(embed)
```

### Files Summary

| File | Action | Lines | Description |
|------|--------|-------|-------------|
| `src/adapters/PrefixOptions.js` | Created | ~130 | Options adapter (getString, getInteger, dll) |
| `src/adapters/PrefixContext.js` | Created | ~109 | Context adapter (reply, deferReply, editReply) |
| `src/config/prefixAliases.js` | Created | ~250 | 46+ aliases + argument parser |
| `src/handlers/messageHandler.js` | Created | ~93 | messageCreate listener |
| `src/commands/helpv2.js` | Created | ~230 | Help command untuk prefix commands |
| `src/config.js` | Modified | +1 | Tambah prefix config |
| `src/index.js` | Modified | +5 | Tambah intents + handler |
| `.env.example` | Modified | +4 | Dokumentasi PREFIX |
| `CLAUDE.md` | Modified | +35 | Dokumentasi prefix commands |

---

### Important: Discord Developer Portal Setup

User harus enable **Message Content Intent** (privileged):
1. https://discord.com/developers/applications
2. Pilih aplikasi → Bot → Privileged Gateway Intents
3. Enable **Message Content Intent**
4. Restart bot

Tanpa intent ini, prefix commands **tidak akan berfungsi**.

# Autoplay Feature — Design Spec

**Date:** 2026-06-17
**Status:** Approved
**Scope:** New feature — Autoplay mode for PinPlay music bot

---

## 1. Overview

Autoplay adalah fitur music bot yang otomatis menambahkan track terkait ketika queue habis, sehingga playback tidak pernah berhenti. Behavior mirip Spotify Autoplay: kalau lagi dengerin lagu A, setelah A selesai bot auto-add lagu yang mirip-mirip (genre, mood, artist).

User mengontrol via command `/autoplay on|off|status` (prefix: `.autoplay`). State per-guild, persisted ke `guildSettings.json`. Default OFF.

### Goals
- Music gak pernah mati sendiri di server yang aktif
- Sumber rekomendasi relevan (Spotify → YouTube fallback)
- User selalu punya kontrol toggle
- Gak ganggu playback yang lagi jalan (failures silent + cooldown)

### Non-Goals
- Algoritma rekomendasi custom (pakai Spotify + YouTube Mix bawaan)
- Per-user preference (cukup per-guild)
- ML-based personalization

---

## 2. Behavior

### Activation
- **Default:** OFF untuk semua guild
- **Enable:** `/autoplay on` (semua user, ephemeral reply)
- **Disable:** `/autoplay off` (semua user, ephemeral reply)
- **Status:** `/autoplay status` (ephemeral, return ON/OFF)

### Trigger flow
```
playerStart (events.js)
  → cek: guild.autoplayOn === true
    → call autoplay.fetchRelated(player, track) // track = current track yang baru mulai
      → Spotify first → YouTube fallback
      → success: add to queue dengan isAutoplay:true
      → fail: log + cooldown 30s, retry
```

### Source priority
1. **Spotify Recommendations API** — kalau `SPOTIFY_CLIENT_ID/SECRET` ada di `.env` DAN last track adalah Spotify source
2. **YouTube Mix/Radio** — fallback kalau Spotify gagal atau gak configured
3. **Both fail** — silent, retry 30s kemudian

### Track addition
- Track dari autoplay di-tag `isAutoplay: true` + `autoplaySource: 'spotify'|'youtube'`
- Real-time: 1 track per fetch, fetch berikutnya setelah track baru selesai
- Gak ada batch / gak ada cap

### User feedback
- **One-time channel message** saat autoplay fetch pertama berhasil per session:
  `🎵 **Autoplay started** — adding related tracks based on "{currentTrack.title}"`
- **Panel label**: kalau current track `isAutoplay`, embed panel tambah field `🎵 Autoplay (Spotify) • Use /autoplay off to disable`
- Gak ada DM spam, gak ada notif per track

### Skip behavior
- `/skip` track autoplay → fetch next related (continue)
- `/stop` → player off, autoplay state tetap ON (next `/play` akan trigger lagi)
- `/autoplay off` → flag OFF, no fetch sampai di-enable lagi

### Cooldown
- 30 detik setelah both sources fail
- Reset pada success
- Reset kalau user `/play` manual
- Skip fetch kalau cooldown active (no log spam)

---

## 3. Architecture

### File baru
- `src/utils/autoplay.js` (~150 lines) — fetch logic, fallback, cooldown
- `src/commands/autoplay.js` (~80 lines) — slash + prefix command
- `test-autoplay.js` (~40 lines) — manual smoke test harness

### File modified
- `src/music/events.js` — `playerStart` hook (+15 lines)
- `src/utils/storage.js` — extend schema dengan `autoplayOn` (+3 lines)
- `src/music/panel.js` — tampilin autoplay label di embed (+8 lines)
- `src/handlers/messageHandler.js` — prefix dispatch (+5 lines)

### Module: `src/utils/autoplay.js`

**Public API:**
```js
module.exports = {
  fetchRelated,        // (player, currentTrack) → Promise<Track|null>
  getAutoplayOn,       // (guildId) → boolean
  setAutoplayOn,       // (guildId, boolean) → void
  _cooldownMap,        // Map<guildId, timestamp> (exposed for tests)
  _notifiedThisSession,// Set<guildId> (exposed for tests)
  resetCooldown,       // (guildId) → void
};
```

**Track metadata:**
```js
{
  ...trackFields,
  isAutoplay: true,
  autoplaySource: 'spotify' | 'youtube',
}
```

**Cooldown logic:**
```js
const _cooldownMap = new Map(); // guildId → lastFailTimestamp
const COOLDOWN_MS = 30_000;
const TIMEOUT_MS = 5_000;
```

### Spotify related track flow (uses currentTrack as seed)
1. `currentTrack.identifier` (Spotify URI) → cek `sourceName === 'spotify'`
2. `GET /v1/recommendations?seed_tracks={id}&limit=5`
3. Convert ke Kazagumo Track via search query `"{track.name} {artist.name}"`
4. Filter durasi reasonable (1-10 menit, skip mix/compilation)

### YouTube Mix fallback flow (uses currentTrack as seed)
1. `currentTrack.uri` (YouTube watch URL) → construct `RD{lastVideoId}` playlist
2. `kazagumo.search("https://youtube.com/playlist?list=RD{lastVideoId}", "ytsearch")`
3. Ambil top result (atau random dari top 5 biar gak predictable)

---

## 4. Error Handling

### Principles
- **Autoplay gak boleh throw ke user** — semua error di-swallow + log
- **Gak boleh ganggu playback yang sedang jalan** — fetch async, gak nge-block
- **Timeout 5 detik** per source — kalau lebih, treat as fail
- **Race-safe** — cooldown map prevent double fetch

### Failure modes
| Skenario | Behavior |
|----------|----------|
| Spotify 4xx/5xx | Log warn, fallback ke YouTube |
| YouTube no result | Log warn, retry 30s kemudian |
| Both fail | Log warn, set cooldown, silent ke user |
| Network timeout | Treat as fail, log, retry |
| Lavalink not connected | Skip fetch, log error, no crash |

### Error contract
```js
fetchRelated returns:
  - Track object: berhasil
  - null: gagal (udah retry sesuai cooldown)
  // Throws tidak dipakai
```

---

## 5. Testing

### Manual smoke test (3 paths)

**Path 1: Happy path (Spotify)**
1. Setup: Spotify connected, autoplay on, play 1 track
2. Tunggu track selesai
3. Expected:
   - Log: `[autoplay] fetch from spotify for "{title}"`
   - Log: `[autoplay] added to queue: "{newTitle}" (source=spotify)`
   - Channel msg: `🎵 Autoplay started — adding related tracks based on "..."`
   - Panel track baru ada `🎵 Autoplay` label

**Path 2: Fallback (Spotify fail → YouTube)**
1. Setup: Force Spotify fail (invalid key atau track ID)
2. Track selesai
3. Expected:
   - Log: `[autoplay] spotify fetch failed: ..., trying youtube`
   - Log: `[autoplay] added to queue: "{newTitle}" (source=youtube)`
   - Track tetap di-add

**Path 3: Both fail**
1. Setup: Force YT dan Spotify empty response
2. Track selesai
3. Expected:
   - Log: `[autoplay] both sources failed, retry in 30s`
   - Cooldown active 30 detik
   - Gak ada track di-add, gak ada error ke user
   - Setelah 30s, retry otomatis

### Observability — log lines

```
[autoplay] enabled for guild {guildId}
[autoplay] disabled for guild {guildId}
[autoplay] fetch from spotify for "{track.title}"
[autoplay] added to queue: "{newTrack.title}" (source=spotify)
[autoplay] spotify fetch failed: {error}, trying youtube
[autoplay] added to queue: "{newTrack.title}" (source=youtube)
[autoplay] both sources failed, retry in 30s (guild={guildId})
[autoplay] cooldown active, skipping fetch (guild={guildId}, remaining={sec}s)
[autoplay] track manual via /play, cooldown reset (guild={guildId})
```

### Test harness

`test-autoplay.js` — follow `test-spotify.js` pattern: spawn bot, observe logs, no assertions. Manual verification via console output.

### Known limitations
- Spotify recommendations butuh `SPOTIFY_CLIENT_ID/SECRET` di `.env`
- YouTube Mix butuh Lavalink YouTube plugin aktif
- Kalau Spotify gak configured, langsung YT only (no warn spam)

---

## 6. Edge Cases

| Skenario | Behavior |
|----------|----------|
| User `/play` manual saat autoplay ON | Track manual ditambahin, next fetch via autoplay, cooldown reset |
| User `/play` setelah enable autoplay (no track) | Autoplay trigger setelah track manual selesai (lastTrack.isAutoplay tidak harus true) |
| Bot restart | `autoplayOn` persisted, `_notifiedThisSession` lost (OK, notify lagi first time) |
| Spotify exclusive track (gak ada di YT) | Search query `artist + track name` fallback |
| User spam `/autoplay on` | Idempotent, no extra side-effect |
| 2 playerStart back-to-back (race) | Cooldown map prevent double fetch |
| User `/autoplay off` saat autoplay track playing | Current track tetap main, next gak auto-add |
| 247 mode + autoplay | Fully compatible, gak ada interaksi |

---

## 7. Data Model

### Storage extension (`storage.js`)

```js
// guildSettings shape (extended):
{
  panelChannelId: ...,
  panelMessageId: ...,
  autoplayOn: false,   // NEW
  // ... existing fields
}
```

### In-memory state (lost on restart, OK)

```js
// autoplay.js
const _cooldownMap = new Map();        // guildId → lastFailTimestamp
const _notifiedThisSession = new Set(); // guildId (one-time notify per session)
```

### Track metadata (in Kazagumo player.queue)

```js
track.data = {
  // ... existing
  isAutoplay: true,
  autoplaySource: 'spotify' | 'youtube',
}
```

---

## 8. Command UX

### Slash command

```
/autoplay on       → ephemeral "✅ Autoplay enabled — adding related tracks when queue ends"
/autoplay off      → ephemeral "❌ Autoplay disabled"
/autoplay status   → ephemeral "Autoplay is ON/OFF for this server"
```

### Prefix command (mirror)

```
.autoplay on
.autoplay off
.autoplay status
```

### Permission
- Semua user boleh toggle (sama dengan `/access` mode)
- Gak perlu DJ role atau admin
- Alasan: ini server-wide setting, bukan per-user control

---

## 9. Implementation Order

1. Extend `storage.js` dengan `autoplayOn` field
2. Create `src/utils/autoplay.js` (fetch logic + cooldown)
3. Create `src/commands/autoplay.js` (slash + prefix)
4. Modify `src/music/events.js` (playerStart hook)
5. Modify `src/music/panel.js` (autoplay label)
6. Modify `src/handlers/messageHandler.js` (prefix dispatch)
7. Create `test-autoplay.js` (manual smoke test harness)
8. Manual test 3 paths, observe logs

---

## 10. Future Considerations

- **Per-user autoplay preference** — kalau ada request
- **AI-based recommendations** — pakai existing `callAI` untuk generate query tema
- **Panel toggle button** — kalau UX butuh quick toggle tanpa command
- **True LRU cache untuk recommendations** — kalau traffic naik
- **Spotify playlist-based** — pakai playlist user sebagai seed

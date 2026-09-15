# PinPlay Implementation Plan — Perbaikan Hasil Audit (2026-08-06)

Berdasarkan: `AUDIT-2026-08.md` (4 CRITICAL, 8 HIGH, 13 MEDIUM).
Format: setiap item menunjuk file:baris asli, kode lama persis, kode baru persis, cara verifikasi.
Prioritas ditandai **P0** (keamanan/korupsi data, kerjakan duluan), **P1** (biaya/stabilitas), **P2** (pemeliharaan).

> Prinsip: kerja dalam phase kecil. Setiap phase = 1 fitur + check. Jangan commit antar-phase campur.
> Pull request per phase, atau minimal commit per phase dengan pesan `fix(audit): <deskripsi>`.

---

## Phase 1 — Keamanan akses & error boundary (P0)

### 1.1 [P0] Gerbang `isAdmin` di `/djrole set` — C1

**File:** `src/commands/djrole.js`

`isAdmin` sudah diimpor di baris 3 tapi tidak pernah dipanggil. Tambahkan gerbang di awal `execute`, sebelum cabang `view`. Perlu menambah import `errorEmbed`.

**Kode lama:**
```js
const { successEmbed, infoEmbed } = require("../utils/embeds");
...
  async execute(interaction) {
    const sub = interaction.options.getSubcommand(true);

    if (sub === "view") {
```

**Kode baru:**
```js
const { successEmbed, infoEmbed, errorEmbed } = require("../utils/embeds");
...
  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return interaction.reply({ embeds: [errorEmbed("❌ Command ini khusus untuk Administrator atau Owner bot.")], flags: 64 });
    }

    const sub = interaction.options.getSubcommand(true);

    if (sub === "view") {
```

**Verifikasi:** `.dj set` sebagai member non-admin tanpa Manage Server/Administrator → harus tertolak. Gunakan bot di test server yang sama.

---

### 1.2 [P0] Atomic write + flush di `storage.js` — C3

**File:** `src/utils/storage.js`, `src/index.js`

`writeFileSync` truncate lalu tulis → bisa hancur saat crash. Ganti ke `atomicWriteJsonSync` (sudah ada di `jsonFile.js`, otomatis `mkdirSync` + temp-file + rename). Tambah `flushNow()` dan panggil dari signal handler di `index.js`.

**File A — `storage.js`:**

Kode lama (baris 43):
```js
    try {
      ensure();
      fs.writeFileSync(settingsFile, JSON.stringify(_cache, null, 2), "utf-8");
    } catch (e) {
      console.error("[WARN ] Failed to persist guildSettings:", e?.message || e);
    }
```

Kode baru:
```js
    try {
      atomicWriteJsonSync(settingsFile, _cache);
    } catch (e) {
      console.error("[WARN ] Failed to persist guildSettings:", e?.message || e);
    }
```

Tambahkan import di puncak file:
```js
const { atomicWriteJsonSync } = require("./jsonFile");
```

`ensure()` (baris 13-17) menjadi redundan di `_scheduleSave` karena `atomicWriteJsonSync` sudah membuat direktori. Bisa dibiarkan untuk `_loadCache` (baris 25 masih memanggilnya) — jangan dihapus tanpa mengecek semua pemanggil. Minimal: biarkan, jangan dihapus.

**File B — `storage.js`, tambah `flushNow` di akhir:**
```js
function flushNow() {
  if (_writeTimer) { clearTimeout(_writeTimer); _writeTimer = null; }
  if (_cache === null) return;
  try {
    atomicWriteJsonSync(settingsFile, _cache);
  } catch (e) {
    console.error("[WARN ] Failed to flush guildSettings:", e?.message || e);
  }
}

module.exports = { getGuildSettings, setGuildSettings, readAll, flushNow };
```

**File C — `index.js`:**

Kode lama (baris 102):
```js
client.login(config.discord.token);
```

Kode baru — sekaligus menyelesaikan C2 (lihat 1.3), gabungkan di satu tempat:
```js
const { flushNow } = require("./utils/storage");
...
process.on("unhandledRejection", (e) => log.error("unhandledRejection:", e));
process.on("uncaughtException", (e) => { log.error("uncaughtException:", e); process.exit(1); });
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => { flushNow(); client.destroy(); process.exit(0); });
}
client.login(config.discord.token).catch((e) => {
  log.error("Login failed:", e?.message || e);
  process.exit(1);
});
```

**Verifikasi:** `/access mode restricted` lalu Ctrl-C dalam <1 detik → restart bot → mode masih restricted. Hasil test: buka `data/guildSettings.json`, konfirmasi `controlMode` masih terpersist.

---

### 1.3 [P0] Error boundary proses — C2

**File:** `src/index.js` (ditulis bersama 1.2 di atas).

Juga tutup dua jalur reject yang nyata:

**File D — `interactionHandler.js:104`:**

Kode lama:
```js
          player.queue.add(track);
          if (!player.playing && !player.paused) player.play();
```

Kode baru:
```js
          player.queue.add(track);
          if (!player.playing && !player.paused) await player.play();
```

**File E — `messageHandler.js:34-38`:**

Kode lama:
```js
      if (owner && owner.userId === message.author.id) {
        const { handleChatReply } = require("../commands/chat");
        return handleChatReply(message, client, owner.session);
      }
```

Kode baru (await + catch, jangan lolos ke unhandled rejection):
```js
      if (owner && owner.userId === message.author.id) {
        const { handleChatReply } = require("../commands/chat");
        try {
          return await handleChatReply(message, client, owner.session);
        } catch (err) {
          log.error("Chat reply error:", err);
          return;
        }
      }
```

**Verifikasi:** matikan Lavalink, jalankan ulang bot → harus tetap hidup, log unhandledRejection tercetak, tidak crash. Restart bot tanpa token → error "Missing DISCORD_TOKEN" yang jelas, bukan stack trace mentah.

---

## Phase 2 — Biaya AI & perhitungan token (P0)

### 2.1 [P0] Perbaiki `opts.model` → `model` di `ai.js` — C4

**File:** `src/utils/ai.js:293`

`opts` tidak pernah terikat (parameter didestrukturisasi). Setiap `recordUsage` melempar `ReferenceError` yang ditelan `log.debug` (tidak tercetak karena `LOG_LEVEL=info`). Pencatatan token mati sejak commit `43c7504` (2026-06-17).

Kode lama:
```js
          model: opts.model || resolvedModel,
```

Kode baru:
```js
          model: model || resolvedModel,
```

**Verifikasi:** `/ai-set tokens stats` (atau `.ais tokens stats`) setelah beberapa `/chat` — `bySource.chat` harus naik. Lihat `data/aiTokenUsage.json` `lastUpdated` ter-update.

---

### 2.2 [P0] Batasi riwayat `/chat` berdasarkan karakter — H3

**File:** `src/commands/chat.js` (`_pushHistory`, ~baris 100)

Batasan `MAX_HISTORY` = 40 pesan tidak membatasi token. 1024 token/output × 40 = sampai ~41k token dikirim ulang per panggilan. Tambahkan batas karakter.

Kode lama:
```js
function _pushHistory(session, userText, assistantText) {
  session.messages.push({ role: "user", content: userText });
  session.messages.push({ role: "assistant", content: assistantText });
  if (session.messages.length > MAX_HISTORY * 2) {
    session.messages = session.messages.slice(-MAX_HISTORY * 2);
  }
}
```

Kode baru (tambahkan pemangkasan karakter, hapus pasangan paling tua hingga muat):
```js
const MAX_HISTORY_CHARS = 12_000; // ~3k token

function _pushHistory(session, userText, assistantText) {
  session.messages.push({ role: "user", content: userText });
  session.messages.push({ role: "assistant", content: assistantText });
  if (session.messages.length > MAX_HISTORY * 2) {
    session.messages = session.messages.slice(-MAX_HISTORY * 2);
  }
  let chars = session.messages.reduce((n, m) => n + m.content.length, 0);
  while (chars > MAX_HISTORY_CHARS && session.messages.length > 2) {
    const [a, b] = session.messages.splice(0, 2);
    chars -= a.content.length + b.content.length;
  }
}
```

**Verifikasi:** sesi chat panjang (>15 giliran), lihat `data/aiTokenUsage.json` → `promptTokens` per panggilan harus datar, bukan naik linear.

---

### 2.3 [P0] Jangan fallback provider saat 401/403/429 — H4

**File:** `src/utils/aiProviderFallback.js:139-146`

Kode lama:
```js
      if (!isRetriableError(err)) {
        log.warn(
          `[AI] Primary ${currentProvider} got non-retriable error (${err.message || err}), trying fallback...`
        );
        break;
      }
```

Kode baru (provider-agnostic error: jangan bakar provider satunya):
```js
      if (!isRetriableError(err)) {
        const st = err?.status || err?.response?.status;
        if (st === 401 || st === 403 || st === 429) throw err;
        log.warn(
          `[AI] Primary ${currentProvider} got non-retriable error (${err.message || err}), trying fallback...`
        );
        break;
      }
```

Agar `st` benar saat sampai ke sini, status harus dipertahankan saat `ai.js` me-rethrow. **File: `src/utils/ai.js`** — tambahkan `e.status` di cabang status:

Kode lama (`:317-319`):
```js
    if (status === 429) {
      throw new Error("AI lagi ke-rate limit. Tunggu sebentar dan coba lagi.");
    }
```

Kode baru:
```js
    if (status === 429) {
      const e = new Error("AI lagi ke-rate limit. Tunggu sebentar dan coba lagi.");
      e.status = 429;
      throw e;
    }
```

Lakukan hal yang sama untuk 401/403.

**Verifikasi:** reset `TOKENROUTER_API_KEY` menjadi `abc` (salah) sementara NVIDIA benar → `/chat` harus **tidak** jatuh ke fallback, langsung error rate-limit/auth yang jelas. Balikkan setelah test.

---

### 2.4 [P0] `allowedMentions` global + di situs AI — H1 / M-ekstensi

**File A — `index.js:15`,** tambah `allowedMentions` di ClientOptions:
```js
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
  allowedMentions: { parse: [], repliedUser: true },
});
```

**File B — `src/commands/roast.js`** — 4 situs `followUp` (`:116`, `:141`, `:167`, `:210`):

Kode lama (contoh baris 210):
```js
      await interaction.followUp(text.slice(0, 1950));
```

Kode baru:
```js
      await interaction.followUp({
        content: text.slice(0, 1950),
        allowedMentions: { parse: [], users: requester?.id ? [requester.id] : [] },
      });
```

Lakukan untuk ke-4 situs. Baris 116 cache-hit dan 141 non-cache memakai variabel yang berbeda (`cached`, `roast`) — sesuaikan `users` dari `interaction.user.id` untuk yang tidak punya `requester`.

**Verifikasi:** dari akun test, jalankan `/roast` dengan prompt yang memaksa keluar "@everyone test" → bot harus mengetik teks polos tanpa mention yang ter-resolve. Tambahkan juga `flags: 64`/`.catch()` seperti pola yang ada.

---

## Phase 3 — Autoplay & musik (P0/P1)

### 3.1 [P0] Buang dead code cabang Spotify autoplay — H2

**File:** `src/utils/autoplay.js`

`getRecommendations` tidak ada di ekspor `spotify.js:596`. Seluruh blok Spotify adalah dead code yang membakar `Promise.race` + timer 5 detik tiap autoplay track Spotify. Hapus:

- `fetchFromSpotify` (baris 33-60)
- Blok `hasSpotifyConfig() && isSpotifySource(...)` (baris 136-154), ganti dengan komentar singkat bahwa hanya YouTube yang dipakai.

Kode di sekitar yang berubah:
```js
  // Try Spotify first
  let track = null;
  let source = null;

  if (hasSpotifyConfig() && isSpotifySource(currentTrack)) {
    try {
      ...
    } catch (err) {
      ...
    }
  }
```

Ganti dengan:
```js
  // Autoplay hanya via YouTube (getRecommendations Spotify belum ada di utils/spotify.js).
  let track = null;
  let source = null;
```

Juga hapus `fetchFromSpotify` dan `hasSpotifyConfig`/`isSpotifySource` yang jadi tak terpakai (cek pemakaian `isSpotifySource` — hanya di blok itu, jadi aman dihapus).

**Verifikasi:** putar track Spotify, aktifkan autoplay, track habis → track berikutnya tetap ditambah via YouTube. Log `[autoplay] fetch from youtube` muncul langsung tanpa `[autoplay] fetch from spotify` sebelumnya.

---

### 3.2 [P0] Notifikasi autoplay: `player.textChannel` → `player.textId` — M3

**File:** `src/utils/autoplay.js:204-212`

`KazagumoPlayer` tidak punya `textChannel`; yang benar `textId` (string). Flag `_notifiedThisSession.add` sekarang di-set sebelum guard, jadi notifikasi tidak pernah terkirim dan permanent mati.

Tambahkan parameter `client` ke `fetchRelated` (dipanggil dari `events.js:165` yang sudah punya `client`), lalu:

Kode lama:
```js
  // One-time notify per session
  if (!_notifiedThisSession.has(guildId)) {
    _notifiedThisSession.add(guildId);
    const channel = player.textChannel;
    if (channel) {
      channel.send(`🎵 **Autoplay started** — adding related tracks based on "${currentTrack.title}"`).catch(err => {
        logger.warn(`[autoplay] failed to send notify: ${err.message}`);
      });
    }
  }
```

Kode baru:
```js
  // One-time notify per session (set flag HANYA setelah berhasil kirim)
  if (!_notifiedThisSession.has(guildId) && player.textId) {
    const ch = await client.channels.fetch(player.textId).catch(() => null);
    if (ch) {
      const ok = await ch
        .send(`🎵 **Autoplay started** — adding related tracks based on "${currentTrack.title}"`)
        .then(() => true)
        .catch(err => {
          logger.warn(`[autoplay] failed to send notify: ${err.message}`);
          return false;
        });
      if (ok) _notifiedThisSession.add(guildId);
    }
  }
```

**Verifikasi:** autoplay on → cek chat channel tempat panel, harus muncul pesan "Autoplay started" sekali per sesi, bukan zero kali.

---

### 3.3 [P0] Dedup autoplay terhadap history — M4

**File:** `src/utils/autoplay.js` (`fetchFromYouTube`, baris ~89)

Radio mix YouTube stabil untuk seed yang sama → lagu sama bisa terpilih ulang dalam beberapa track. Filter terhadap 20 riwayat terakhir yang sudah disimpan `history.js`.

Kode lama:
```js
  const topPicks = result.tracks.slice(0, 5);
  const pick = topPicks[Math.floor(Math.random() * topPicks.length)];
```

Kode baru:
```js
  const { getHistory } = require('../commands/history');
  const seen = new Set(getHistory(player.guildId).map(h => h.uri).filter(Boolean));
  const topPicks = result.tracks.slice(0, 5);
  const fresh = topPicks.filter(t => !seen.has(t.uri));
  const pool = fresh.length ? fresh : topPicks;
  const pick = pool[Math.floor(Math.random() * pool.length)];
```

Cek dulu apakah `getHistory` diekspor oleh `history.js` (audit menyebut menyimpan 20/guild; pastikan nama ekspornya). Jika belum diekspor, ekspor dulu.

**Verifikasi:** autoplay aktif 10+ track → tidak ada judul yang berulang dalam 20 track terakhir.

---

### 3.4 [P1] Tombol Prev memakai `getPrevious(true)` — H5

**File:** `src/music/panelInteractions.js:184`

`getPrevious()` tanpa argumen tidak mengeluarkan track → tekan Prev dua kali dapat lagu sama selamanya.

Kode lama:
```js
      const prev = player.getPrevious();
```

Kode baru:
```js
      const prev = player.getPrevious(true);
```

Sekalian, blok pemindahan `add + splice(0,0)` bisa disederhanakan:
```js
      } else {
        player.queue.unshift(prev);
        await player.skip();
      }
```
(catatan: pastikan `KazagumoQueue.unshift` ada — audit menyatakan extends Array sehingga mendukungnya. Jika ragu, pertahankan bentuk lama + hanya ubah `getPrevious(true)`.)

**Verifikasi:** putar 3 lagu, tekan Prev 3× berturut → harus mundur maju melalui riwayat, bukan stuck di lagu pertama.

---

### 3.5 [P0] Jaga timer auto-leave saat queue diisi — H8

**File:** `src/music/events.js`

Bad case: playlist besar sedang di-resolve, timer menyala saat `queue.size === 0 && !playing` masih benar → player dihancurkan di tengah pemuatan.

Fix minimal — perketat kondisi timer (baris 39):
```js
          if (player.queue.size === 0 && !player.playing) {
```
→
```js
          if (player.queue.size === 0 && !player.playing && !player.queue.current) {
```

Plus: panggil pembersih timer segera setelah `queue.add` di jalur play (`play.js`, `play-yt.js`, dan select-menu `interactionHandler.js:103`). Ekspor `clearLeaveTimer` dari `events.js` (periksa apakah sudah diekspor), lalu di `interactionHandler.js:103` tambahkan:
```js
          player.queue.add(track);
          clearLeaveTimer(interaction.guildId);
```

**Verifikasi:** muat playlist Spotify 100 lagu besar, matikan 24/7, tunggu >timeout → playlist harusmuat penuh tanpa player dihancurkan.

---

## Phase 4 — Rate limit, cache, penghematan memori (P1)

### 4.1 [P1] Satu instance rate limiter — H6

**File:** `src/utils/rateLimiter.js` — tambah singleton:
```js
const shared = new RateLimiter();
module.exports = { RateLimiter, shared };
```

**File:** `interactionHandler.js:13` dan `messageHandler.js:19`:
```js
const { shared: rateLimiter } = require("../utils/rateLimiter");
```
hapus dua `new RateLimiter()`.

### 4.2 [P1] Rate limiter jangan hitung interaksi komponen — H7

**File:** `src/handlers/interactionHandler.js`

Pindahkan cek rate limit dari baris 19-27 ke bawah, setelah cabang button/modal/select, hanya untuk chat-input:

Kode setelah move:
```js
      // Slash commands
      if (!interaction.isChatInputCommand()) return;

      const { limited, retryAfterMs } = rateLimiter.check(interaction.user.id);
      if (limited && !isAdmin(interaction)) {
        const secs = Math.ceil(retryAfterMs / 1000);
        return interaction.reply({
          content: `⏳ Terlalu cepat! Tunggu **${secs} detik** lagi.`,
          flags: 64,
        }).catch(() => null);
      }
```

hapus blok lama di puncak. Ini membuat tombol panel tidak kena throttle.

**Verifikasi:** tekan tombol panel 5× dalam 5 detik → tidak boleh muncul "Terlalu cepat!". Tapi `/play` 4× dalam 5 detik → tetap kena throttle.

### 4.3 [P1] `makeCache` + `sweepers` — M1

**File:** `src/index.js`

```js
const { Client, GatewayIntentBits, Partials, ActivityType, Options } = require("discord.js");
...
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
  allowedMentions: { parse: [], repliedUser: true },
  makeCache: Options.cacheWithLimits({
    MessageManager: 50,      // bot tak pernah baca pesan historis
    GuildMemberManager: 200,
    UserManager: 200,
  }),
  sweepers: {
    ...Options.DefaultSweeperSettings,
    messages: { interval: 3600, lifetime: 1800 },
    users: { interval: 3600, lifetime: 1800 },
  },
});
```

`MessageManager: 50` aman karena bot hanya membaca pesan saat itu (messageCreate live), tidak pernah dari cache historis.

**Verifikasi:** pantau `process.memoryUsage().heapUsed` selama bot jalan 1 jam di guild dengan aktivitas sedang → harus stabil, bukan tumbuh linear.

---

## Phase 5 — Panel, lyrics, format (P1)

### 5.1 [P1] Debounce `updatePanel` — M6

**File:** `src/utils/spotify.js` (baris 319, 583) dan `src/music/panel.js`

Buat helper debounce per guild di `panel.js` dan ekspor:

```js
const _pending = new Map(); // guildId -> timer

function schedulePanelUpdate(client, guildId, ms = 2000) {
  if (_pending.has(guildId)) return;
  _pending.set(guildId, setTimeout(() => {
    _pending.delete(guildId);
    updatePanel(client, guildId).catch(() => {});
  }, ms));
}
```

- Ganti kedua panggilan `await updatePanel(...)` di `spotify.js` dengan `schedulePanelUpdate(client, guildId)` (tanpa `await`).
- Di `events.js`, pada `playerEnd`/`playerEmpty` pakai `schedulePanelUpdate`; pertahankan `updatePanel` langsung untuk tombol panel (responsivitas user).
- Hapus timer saat `playerDestroy` (panggil `clearLeaveTimer` juga membersihkan `_pending` untuk guild itu, atau buat `clearScheduledPanelUpdate(guildId)`).

**Verifikasi:** load 100-track playlist → amati jumlah REST edit pesan (via log/DevTools Network) turun dari ~50 jadi ~3-4.

### 5.2 [P1] Batasi lyrics fetch dengan `AbortSignal.timeout` — M5

**File:** `src/commands/lyrics.js:54`, `src/music/panelInteractions.js:122`

```js
const res = await fetch(`https://lrclib.net/api/search?q=${encoded}`, {
  signal: AbortSignal.timeout(8000),
});
```

(dua situs, sambil mengekstrak logika lyrics ke `src/utils/lyrics.js` bila mau menghapus ~35 baris duplikat.)

**Verifikasi:** set proxy tidak jalan, jalankan `/lyrics` → harus selesai dalam ~8 detik dengan error yang jelas, bukan gantung.

### 5.3 [P1] Panel error 10008: clear stored IDs — M7

**File:** `src/music/panel.js:170-179`

Saat `messages.fetch` gagal dengan 10008 (pesan dihapus user), saat ini ia terus gagal tiap event. Fix:

```js
    }).catch(async (err) => {
      if (err?.code === 10008) {
        setGuildSettings(guildId, { panelChannelId: null, panelMessageId: null });
        log.debug(`Panel message deleted by user, cleared for guild ${guildId}`);
      } else {
        log.warn("updatePanel fetch failed:", err?.message || err);
      }
    });
```

**Verifikasi:** delete pesan panel manual → event berikutnya tidak lagi mencoba fetch pesan mati.

---

## Phase 6 — Persistensi & inisialisasi (P1/P2)

### 6.1 [P1] Validasi `DISCORD_TOKEN`/`CLIENT_ID` saat boot — M2

**File:** `src/config.js:12-13`

```js
  discord: {
    token: required("DISCORD_TOKEN"),
    clientId: required("CLIENT_ID"),
    guildId: process.env.GUILD_ID || null,
    ownerId: process.env.OWNER_ID || null
  },
```

(Urutan hati-hati: `LAVALINK_*` divalidasi dulu di baris 17-23 pada module-load. Jika mau prioritas Discord dulu, pindahkan block LAVALINK setelah block Discord — atau biarkan, error tetap jelas.)

**Verifikasi:** hapus sementara `DISCORD_TOKEN` → `npm start` harus mati dengan "Missing required env var: DISCORD_TOKEN".

### 6.2 [P1] Session GC untuk `_chatSessions` — M8

**File:** `src/commands/chat.js`

Lazy TTL hanya berjalan saat user yang sama chat lagi; user yang chat sekali lalu berhenti meninggalkan sesi (sampai 40 pesan) permanen. Solusi bersih: jadikan `_chatSessions` Map level modul, lalu pasang interval GC di module scope.

Kode lama (`_getSession`, baris 70-79), dari `client._chatSessions` menjadi Map modul:
```js
const _chatSessions = new Map(); // userId -> { messages, lastActive, personality }

function _getSession(client, userId) {
  const now = Date.now();
  const existing = _chatSessions.get(userId);
  if (existing && now - existing.lastActive < SESSION_TTL_MS) return existing;
  const fresh = { messages: [], lastActive: now, personality: null };
  _chatSessions.set(userId, fresh);
  return fresh;
}

// GC: hapus sesi yang lewat TTL tiap 5 menit (unref agar tak menahan proses)
setInterval(() => {
  const now = Date.now();
  for (const [uid, s] of _chatSessions) {
    if (now - s.lastActive >= SESSION_TTL_MS) _chatSessions.delete(uid);
  }
}, 5 * 60 * 1000).unref();
```

Seluruh pemanggilan `client._chatSessions.xxx` yang lain di file ini (jika ada untuk `/chat` stats/reset) perlu diarahkan ke `_chatSessions` modul. Cek dengan grep `_chatSessions` sebelum mengganti.

**Verifikasi:** user chat sekali lalu berhenti → setelah >10 menit, `_chatSessions.size` = 0 (bisa cek lewat log satu-liner saat interval jalan).

### 6.3 [P2] Hapus guild settings saat bot di-kick — M4

**File:** `src/index.js` + `src/utils/storage.js`

`storage.js`, tambah:
```js
function deleteGuildSettings(guildId) {
  _loadCache();
  if (!_cache[guildId]) return;
  delete _cache[guildId];
  _scheduleSave();
}
```
ekspor. `index.js`:
```js
client.on("guildDelete", (guild) => {
  deleteGuildSettings(guild.id);
  // TODO: destroy player untuk guild ini (cek player.js apakah perlu)
});
```

**Verifikasi:** kick bot dari test guild → `guildSettings.json` entri guild hilang.

---

## Phase 7 — Prefix parser & adapters (P2)

### 7.1 [P2] `PREFIX_ALIASES` null-prototype — H4-latent

**File:** `src/config/prefixAliases.js:155` — kode yang membangun tabel:
```js
const PREFIX_ALIASES = Object.assign(Object.create(null), {
```
(ganti `{` pembuka yang sekarang jadi `Object.assign(Object.create(null), {` lalu tutup `});`.)

**Verifikasi:** `.constructor` → tetap `if (!mapping) return` tanpa crash; tidak ada `Object` yang ter-resolve sebagai command.

### 7.2 [P2] `PrefixOptions` getters `required` — M11

**File:** `src/adapters/PrefixOptions.js:74-104`

`getUser/getRole/getChannel` mengabaikan argumen `required`. Samakan dengan `getString` dll.:

```js
  getRole(name, required = false) {
    const val = this._store[name];
    if (!val) {
      if (required) throw new Error(`Missing required option: ${name}`);
      return null;
    }
    const match = String(val).match(/^<@&(\d+)>$/);
    if (!match) {
      if (required) throw new Error(`Invalid role: ${val}`);
      return null;
    }
    return { id: match[1], toString: () => val };
  }
```
(pola sama untuk `getUser`, `getChannel`.)

### 7.3 [P2] `PrefixContext.deferReply` hormati `options` — M12

**File:** `src/adapters/PrefixContext.js:67-76`

```js
  async deferReply(options = {}) {
    const content = options.placeholder || "_Loading..._";
    const placeholder = await this._message.reply({ content }).catch(() => null);
    if (placeholder) {
      this._deferred = true;
      this._deferredMessage = placeholder;
    }
    return placeholder;
  }
```
Hanya tandai `_deferred` bila sukses (agar `followUp` vs `reply` pilihan benar).

---

## Phase 8 — Degradasi UI & pembersihan (P2)

### 8.1 [P2] `skipto` baca target setelah `skip()` — M10

**File:** `src/commands/skipto.js:36-42`

Kode lama:
```js
    const target = getUpcomingTracks(player)[0];
    await player.skip();
```

Kode baru:
```js
    await player.skip();
    const target = getCurrentTrack(player);
```
plus import `getCurrentTrack`. (Catatan: masih ada masalah `loop === "queue"` di mana skip mengembalikan track ke ekor — nilai ini belum ditangani di plan karena butuh keputusan UX; saran: set `loop` ke `"none"` sebelum splice bila diinginkan. Validasi dulu dengan test.)

**Verifikasi:** `/skipto 1`, `/skipto 3` → judul yang dilaporkan = judul yang benar-benar diputar.

### 8.2 [P2] `help.js` truncate 900 → 700 — M13

**File:** `src/commands/help.js:402`
```js
      `**Penjelasan:** ${truncate(c.detail, 700)}\n` +
```

**Verifikasi:** render semua halaman `/help all` → tidak ada field > 1024 char, tidak ada `Invalid Form Body`.

### 8.3 [P2] `formatMs` aman dari NaN — LOW-14

**File:** `src/utils/format.js`
```js
function formatMs(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
```
(rest tetap.)

### 8.4 [P2] Hapus dead code — L1/L3 audit

- `aiLimits.js:48-52` — `_loadWindows` empty function + komentar yang saling bertentangan → hapus.
- `search.js:82` — cache `_searchCache` dengan timer yang saling menimpa: akhir-akhir ini ada `setTimeout` yang tidak menimpa yang lama. Sederhanakan dengan menyimpan timer dan `clearTimeout` saat overwrite (lihat M15/M16 audit, atau FIX kompak).
- `play.js:67-68` — `totalTracks`/`processedTracks` dead → hapus.
- `events.js:57-62` — `escapeMarkdown` tak terpakai → hapus, atau terapkan ke `author` di `buildStartedPlayingEmbed`.

---

## Lampiran: peta verifikasi per phase

| Phase | Apa yang terjadi di test | Cara lihat hasil |
|---|---|---|
| P1 | `/djrole set` ditolak non-admin; restart dalam 1 detik mempertahankan `controlMode`; Lavalink mati tak membunuh bot | log, `guildSettings.json` |
| P2 | `lastUpdated` naik; prompt token untuk chat panjang datar; kena 401 tidak bakar fallback; `@everyone` tidak ping | `aiTokenUsage.json`, log |
| P3 | Autoplay jalan via YouTube, notifikasi muncul sekali, tidak ada duplikat; Prev mundur; load playlist besar tidak mati | log, chat, 20 track history |
| P4 | 5 klik panel dalam 5 detik tidak dithrottle; `/play` tetap; heap stabil | log, DevTools/`process.memoryUsage` |
| P5 | 100-track → ~3 edit panel; `/lyrics` timeout 8 detik; panel dihapus → clear | Network tab, log |
| P6 | startup tanpa token error jelas; session chat GC 10 menit; kick bot → JSON bersih | log, `guildSettings.json` |
| P7 | `.constructor` aman; `.dj set salahformat` error rapi; `.access view` tidak bocor | test manual |
| P8 | `/skipto` judul akurat; `/help all` tidak error; format NaN aman | test manual |

---

## Catatan sinkronisasi

- Phase 1 dan 3 menyentuh `interactionHandler.js` (rate limit di P4 juga) — kerjakan P4 setelah P1 supaya tidak konflik edit yang sama.
- `storage.js` disentuh di 1.2 dan 6.3 — kerjakan dalam satu commit bila memungkinkan.
- `events.js` disentuh di 3.5 dan 5.1 — satukan.
- Sebelum mulai, jalankan `git status` untuk memastikan working tree bersih, dan commit per phase dengan pesan `fix(audit): <ringkas>`.

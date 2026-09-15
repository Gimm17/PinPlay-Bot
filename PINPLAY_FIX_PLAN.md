# PinPlay Fix Plan — 2026-09-13

Prinsip: patch terkecil yang bisa dirawat. Tidak ada rewrite, tidak ada perubahan fitur/UI
(guide Rule 1-2). Semua perubahan menjaga perilaku lama; fallback hanya aktif saat YouTube gagal.

---

## Perubahan

### 1. Config VPS (bukan repo): LavaSrc providers — tambah SoundCloud

**File:** `/root/PinPlay-Lavalink/application.yml`

```yaml
# Lama
lavasrc:
  providers:
    - 'ytsearch:"%ISRC%"'
    - "ytsearch:%QUERY%"

# Baru
lavasrc:
  providers:
    - 'ytsearch:"%ISRC%"'
    - "ytsearch:%QUERY%"
    - "scsearch:%QUERY%"
```

**Alasan:** resolusi Spotify (track/album/playlist via LavaSrc) jatuh ke provider berikutnya
saat `ytsearch` gagal/rate-limited. SoundCloud terbukti streaming dari IP VPS ini.
**Risk:** rendah — LavaSrc mencoba provider berurutan; `scsearch` hanya disentuh kalau
`ytsearch` tidak menghasilkan track.
**Rollback:** hapus baris `scsearch`.

### 2. Code: fallback YouTube → SoundCloud di level playerException

**File:** `src/music/events.js` (handler `playerException` yang sudah ada)

Saat exception mengandung pola kegagalan YouTube (`All clients failed`, `requires login`,
`Sign in to confirm`) dan track berasal dari source youtube → cari ulang di SoundCloud
(`scsearch:<title> <author>`), queue-kan, skip track yang mati.

Sketsa perilaku (detail di patch):

```js
kazagumo.on("playerException", async (player, data) => {
  const msg = data?.exception?.message || "";
  const isSourceFailure = /All clients failed|requires login|Sign in to confirm|Video player configuration/i.test(msg);
  if (!isSourceFailure || player.__scFallback) { ...jalur lama...; return; }
  const cur = player.queue.current; // track yang gagal (masih "current" saat exception)
  if (!cur || (cur.sourceName || "").toLowerCase().includes("youtube")) { ...jalur lama...; return; }
  player.__scFallback = true;               // anti-loop: 1 fallback per guild per saat
  try {
    const q = `${cur.title} ${cur.author || ""}`.trim();
    const res = await client.kazagumo.search(q, { requester: cur.requester, engine: "soundcloud" });
    const t = res?.tracks?.[0];
    if (t) {
      player.queue.add(t);      // queue.add patched → clearLeaveTimer otomatis
      await player.skip();
      // info embed kecil: "fallback ke SoundCloud"
    }
  } catch { /* biarkan jalur lama yang menangani */ }
  finally { setTimeout(() => (player.__scFallback = false), 10_000); }
});
```

**Alasan:** menutup kasus YouTube URL langsung (link YouTube dari user tidak bisa diarahkan
ke scsearch LavaSrc — hanya metadata-yang-dicari-_ulang_ di SoundCloud). Ini satu-satunya
cara menjalankan link YouTube tanpa proxy/IP residensial.
**Risk:** sedang — hasil SoundCloud bisa beda versi (live/remix). Mitigasi: ambil track[0],
batasi 1 fallback/10s/guild, jangan fallback kalau source track sudah soundcloud.
**Rollback:** revert handler ke versi lama (log + updatePanel saja).

### 3. Code: permukaan exception diperjelas (diagnostik permanen, guide §12)

**File:** `src/music/events.js` — handler `playerException` yang sudah ada

- Log sekali baris: guild, judul track, source, pesan exception (sudah ada sebagian).
- Kirim embed error singkat ke `player.textId` SEKALI per kegagalan beruntun agar user tidak
  bingung "panel jalan tapi tidak bunyi".

**Risk:** rendah. **Rollback:** hapus blok embed.

---

## yang sengaja TIDAK dilakukan sekarang

- **Proxy residensial** (butuh biaya + keputusan owner) — jalur paling ampuh untuk YouTube
  asli dari datacenter. Upgrade path config-only (`plugins.youtube.httpConfig.proxyHost`).
- **Rotasi client/YouTube plugin upgrade** — 1.18.2 sudah terbaru; TVHTML5 bug upstream.
- **Refactor resolver abstraction** (`src/music/resolvers/`) — guide Rule 6: refactor hanya
  setelah playback minimal pass; fallback sengaja ditaruh di events.js agar diff kecil.
- **Deafen `deaf:true`** dibiarkan — deafen hanya mematikan *input* bot, tidak audio output.

---

## Validasi (setelah patch, urutan)

| # | Test | Cara | Harapan |
|---|---|---|---|
| 1 | Restart + WS stabil | `pm2 restart lavalink pinplay`, log 60s | tidak ada re-register cycle |
| 2 | SoundCloud search | test script SC | playerStart, position naik |
| 3 | YouTube link langsung | `/play <yt url>` | embed NOW PLAYING → fallback → lanjut dari SC, position naik |
| 4 | YouTube search | `/play <judul>` | sama dengan #3 |
| 5 | Spotify track | `/play <spotify track url>` | resolve → ytsearch gagal → scsearch provider → play |
| 6 | Spotify playlist | `/play <spotify playlist url>` | playlist termuat, track pertama play, sisanya antre |
| 7 | `/play-yt` | `/play-yt <judul>` | perilaku lama (yt-only) tetap ada; kalau kena blok → fallback sama |
| 8 | Kontrol queue | skip/pause/resume/volume | tidak berubah |
| 9 | 24/7 | enable → restart bot | restore jalan |
| 10 | Konfirmasi telinga | owner join VC | audio terdengar (wajib, guide §29E) |

## Rollback keseluruhan

- Code: `git revert <commit>` pada repo PinPlay.
- Config VPS: `cp /root/PinPlay-Lavalink/application.yml.bak-oauth /root/PinPlay-Lavalink/application.yml && pm2 restart lavalink`.

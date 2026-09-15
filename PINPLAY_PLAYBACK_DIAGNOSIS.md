# PinPlay Playback Diagnosis — 2026-09-13

Metode: eksekusi kode nyata di VPS (bukan pembacaan statis). Test harness: standalone script
(discord.js + Kazagumo/Shoukaku sendiri) join voice channel asli `tempvoice`
(1421731652387999835) di guild `723885708527403121`, mainkan track, sample `player.position`.

## Versi runtime aktual (guide §9)

| Component | Claim (package.json) | Lockfile | Runtime VPS | OK? |
|---|---|---|---|---|
| Node.js | >=18 | — | v20.20.2 | ✅ |
| discord.js | ^14.16.3 | 14.25.1 | 14.25.1 | ✅ |
| Kazagumo | ^3.4.3 | 3.4.3 | 3.4.3 | ✅ |
| Shoukaku | ^4.3.0 | 4.3.0 | 4.3.0 | ✅ |
| Java | — | — | 17.0.20 | ✅ |
| **Lavalink** | — | — | **4.2.2** | ✅ **>= 4.2.0 (DAVE)** |
| LavaSrc | — | — | 4.8.3 | ✅ |
| youtube-plugin | — | — | 1.18.2 (latest) | ✅ |

## DAVE / voice transport (guide §10) — SEMUA PASS

- Lavalink 4.2.2 ≥ 4.2.0 (DAVE-capable) ✅
- Shoukaku 4.3.0 mengirim `voice.channelId` di payload voiceUpdate ✅ (diverifikasi `node_modules/shoukaku/dist/index.js:516`)
- `AllowedPackets = [VOICE_STATE_UPDATE, VOICE_SERVER_UPDATE]` di-forward ✅
- Test live: `GATEWAY VOICE_STATE_UPDATE` + `GATEWAY VOICE_SERVER_UPDATE` diterima, Lavalink
  menerima token+endpoint+sessionId ✅

Kesimpulan: **voice transport TIDAK bermasalah** (setelah fix watchdog `1f3edb7`).

## Test matrix (guide §11 + §20)

| # | Source | Resolve | TrackStart | Position advances | Audible path | Hasil |
|---|---|---:|---:|---:|---:|---|
| B | SoundCloud search | ✅ | ✅ | ✅ 0→4.7s | ✅ | **OK — streaming nyata** |
| B' | SoundCloud ×2 repeat | ✅ | ✅ | ✅ | ✅ | konsisten |
| D | YouTube search | ✅ | ✅ | ❌ stuck 0ms | ❌ | **playerException ≈1s setelah start** |
| YouTube direct URL | ✅ search | — | — | ❌ | AllClientsFailedException |
| Spotify (turunan) | — | — | — | ❌ | resolve via `ytsearch` → kena blokir YouTube yang sama |

## Root cause

### 1. YouTube memblokir playback dari IP datacenter Linode (P0)

Semua 6 client youtube-plugin gagal memuat format audio:

```
Client [TVHTML5_SIMPLY] failed: Sign in to confirm you're not a bot
Client [TVHTML5] failed: The page needs to be reloaded.
Client [WEB] failed: This video requires login.
Client [MWEB] failed: This video requires login.
Client [WEB_EMBEDDED_PLAYER] failed: Video player configuration error
Client [ANDROID_VR] failed: This video requires login.
```

OAuth **terkirim dan valid** (diverifikasi di DEBUG log: `Using oauth authorization header with
value "Bearer ya29..."` pada request TVHTML5/SIMPLY). Token bukan masalahnya — YouTube menilai
reputasi IP-nya. TVHTML5 "page needs to be reloaded" adalah bug upstream terbuka
(youtube-source #226, tanpa fix per 2026-09-13).

### 2. Mengapa symptom-nya "track kebaca tapi gada suara"

Urutan event yang direproduksi (Test D):

```
playerStart  ← bot kirim embed "NOW PLAYING" (embed muncul = track "kebaca")
position=0ms 1 detik
playerException "All clients failed to load the item"  ← audio tidak pernah streaming
playerEnd
```

`playerStart` fire sebelum format audio berhasil dimuat. UI kelihatan normal; audio mati
~1 detik kemudian.

### 3. Spotify "unreliable" = korban yang sama

Config LavaSrc:
```yaml
lavasrc:
  providers:
    - 'ytsearch:"%ISRC%"'
    - "ytsearch:%QUERY%"
```
Semua resolusi Spotify jatuh ke `ytsearch` → kena blokir YouTube yang sama. Spotify hanyalah
sumber metadata (guide §5/§16); audio selalu dari YouTube. Tidak ada fallback source lain
yang dikonfigurasi.

### 4. Masalah historis yang SUDAH diperbaiki (bukan lagi root cause)

- Watchdog force-cycle node (`1f3edb7`, 2026-09-12): `removeNode+addNode` tiap 30s saat
  `state !== 1` mematikan session player → dulu penyebab "semua source silent". Sekarang
  watchdog hanya re-register saat node hilang dari Map.
- OAuth device-code flow selesai; `refreshToken` persist di `application.yml`
  (+ `skipInitialization: true`) — polling 400 berhenti.

## Bukti sebelum/sesudah (guide §29E)

**Before ( YouTube dari VPS):**
```
EVENT playerStart "The Weeknd - Blinding Lights (Official Video)"
EVENT playerException :: (yts.version: 1.18.2) All clients failed to load the item.
EVENT playerEnd
POS[t+3s] state=idle position=0ms        ← silence
```

**After (SoundCloud dari VPS, voice asli):**
```
EVENT playerStart "The Weeknd - Blinding Lights full"
POS[t+6s] state=playing position=4320ms  ← posisi berjalan = audio streaming
POS[t+9s] state=playing position=4320ms  ← (cache Lavalink update interval)
```

Catatan jujur (guide §29E): "audible" di sini = position advances + state playing + tidak ada
exception, dari voice channel Discord nyata. Konfirmasi telinga manusia masih perlu dilakukan
oleh owner (join tempvoice saat test diulang).

## Yang TIDAK menjadi masalah

- Kazagumo/Shoukaku/discord.js versions — semua current dan kompatibel
- UDP/firewall — Lavalink connect Discord voice sukses (position berjalan di SoundCloud)
- Volume/mute — volume 60/50, bukan 0; `deaf:true` hanya deafen (bot tetap kirim audio)
- Rate limiter/panel/queue — tidak menyentuh jalur audio

## Sumber eksternal

- https://github.com/lavalink-devs/youtube-source/issues/226 (TVHTML5 "page needs to be reloaded", open)
- https://github.com/lavalink-devs/youtube-source/releases (1.18.2 = terbaru)

<div align="center">

# 📖 PinPlay — Panduan Lengkap
**Dari setup awal hingga pemakaian sehari-hari**

</div>

---

# BAGIAN 1 — TEKNIS (Setup & Menjalankan Bot)

Bagian ini ditujukan untuk **developer** atau siapa saja yang ingin menjalankan PinPlay dari source code.

---

## 1.1 Apa Saja yang Dipersiapkan?

Sebelum mulai, pastikan semua persyaratan ini sudah terpenuhi di komputer kamu:

| # | Kebutuhan | Versi Minimum | Keterangan | Link Download |
|---|---|---|---|---|
| 1 | **Node.js** | v18.0+ | Runtime untuk menjalankan bot | [nodejs.org](https://nodejs.org/) |
| 2 | **Java (JDK/JRE)** | v17+ | Dibutuhkan oleh Lavalink | [oracle.com](https://www.oracle.com/java/technologies/javase/jdk17-archive-downloads.html) |
| 3 | **Git** | Any | Opsional, untuk clone repository | [git-scm.com](https://git-scm.com/) |
| 4 | **Text Editor** | Any | Untuk edit file `.env` | VS Code, Notepad++, dll |
| 5 | **Akun Discord** | — | Untuk membuat bot di Developer Portal | [discord.com](https://discord.com/) |

### Cek Versi di Terminal
```bash
node -v     # Harus >= v18.0.0
java -version   # Harus >= 17
```

---

## 1.2 Membuat Bot di Discord Developer Portal

Ini adalah langkah paling pertama — membuat "identitas" bot kamu di Discord.

### Langkah 1: Buat Application
1. Buka [Discord Developer Portal](https://discord.com/developers/applications)
2. Klik tombol **"New Application"** (kanan atas)
3. Beri nama (contoh: `PinPlay`) → klik **"Create"**
4. Kamu akan masuk ke halaman **General Information**
5. **Catat `APPLICATION ID`** — ini adalah `CLIENT_ID` yang kamu butuhkan nanti

### Langkah 2: Buat Bot User
1. Di menu sebelah kiri, klik **"Bot"**
2. Klik **"Reset Token"** → konfirmasi → **COPY TOKEN YANG MUNCUL**
   
   > ⚠️ **PENTING:** Token ini hanya muncul SEKALI. Simpan di tempat aman. Jangan share ke siapapun. Jika hilang, kamu harus reset lagi.

3. Di halaman yang sama, scroll ke bawah:
   - **PUBLIC BOT**: Aktifkan jika ingin orang lain bisa invite bot kamu
   - **Privileged Gateway Intents**: 
     - ✅ **SERVER MEMBERS INTENT** — Opsional
     - ✅ **MESSAGE CONTENT INTENT** — Opsional (PinPlay pakai slash command, bukan prefix)

### Langkah 3: Dapatkan Token & Client ID
Setelah langkah di atas, kamu punya 2 hal penting:

| Data | Dimana Mendapatkannya | Contoh |
|---|---|---|
| `DISCORD_TOKEN` | Halaman Bot → Reset Token | `MTQ1NzQw...` (panjang) |
| `CLIENT_ID` | Halaman General Information → Application ID | `1457409665183907983` |

---

## 1.3 Invite Bot ke Server Discord

Bot yang sudah dibuat belum ada di server mana pun. Kamu perlu membuat **link invite** agar bot bisa masuk.

### Cara Membuat Link Invite

1. Di Developer Portal, buka menu **"OAuth2"** → **"URL Generator"**
2. Di bagian **SCOPES**, centang:
   - ✅ `bot`
   - ✅ `applications.commands`
3. Di bagian **BOT PERMISSIONS**, centang:
   - ✅ `Send Messages`
   - ✅ `Embed Links`
   - ✅ `Read Message History`
   - ✅ `Connect` (Voice)
   - ✅ `Speak` (Voice)
   - ✅ `Use Slash Commands`
   
   Atau untuk kemudahan, centang **Administrator** (memberi semua permission).

4. **Copy URL yang dihasilkan** di bagian bawah halaman
5. Buka URL tersebut di browser → pilih server tujuan → **Authorize**

### Contoh Format Link
```
https://discord.com/api/oauth2/authorize?client_id=CLIENT_ID_KAMU&permissions=8&scope=bot%20applications.commands
```
Ganti `CLIENT_ID_KAMU` dengan Application ID kamu.

---

## 1.4 Setup Lavalink Server

Lavalink adalah server audio terpisah yang bertugas memproses dan streaming musik. Bot **tidak bisa memutar musik tanpa Lavalink**.

### Langkah 1: Download Lavalink
1. Buka [GitHub Lavalink Releases](https://github.com/lavalink-devs/Lavalink/releases)
2. Download file `Lavalink.jar` dari versi terbaru (v4.x)
3. Buat folder baru, misal: `C:\LavalinkServer\`
4. Letakkan `Lavalink.jar` di folder tersebut

### Langkah 2: Buat File Konfigurasi
Di folder yang sama dengan `Lavalink.jar`, buat file bernama `application.yml` dengan isi berikut:

```yaml
server:
  port: 2333
  address: 0.0.0.0

lavalink:
  server:
    password: "youshallnotpass"
    sources:
      youtube: true
      soundcloud: true
      bandcamp: true
      twitch: true
      http: true
      local: false

    # Plugin untuk Spotify, Apple Music, Deezer
    plugins:
      - dependency: "com.github.topi314.lavasrc:lavasrc-plugin:4.0.1"
        repository: "https://maven.lavalink.dev/releases"
      - dependency: "dev.lavalink.youtube:youtube-plugin:1.5.2"
        repository: "https://maven.lavalink.dev/releases"

plugins:
  lavasrc:
    providers:
      - "ytsearch:\"%ISRC%\""
      - "ytsearch:%QUERY%"
    sources:
      spotify: true
      applemusic: false
      deezer: false
    spotify:
      clientId: "SPOTIFY_CLIENT_ID_OPSIONAL"
      clientSecret: "SPOTIFY_CLIENT_SECRET_OPSIONAL"
      countryCode: "ID"
```

> 💡 **Tips:** Jika tidak butuh Spotify, bisa hapus bagian `plugins` dan `lavasrc`. Bot tetap bisa memutar dari YouTube.

### Langkah 3: Jalankan Lavalink
```bash
cd C:\LavalinkServer
java -jar Lavalink.jar
```

Jika berhasil, kamu akan melihat:
```
[main] INFO  lavalink.server.Launcher - Starting Lavalink
...
[main] INFO  lavalink.server.Launcher - Lavalink is ready to accept connections.
```

> ⚠️ **Biarkan terminal ini tetap terbuka.** Lavalink harus jalan terus selama bot aktif.

### Struktur Folder Lavalink
```
LavalinkServer/
├── Lavalink.jar
├── application.yml
└── plugins/          ← otomatis dibuat saat Lavalink download plugin
```

---

## 1.5 Setup & Menjalankan PinPlay Bot

### Langkah 1: Clone / Download Project
```bash
git clone https://github.com/USERNAME/PinPlay.git
cd PinPlay
```
Atau download ZIP dan extract.

### Langkah 2: Install Dependencies
```bash
npm install
```

### Langkah 3: Konfigurasi Environment
```bash
# Copy template .env
cp .env.example .env
```

Buka file `.env` dan isi data berikut:

```env
# ==================== Discord ====================
DISCORD_TOKEN=PASTE_TOKEN_BOT_KAMU_DISINI
CLIENT_ID=PASTE_CLIENT_ID_KAMU_DISINI

# Optional: untuk test di 1 server (command muncul instan)
GUILD_ID=ID_SERVER_TEST_KAMU

# ==================== Lavalink ====================
LAVALINK_NAME=local
LAVALINK_HOST=127.0.0.1
LAVALINK_PORT=2333
LAVALINK_PASSWORD=youshallnotpass
LAVALINK_SECURE=false

# ==================== Optional ====================
DEFAULT_VOLUME=60
LEAVE_TIMEOUT_SEC=120
LOG_LEVEL=info
```

#### Cara Mendapatkan GUILD_ID
1. Buka Discord
2. Pergi ke **Settings → Advanced → Developer Mode → ON**
3. Klik kanan nama server → **"Copy Server ID"**
4. Paste sebagai `GUILD_ID`

### Langkah 4: Deploy Slash Commands
```bash
# Mode Guild (REKOMENDASI saat development — muncul instan)
npm run deploy:guild

# Mode Global (untuk production — butuh waktu sampai 1 jam)
npm run deploy:global
```

### Langkah 5: Jalankan Bot
```bash
npm start
```

Log sukses:
```
[INFO ] ✅ Logged in as PinPlay#1234
[INFO ] ✅ Lavalink node ready: local
```

### Checklist Sebelum Menjalankan
- [ ] Java 17+ terinstall
- [ ] Node.js 18+ terinstall
- [ ] Lavalink server **sudah jalan** di terminal lain
- [ ] File `.env` sudah diisi lengkap (TOKEN, CLIENT_ID)
- [ ] `npm install` sudah dijalankan
- [ ] Slash commands sudah di-deploy (`npm run deploy:guild` atau `deploy:global`)
- [ ] Bot sudah di-invite ke server Discord

### Urutan Menjalankan
```
1. Jalankan Lavalink  →  java -jar Lavalink.jar  (terminal 1)
2. Jalankan PinPlay   →  npm start               (terminal 2)
```

> ❗ **Urutan penting!** Lavalink harus jalan **DULUAN** sebelum bot. Jika bot jalan duluan, bot akan gagal konek ke Lavalink.

---

## 1.6 Struktur Folder Project

```
PinPlay/
├── .env                    ← Konfigurasi rahasia (TOKEN, dll)
├── .env.example            ← Template .env untuk referensi
├── .gitignore
├── package.json
├── README.md
├── GUIDE.md                ← File ini
│
├── data/
│   └── guildSettings.json  ← Data per-server (volume, DJ role, panel, dll)
│
├── scripts/
│   └── deploy-commands.js  ← Script untuk register slash commands
│
└── src/
    ├── index.js            ← Entry point utama bot
    ├── config.js           ← Loader konfigurasi dari .env
    │
    ├── commands/           ← Semua slash commands (1 file = 1 command)
    │   ├── play.js
    │   ├── pause.js
    │   ├── search.js
    │   ├── lyrics.js
    │   └── ... (25 command files)
    │
    ├── handlers/           ← Event & interaction handlers
    │   ├── commandLoader.js
    │   └── interactionHandler.js
    │
    ├── music/              ← Core music logic
    │   ├── kazagumo.js     ← Inisialisasi Lavalink client
    │   ├── events.js       ← Event handler musik (playerStart, playerEnd, dll)
    │   ├── panel.js        ← Builder untuk Music Panel (embed + buttons)
    │   └── panelInteractions.js  ← Handler untuk panel button clicks
    │
    └── utils/              ← Utility modules
        ├── colors.js       ← Warna branded untuk embeds
        ├── format.js       ← Format durasi, progress bar, thumbnail
        ├── logger.js       ← Custom logger dengan level
        ├── permissions.js  ← Sistem akses kontrol (DJ, restricted, dll)
        ├── player.js       ← Helper functions untuk player/queue
        └── storage.js      ← Penyimpanan guild settings (JSON + cache)
```

---

## 1.7 Troubleshooting

### ❌ Bot Online Tapi Command Tidak Muncul
- **Penyebab:** Slash commands belum di-deploy
- **Solusi:** Jalankan `npm run deploy:guild` (instant) atau `npm run deploy:global` (tunggu 1 jam)

### ❌ "No Lavalink node available"
- **Penyebab:** Lavalink server belum jalan atau belum konek
- **Solusi:** Pastikan Lavalink sudah jalan di terminal lain. Cek host/port/password di `.env` cocok dengan `application.yml`

### ❌ "Missing required env var: DISCORD_TOKEN"
- **Penyebab:** File `.env` belum dibuat atau belum diisi
- **Solusi:** Copy `.env.example` → `.env` dan isi semua field yang required

### ❌ Musik Tidak Keluar Suara
- **Penyebab:** Bot tidak punya permission `Connect` dan `Speak` di voice channel
- **Solusi:** Pastikan bot punya permission voice, atau berikan role Administrator

### ❌ "DiscordAPIError: Unknown interaction"
- **Penyebab:** Bot terlalu lama merespons (> 3 detik)
- **Solusi:** Pastikan koneksi internet stabil. Lavalink yang lambat juga bisa menyebabkan ini.

---
---

# BAGIAN 2 — NON-TEKNIS (Cara Pakai Bot di Server)

Bagian ini ditujukan untuk **user biasa** yang ingin menggunakan PinPlay di server Discord mereka.

---

## 2.1 Quick Start — Mulai dalam 30 Detik

1. **Join Voice Channel** — Masuk ke voice channel mana saja
2. **Ketik `/play`** — Lalu isi judul lagu atau paste link YouTube/Spotify
3. **Selesai!** 🎶 — Bot akan join VC dan mulai memutar musik

```
/play query: Never Gonna Give You Up
/play query: https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT
/play query: https://www.youtube.com/watch?v=dQw4w9WgXcQ
```

---

## 2.2 Music Panel — Kontrol Tanpa Ketik Command

Music Panel adalah fitur **paling direkomendasikan** untuk mengontrol musik. Panel menampilkan lagu yang sedang diputar beserta tombol-tombol kontrol secara visual.

### Cara Membuat Panel
```
/panel action:create
```
Bot akan mengirim sebuah **embed dengan 10 tombol** di channel tempat kamu mengetik command tersebut.

### Tombol-Tombol Panel

**Baris 1:**
| Tombol | Fungsi |
|---|---|
| 🔀 **Shuffle** | Acak urutan queue |
| ⏮️ **Prev** | Putar lagu sebelumnya |
| ⏸️ **Pause** / ▶️ **Resume** | Jeda atau lanjutkan lagu |
| ⏭️ **Next** | Skip ke lagu berikutnya |
| 📜 **Queue** | Lihat daftar antrian lagu |

**Baris 2:**
| Tombol | Fungsi |
|---|---|
| 🔁 **Loop** | Toggle loop: Off → Track → Queue → Off |
| 🔉 **- Vol** | Kurangi volume 10% |
| 🔊 **+ Vol** | Tambah volume 10% |
| ⏹️ **Stop** | Hentikan musik dan bersihkan queue |
| ➕ **Add Song** | Tambah lagu baru (muncul pop-up input) |

### Mengelola Panel
```
/panel action:show       ← Update/refresh panel yang sudah ada
/panel action:remove     ← Hapus panel dari settings
```

> 💡 **Tips:** Buat panel di channel khusus (misal #music-player) supaya tidak tenggelam oleh chat.

---

## 2.3 Daftar Lengkap Semua Command

### 🎵 Command Musik (Semua Orang Bisa Pakai)

| Command | Deskripsi | Contoh |
|---|---|---|
| `/play <query>` | Putar lagu dari judul atau link | `/play query: Blinding Lights` |
| `/search <query>` | Cari lagu, pilih dari 5 hasil | `/search query: Adele Hello` |
| `/nowplaying` | Lihat detail lagu yang sedang diputar | `/nowplaying` |
| `/lyrics [query]` | Tampilkan lirik lagu (otomatis detect lagu saat ini) | `/lyrics` atau `/lyrics query: Bohemian Rhapsody` |
| `/history` | Lihat 15 lagu terakhir yang diputar | `/history` |

### 🎛️ Command Kontrol (Tergantung Setting Akses)

| Command | Deskripsi | Contoh |
|---|---|---|
| `/pause` | Jeda lagu | `/pause` |
| `/resume` | Lanjutkan dari jeda | `/resume` |
| `/skip` | Skip lagu sekarang | `/skip` |
| `/stop` | Stop & bersihkan semua queue | `/stop` |
| `/clear` | Bersihkan queue TANPA stop lagu saat ini | `/clear` |
| `/loop <mode>` | Atur mode loop | `/loop mode:track` |
| `/shuffle` | Acak urutan queue | `/shuffle` |
| `/volume <0-100>` | Atur volume | `/volume value:50` |
| `/seek <detik>` | Loncat ke posisi tertentu | `/seek seconds:90` |
| `/filter <nama>` | Pasang filter audio | `/filter name:bassboost` |
| `/remove <posisi>` | Hapus lagu dari queue | `/remove position:3` |
| `/move <dari> <ke>` | Pindahkan lagu di queue | `/move from:5 to:1` |
| `/skipto <posisi>` | Loncat ke posisi tertentu di queue | `/skipto position:4` |
| `/leave` | Paksa bot keluar dari VC | `/leave` |

### ⚙️ Command Setup (Hanya Admin / Manage Server)

| Command | Deskripsi | Contoh |
|---|---|---|
| `/panel <action>` | Buat/hapus/update Music Panel | `/panel action:create` |
| `/access mode <all\|restricted>` | Atur siapa yang boleh kontrol | `/access mode mode:restricted` |
| `/access allowuser <add\|remove\|list>` | Tambah/hapus user yang diizinkan | `/access allowuser action:add user:@User` |
| `/access allowrole <add\|remove\|list>` | Tambah/hapus role yang diizinkan | `/access allowrole action:add role:@DJ` |
| `/access requestchannel [channel]` | Batasi command musik ke 1 channel | `/access requestchannel channel:#music` |
| `/access view` | Lihat setting akses saat ini | `/access view` |
| `/djrole set <role>` | Set role DJ | `/djrole set role:@DJ` |
| `/djrole view` | Lihat role DJ saat ini | `/djrole view` |
| `/247 enable:<true\|false>` | Mode 24/7 (bot stay di VC) | `/247 enable:true` |
| `/help` | Panduan penggunaan bot | `/help` |

---

## 2.4 Fitur Detail

### 🔁 Mode Loop
Ada 3 mode loop yang bisa dipilih:

| Mode | Perilaku |
|---|---|
| `none` | Loop mati — setelah lagu selesai, lanjut ke berikutnya |
| `track` | Lagu yang sama diputar terus berulang |
| `queue` | Setelah antrian habis, mulai dari awal lagi |

```
/loop mode:track    ← ulang lagu ini terus
/loop mode:queue    ← ulang seluruh playlist
/loop mode:none     ← matikan loop
```

---

### 🎚️ Audio Filter
PinPlay mendukung filter audio real-time:

| Filter | Efek |
|---|---|
| `bassboost` | Bass lebih kuat dan tebal |
| `nightcore` | Tempo lebih cepat, pitch lebih tinggi (anime style) |
| `vaporwave` | Tempo lebih lambat, pitch lebih rendah (aesthetic) |
| `off` | Matikan semua filter |

```
/filter name:nightcore
/filter name:off
```

---

### 🔍 Search vs Play
| `/play` | `/search` |
|---|---|
| Langsung putar hasil pertama | Tampilkan 5 hasil, kamu yang pilih |
| Lebih cepat | Lebih akurat |
| Cocok kalau yakin dengan judul | Cocok kalau judulnya umum/ambigu |

---

### 🎤 Lyrics
Bot bisa menampilkan lirik lagu secara otomatis:

```
/lyrics                          ← otomatis cari lirik lagu yang sedang diputar
/lyrics query:Bohemian Rhapsody  ← cari lirik manual berdasarkan judul
```

Sumber lirik: [lrclib.net](https://lrclib.net/) (gratis, tanpa API key).

---

### 📜 Manajemen Queue
```
/queue              ← lihat antrian (10 per halaman)
/queue page:2       ← lihat halaman ke-2

/remove position:3  ← hapus lagu nomor 3 dari queue
/move from:5 to:1   ← pindahkan lagu #5 ke posisi #1
/skipto position:4   ← loncat langsung ke lagu #4
/clear              ← bersihkan queue (lagu saat ini tetap jalan)
/shuffle            ← acak urutan queue
```

---

### 🕒 Mode 24/7
Kalau mode 24/7 aktif:
- Bot **tidak akan keluar** dari voice channel meskipun queue kosong
- Bot **otomatis rejoin** setelah bot di-restart
- Cocok untuk server yang ingin bot selalu standby

```
/247 enable:true    ← aktifkan
/247 enable:false   ← matikan (bot akan keluar saat idle)
```

> ⚠️ Kamu harus berada di Voice Channel saat mengaktifkan mode ini.

---

## 2.5 Sistem Akses Kontrol

PinPlay punya sistem akses bertingkat untuk mengatur siapa yang boleh mengontrol musik.

### Mode Akses

| Mode | Siapa yang Boleh Kontrol |
|---|---|
| `all` (default) | **Semua orang** yang ada di voice channel yang sama |
| `restricted` | Hanya **Admin**, pemilik **DJ Role**, atau user/role yang sudah di-allow |

### Cara Mengatur

```
# 1. Set mode ke restricted
/access mode mode:restricted

# 2. Set role DJ (opsional)
/djrole set role:@DJ

# 3. Tambah user tertentu (opsional)
/access allowuser action:add user:@User

# 4. Tambah role tertentu (opsional)
/access allowrole action:add role:@Moderator

# 5. Lihat konfigurasi saat ini
/access view
```

### Siapa yang SELALU Bisa Kontrol?
- User dengan permission **Administrator** atau **Manage Server**
- User dengan **DJ Role** yang sudah diset
- User/Role yang ada di daftar **Allowed**

### Catatan Penting
- `/play` dan `/search` **SELALU bisa dipakai** semua orang (hanya wajib di VC)
- Pembatasan hanya berlaku untuk command **kontrol** (pause, skip, volume, dll)
- Panel buttons juga mengikuti aturan akses yang sama

---

## 2.6 Batasi Command ke 1 Channel

Ingin musik hanya bisa di-request dari channel tertentu (misal `#music-request`)?

```
/access requestchannel channel:#music-request
```

Setelah diset, semua command musik (`/play`, `/search`, panel Add Song) hanya bisa dipakai di channel tersebut. Untuk menonaktifkan:

```
/access requestchannel
```
(Tanpa memilih channel → matikan pembatasan)

---

## 2.7 Platform yang Didukung

PinPlay bisa memutar musik dari berbagai sumber:

| Platform | Dukungan | Catatan |
|---|---|---|
| 🎬 **YouTube** | ✅ Penuh | Video, playlist, search |
| 🟢 **Spotify** | ✅ Via Plugin | Metadata Spotify → audio dari YouTube |
| 🍎 **Apple Music** | ✅ Via Plugin | Sama seperti Spotify |
| 🟠 **SoundCloud** | ✅ Penuh | Langsung streaming |
| 🔗 **Direct URL** | ✅ | File audio dari URL langsung |

> 💡 **Tentang Spotify:** Bot **tidak** streaming langsung dari Spotify. Plugin LavaSrc membaca metadata (judul, artis) dari link Spotify, lalu mencari versi audionya dari YouTube untuk diputar.

---

<div align="center">

### 🎵 Selamat Menggunakan PinPlay!

Jika ada masalah atau pertanyaan, buka Issue di repository GitHub.

</div>

<div align="center">
  
# 🎵 PinPlay Discord Music Bot

![Discord.js](https://img.shields.io/badge/Discord.js-v14-5865F2?style=for-the-badge&logo=discord&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js&logoColor=white)
![Lavalink](https://img.shields.io/badge/Lavalink-v4-E52B50?style=for-the-badge&logo=java&logoColor=white)
![Status](https://img.shields.io/badge/Status-Production_Ready-success?style=for-the-badge)

**PinPlay** adalah bot musik Discord performa tinggi yang dirancang dengan antarmuka **Interactive Panel** dan menggunakan **Lavalink v4** untuk streaming audio tanpa lag ke ratusan server sekaligus.

[Fitur Utama](#-fitur-unggulan) • [Cara Kerja](#-arsitektur--cara-kerja) • [Cara Install (Local)](#%EF%B8%8F-cara-install--menjalankan-di-local) • [Daftar Command](#-daftar-command)

</div>

---

## ✨ Fitur Unggulan

*   🎛️ **Interactive Music Panel** — Kontrol musik (Play, Pause, Skip, Loop, Volume) langsung dari tombol (Buttons) di chat tanpa perlu mengetik command berulang kali.
*   🎧 **Multi-Platform Support** — Putar lagu dari YouTube, Spotify, Apple Music, Deezer, dan SoundCloud (menggunakan plugin LavaSrc).
*   🕒 **Mode 24/7** — Bot bisa diatur untuk *stay* di Voice Channel meskipun antrian lagu kosong. Bahkan bisa otomatis *reconnect* setelah bot direstart!
*   🎚️ **Audio Filters** — Built-in equalizer filter seperti *Bassboost*, *Nightcore*, dan *Vaporwave*.
*   🔐 **Sistem Akses Kontrol (Role/User)** — Bisa diatur siapa saja yang boleh mengontrol musik. Mendukung mode *Public* (semua bisa) atau *Restricted* (hanya role DJ / Admin / User tertentu).
*   🚀 **High Performance** — Berkat Lavalink, bot ini sangat ringan dan tidak akan memberatkan CPU server kamu saat memutar musik resolusi tinggi.

---

## 🏗️ Arsitektur & Cara Kerja

Bot ini menggunakan arsitektur **terpisah** untuk performa maksimal:

1.  **PinPlay (Bot Node.js):** Bertugas menerima perintah (command) dari Discord, mengelola antrian (queue), dan memperbarui tampilan UI (Embed/Panel). Bot ini **TIDAK** memproses file audio sama sekali.
2.  **Lavalink (Server Audio Java):** Bertugas mengunduh lagu dari internet (YouTube/Spotify), men-decode audio, dan mengirimkannya (streaming) secara langsung ke server Voice Discord.

Karena dipisah, bot kamu tidak akan *lag* atau *crash* meskipun memutar musik berjam-jam untuk banyak server sekaligus.

---

## 🛠️ Cara Install & Menjalankan di Local

Karena arsitekturnya terpisah, kamu perlu menjalankan **2 hal**: Lavalink dan Bot-nya.

### Persyaratan Sistem (Prerequisites)
*   [Node.js](https://nodejs.org/en/) (Versi 18 ke atas)
*   [Java](https://www.oracle.com/java/technologies/javase/jdk17-archive-downloads.html) (Versi 17 ke atas — wajib untuk Lavalink)
*   Git (Opsional)

### Tahap 1: Setup Lavalink Server
Lavalink adalah "dapur" tempat audio diproses.
1. Download file `Lavalink.jar` versi 4 terbaru dari [GitHub Lavalink Releases](https://github.com/lavalink-devs/Lavalink/releases).
2. Letakkan file tersebut di dalam sebuah folder baru (contoh: `LavalinkServer`).
3. Di dalam folder yang sama, buat file bernama `application.yml` dan isi dengan konfigurasi standar. *(Cari referensi `application.yml` Lavalink v4 di dokumentasi resmi, pastikan passwordnya `youshallnotpass` atau sesuaikan dengan bot).*
4. Buka terminal di folder tersebut dan jalankan:
   ```bash
   java -jar Lavalink.jar
   ```
   *Biarkan terminal ini tetap terbuka.*

### Tahap 2: Setup PinPlay Bot
1. Clone repository ini atau buka folder proyek PinPlay di terminal.
2. Install semua dependency Node.js:
   ```bash
   npm install
   ```
3. Copy file `.env.example` menjadi `.env` dan isi datanya:
   ```bash
   cp .env.example .env
   ```
   *Buka `.env` dan masukkan `DISCORD_TOKEN` dan `CLIENT_ID` bot kamu dari [Discord Developer Portal](https://discord.com/developers/applications).*
4. Daftarkan (Deploy) Slash Commands ke Discord:
   ```bash
   # Untuk test di 1 server (lebih cepat muncul) - Pastikan isi GUILD_ID di .env
   npm run deploy:guild
   
   # Untuk rilis global ke semua server (bisa butuh waktu hingga 1 jam untuk sinkronisasi)
   npm run deploy:global
   ```
5. Jalankan Bot:
   ```bash
   npm start
   ```

Jika berhasil, kamu akan melihat log di terminal:
```text
[INFO ] ✅ Logged in as PinPlay#1234
[INFO ] Lavalink local: Ready!
```

---

## 📜 Daftar Command

### 🎵 Musik & Kontrol
| Command | Deskripsi |
| :--- | :--- |
| `/play <query>` | Memutar lagu/playlist dari pencarian atau Link |
| `/panel action:create` | **[REKOMENDASI]** Membuat UI tombol kontrol di chat |
| `/nowplaying` | Melihat detail lagu yang sedang diputar |
| `/queue` | Melihat antrian lagu |
| `/pause` / `/resume` | Jeda atau lanjutkan lagu |
| `/skip` / `/stop` | Lewati lagu atau hentikan semua dan bersihkan antrian |
| `/loop`, `/shuffle`, `/seek`| Fitur kontrol pemutaran |
| `/volume` | Mengatur volume suara (0-100) |
| `/filter` | Mengubah efek suara (Bassboost, Nightcore, dll) |

### ⚙️ Pengaturan Server (Admin)
| Command | Deskripsi |
| :--- | :--- |
| `/access` | Mengatur mode siapa yang bisa mengontrol musik (All/Restricted) |
| `/djrole` | Menentukan role khusus DJ |
| `/247` | Mengunci bot agar tidak keluar dari Voice Channel saat lagu habis |

---

<div align="center">
<i>Dibuat dengan ❤️ untuk komunitas Discord.</i>
</div>

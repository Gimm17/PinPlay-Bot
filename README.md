<div align="center">
  <img src="PinPlayLogo.png" alt="PinPlay Logo" width="160" style="border-radius: 50%; box-shadow: 0 4px 8px rgba(0,0,0,0.2);" />

  # 🎵 PinPlay Discord Music Bot

  Bot musik Discord modern dengan performa ultra-tinggi, antarmuka **Interactive Panel**, **27 Slash Commands**, dan ditenagai oleh **Lavalink v4** serta integrasi **NVIDIA AI API** untuk streaming audio berkualitas tinggi tanpa lag.

  [![Discord.js](https://img.shields.io/badge/Discord.js-v14-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.js.org/)
  [![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
  [![Lavalink](https://img.shields.io/badge/Lavalink-v4-E52B50?style=for-the-badge&logo=java&logoColor=white)](https://github.com/lavalink-devs/Lavalink)
  [![Status](https://img.shields.io/badge/Status-Production_Ready-success?style=for-the-badge)](https://github.com/Gimm17/PinPlay-Bot)

  [✨ Fitur Utama](#-fitur-unggulan) • [⚡ Quick Start](#-quick-start) • [📜 Daftar Command](#-daftar-command-27)
</div>

---

## ✨ Fitur Unggulan

* 🎛️ **Interactive Music Panel** — Kontrol pemutaran musik langsung melalui tombol interaktif di chat (Play, Pause, Skip, Volume, dll) tanpa mengetik.
* 🤖 **AI Playlist Generator** — Buat playlist lagu otomatis berdasarkan mood, tema, atau situasi (contoh: "lagu santai sore") lengkap dengan pilihan konfirmasi tombol.
* 🔥 **AI Savage Roast** — Dapatkan roasting lucu nan tajam dari AI yang menganalisis lagu aktif dan user yang me-request lagu tersebut.
* 🎧 **Multi-Platform Audio** — Streaming lagu favorit Anda dari YouTube, Spotify, Apple Music, SoundCloud, dan lainnya melalui plugin Lavalink v4.
* 🔍 **Smart Search System** — Cari lagu dengan perintah `/search` dan pilih secara interaktif dari 5 hasil pencarian teratas.
* 🎤 **Live Lyrics** — Dapatkan lirik lagu secara instan dan otomatis saat musik sedang diputar dengan `/lyrics`.
* 📜 **Advanced Queue Management** — Kontrol penuh atas antrian lagu: *move*, *remove*, *skipto*, *clear*, dan *shuffle*.
* 🕒 **Mode 24/7 & Auto-Reconnect** — Bot tetap berada di Voice Channel meskipun antrian kosong, dan otomatis tersambung kembali setelah restart.
* 🎚️ **Built-in Audio Filters** — Aktifkan filter *Bassboost*, *Nightcore*, atau *Vaporwave* untuk pengalaman mendengar yang lebih seru.
* 🔐 **Sistem Akses Kontrol** — Batasi akses kontrol musik ke peran tertentu (DJ Role) atau pengguna pilihan Anda.
* 📜 **Song History** — Simpan riwayat hingga 15 lagu terakhir yang diputar di server Anda.

---

## 🎛️ Interactive Music Panel Preview

Music Panel menyediakan antarmuka visual berupa tombol-tombol yang intuitif untuk mengontrol musik secara langsung dari obrolan Discord:

```
+------------------------------------------------------+
|             🎵 NOW PLAYING: Song Title               |
|  [===---------------------------------------] 03:45   |
+------------------------------------------------------+
|  [⏮️ Prev]  [⏸️ Pause]  [⏹️ Stop]  [⏭️ Skip]  [🔄 Loop]   |
|  [🔊 Vol+]  [🔈 Mute]   [🔊 Vol-]  [🔀 Shuf]  [📜 Queue]  |
+------------------------------------------------------+
```

---

## ⚡ Quick Start

### Persyaratan:
- **Node.js** v18 atau lebih tinggi.
- **Java 17+** (diperlukan untuk menjalankan Lavalink server).

### Cara Menjalankan:

1. **Jalankan Lavalink Server**
   Pastikan Lavalink v4 telah berjalan di sistem Anda:
   ```bash
   java -jar Lavalink.jar
   ```

2. **Kloning & Instalasi Dependensi**
   ```bash
   npm install
   ```

3. **Konfigurasi Environment**
   Salin berkas konfigurasi `.env.example` ke `.env`:
   ```bash
   cp .env.example .env
   ```
   *Buka `.env` dan masukkan `DISCORD_TOKEN`, `CLIENT_ID`, serta `NVIDIA_API_KEY` (untuk fitur AI) Anda.*

4. **Daftarkan Slash Commands**
   ```bash
   # Mendaftarkan commands ke server uji coba Anda (instan)
   npm run deploy:guild

   # Atau daftarkan secara global ke seluruh server (membutuhkan waktu hingga 1 jam)
   npm run deploy:global
   ```

5. **Jalankan Bot**
   ```bash
   npm start
   ```

---

## 📜 Daftar Command (27)

### 🤖 Fitur AI (Opsional)
| Command | Deskripsi |
| :--- | :--- |
| `/aiplaylist [query]` | Membuat playlist lagu otomatis menggunakan AI berdasarkan mood atau tema |
| `/roast` | Me-roast secara savage lagu yang sedang diputar & pengguna yang me-request-nya |

### 🎵 Musik (Semua Pengguna)
| Command | Deskripsi |
| :--- | :--- |
| `/play <query>` | Memutar lagu/playlist berdasarkan judul, URL YouTube, Spotify, dll. |
| `/search <query>` | Mencari lagu dan menampilkan 5 hasil pilihan interaktif. |
| `/nowplaying` | Menampilkan informasi detail tentang lagu yang sedang diputar. |
| `/lyrics [query]` | Menampilkan lirik lagu secara otomatis atau mencari manual. |
| `/queue [page]` | Menampilkan daftar antrian lagu saat ini. |
| `/history` | Menampilkan riwayat 15 lagu terakhir yang diputar. |
| `/help` | Menampilkan panduan bantuan bot. |

### 🎛️ Kontrol Pemutaran (Dapat Dibatasi)
| Command | Deskripsi |
| :--- | :--- |
| `/pause` / `/resume` | Menjeda atau melanjutkan pemutaran musik. |
| `/skip` / `/stop` | Melewati lagu aktif atau menghentikan pemutaran & menghapus antrian. |
| `/clear` | Membersihkan daftar antrian tanpa menghentikan lagu saat ini. |
| `/remove <posisi>` | Menghapus lagu tertentu dari antrian berdasarkan posisinya. |
| `/move <dari> <ke>` | Memindahkan posisi lagu di dalam antrian. |
| `/skipto <posisi>` | Langsung melompat ke lagu di posisi tertentu dalam antrian. |
| `/loop <mode>` | Mengatur mode perulangan: `off` / `track` / `queue`. |
| `/shuffle` | Mengacak urutan lagu di antrian. |
| `/volume <0-100>` | Mengatur volume suara pemutaran. |
| `/seek <detik>` | Lompat ke durasi waktu tertentu di lagu saat ini. |
| `/filter <nama>` | Mengaktifkan efek suara (Bassboost, Nightcore, Vaporwave). |
| `/leave` | Mengeluarkan bot dari Voice Channel secara paksa. |

### ⚙️ Pengaturan & Administrasi (Hanya Admin)
| Command | Deskripsi |
| :--- | :--- |
| `/panel <action>` | Membuat (`create`) atau menghapus (`delete`) Interactive Music Panel di chat. |
| `/access <subcommand>` | Mengatur mode akses musik (`public` atau `restricted`). |
| `/djrole <set\|view>` | Menentukan atau melihat peran (role) khusus DJ. |
| `/247 <enable>` | Mengaktifkan atau menonaktifkan mode standby 24/7 di Voice Channel. |

---

<div align="center">
  <h3>🤝 Berkontribusi & Dukungan</h3>
  
  Punya saran, kendala, atau ingin berkontribusi? Buka **Issue** atau buat **Pull Request**.

  *Dibuat dengan ❤️ untuk komunitas Discord.*
</div>

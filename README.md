<div align="center">
  
# 🎵 PinPlay Discord Music Bot

![Discord.js](https://img.shields.io/badge/Discord.js-v14-5865F2?style=for-the-badge&logo=discord&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js&logoColor=white)
![Lavalink](https://img.shields.io/badge/Lavalink-v4-E52B50?style=for-the-badge&logo=java&logoColor=white)
![Status](https://img.shields.io/badge/Status-Production_Ready-success?style=for-the-badge)

**PinPlay** adalah bot musik Discord performa tinggi dengan **25 slash commands**, antarmuka **Interactive Panel**, dan **Lavalink v4** untuk streaming audio tanpa lag.

[Fitur Utama](#-fitur-unggulan) • [Quick Start](#-quick-start) • [📖 GUIDE LENGKAP](GUIDE.md) • [Daftar Command](#-daftar-command-25)

</div>

---

## ✨ Fitur Unggulan

*   🎛️ **Interactive Music Panel** — 10 tombol kontrol visual langsung di chat
*   🎧 **Multi-Platform** — YouTube, Spotify, Apple Music, SoundCloud via Lavalink plugins
*   🔍 **Smart Search** — Cari lagu dengan pilihan dari 5 hasil (`/search`)
*   🎤 **Lyrics** — Tampilkan lirik lagu otomatis (`/lyrics`)
*   📜 **Queue Management** — Remove, Move, SkipTo, Clear — kontrol antrian secara detail
*   🕒 **Mode 24/7** — Bot stay di VC, auto-reconnect setelah restart
*   🎚️ **Audio Filters** — Bassboost, Nightcore, Vaporwave
*   🔐 **Akses Kontrol** — Mode Public atau Restricted (DJ Role / Allowed Users)
*   📜 **Song History** — Riwayat 15 lagu terakhir per server

---

## ⚡ Quick Start

```bash
# 1. Pastikan Lavalink v4 sudah jalan (butuh Java 17+)
java -jar Lavalink.jar

# 2. Install & konfigurasi
npm install
cp .env.example .env     # Isi TOKEN & CLIENT_ID

# 3. Deploy commands & jalankan
npm run deploy:guild
npm start
```

> 📖 **Panduan lengkap** (step-by-step dari nol): **[Buka GUIDE.md](GUIDE.md)**
>
> Guide mencakup: cara buat bot di Discord Developer Portal, invite bot, setup Lavalink, konfigurasi `.env`, troubleshooting, dan penjelasan detail setiap command.

---

## 📜 Daftar Command (25)

### 🎵 Musik (Semua Orang)
| Command | Deskripsi |
| :--- | :--- |
| `/play <query>` | Putar lagu/playlist dari judul atau link |
| `/search <query>` | Cari lagu, pilih dari 5 hasil |
| `/nowplaying` | Detail lagu yang sedang diputar |
| `/lyrics [query]` | Tampilkan lirik (otomatis / manual) |
| `/queue [page]` | Lihat antrian lagu |
| `/history` | 15 lagu terakhir yang diputar |
| `/help` | Panduan penggunaan bot |

### 🎛️ Kontrol (Tergantung Akses)
| Command | Deskripsi |
| :--- | :--- |
| `/pause` / `/resume` | Jeda / lanjutkan lagu |
| `/skip` / `/stop` | Skip lagu / stop & clear queue |
| `/clear` | Bersihkan queue tanpa stop lagu saat ini |
| `/remove <posisi>` | Hapus lagu tertentu dari queue |
| `/move <dari> <ke>` | Pindahkan lagu di queue |
| `/skipto <posisi>` | Loncat ke posisi tertentu di queue |
| `/loop <mode>` | Loop: off / track / queue |
| `/shuffle` | Acak urutan queue |
| `/volume <0-100>` | Atur volume |
| `/seek <detik>` | Loncat ke posisi waktu tertentu |
| `/filter <nama>` | Filter audio (bassboost/nightcore/vaporwave) |
| `/leave` | Paksa bot keluar dari VC |

### ⚙️ Setup (Admin Only)
| Command | Deskripsi |
| :--- | :--- |
| `/panel <action>` | Buat / hapus Music Panel |
| `/access <subcommand>` | Atur akses kontrol musik |
| `/djrole <set\|view>` | Set / lihat DJ role |
| `/247 <enable>` | Mode 24/7 (stay di VC) |

---

<div align="center">

📖 **[Buka GUIDE.md untuk panduan lengkap →](GUIDE.md)**

<i>Dibuat dengan ❤️ untuk komunitas Discord.</i>
</div>


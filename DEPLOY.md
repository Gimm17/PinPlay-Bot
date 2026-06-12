# 🚀 PinPlay — Deploy ke Oracle Cloud (GRATIS SELAMANYA)

Guide lengkap deploy PinPlay Bot + Lavalink ke Oracle Cloud Free Tier (ARM).

---

## 📋 Yang Kamu Butuhkan

- **Kartu debit/kredit** (Visa/Mastercard) — untuk verifikasi, TIDAK dicharge
- **Email** yang belum pernah daftar Oracle Cloud
- **15-30 menit** waktu setup

---

## STEP 1: Buat Akun Oracle Cloud

1. Buka **https://cloud.oracle.com/registration**
2. Isi data:
   - Email → pakai email yang belum pernah daftar
   - Country → **Indonesia**
   - Cloud Account Name → bebas (contoh: `pinplay-server`)
3. Verifikasi email
4. Isi profil:
   - Home Region → pilih **ap-singapore-1 (Singapore)** atau **ap-seoul-1 (Seoul)** (terdekat dari Indonesia)
   - **⚠️ PENTING: Region TIDAK bisa diganti setelah daftar!**
5. Masukkan kartu kredit/debit (hanya verifikasi, $0 charge)
6. Selesai! Kamu masuk ke **Oracle Cloud Console**

---

## STEP 2: Buat VM Instance (Always Free)

### 2a. Masuk ke Compute

1. Di Oracle Cloud Console, klik **☰ Menu** → **Compute** → **Instances**
2. Klik **Create Instance**

### 2b. Konfigurasi Instance

| Setting | Value |
|---------|-------|
| **Name** | `pinplay-server` |
| **Compartment** | default (root) |
| **Placement** | Availability Domain yang tersedia |

### 2c. Image & Shape (PALING PENTING)

1. Klik **Edit** di bagian **Image and shape**
2. **Image**: Pilih **Canonical Ubuntu 22.04** (atau 24.04)
3. **Shape**: Klik **Change shape**
   - Pilih tab **Ampere** (ARM)
   - Shape: **VM.Standard.A1.Flex**
   - OCPUs: **4** (gratis sampai 4)
   - Memory: **24 GB** (gratis sampai 24 GB)

> ⚠️ **Kalau shape Ampere "Out of capacity":**
> - Coba lagi beberapa jam kemudian (Oracle restock berkala)
> - Coba region lain kalau belum terlanjur daftar
> - Atau pakai **VM.Standard.E2.1.Micro** (x86, 1 vCPU, 1 GB RAM) sebagai alternatif — ini juga Always Free

### 2d. Networking

1. **VCN**: Biarkan default (Create new VCN)
2. **Subnet**: Biarkan default (Create new public subnet)
3. **Public IPv4**: ✅ Centang **Assign a public IPv4 address**

### 2e. SSH Key (PENTING!)

1. Pilih **Generate a key pair for me**
2. **Download KEDUA file:**
   - `ssh-key-xxxxx.key` (Private key)
   - `ssh-key-xxxxx.key.pub` (Public key)
3. **Simpan baik-baik! Kalau hilang, tidak bisa login ke server!**

### 2f. Boot Volume

- Size: **50 GB** (gratis sampai 200 GB total)
- Biarkan sisanya default

### 2g. Create!

Klik **Create** → tunggu sampai status **RUNNING** (1-3 menit)

---

## STEP 3: Buka Port Firewall

### 3a. Oracle Security List

1. Di halaman instance, klik **Subnet** di bagian "Primary VNIC"
2. Klik **Security List** (Default Security List)
3. Klik **Add Ingress Rules**
4. Tambahkan rules:

| Source CIDR | Protocol | Dest Port | Keterangan |
|-------------|----------|-----------|------------|
| `0.0.0.0/0` | TCP | `22` | SSH (sudah ada by default) |
| `0.0.0.0/0` | TCP | `2333` | Lavalink (opsional, hanya kalau remote) |

> 💡 Port 2333 hanya perlu dibuka kalau Lavalink dan Bot di server berbeda. Kalau satu server, tidak perlu.

### 3b. OS Firewall (iptables)

Oracle Ubuntu punya iptables yang memblokir port by default. Kita buka nanti di script.

---

## STEP 4: Login ke Server via SSH

### Windows (PowerShell / CMD):

```bash
ssh -i "C:\path\to\ssh-key-xxxxx.key" ubuntu@<PUBLIC_IP>
```

Ganti `<PUBLIC_IP>` dengan IP publik dari halaman instance Oracle.

### Kalau error "permissions too open":

```powershell
# Di PowerShell (run as admin):
icacls "C:\path\to\ssh-key-xxxxx.key" /inheritance:r /grant:r "%USERNAME%:R"
```

### Pertama kali login, ketik `yes` kalau ditanya fingerprint.

---

## STEP 5: Deploy PinPlay (Auto-Install)

### 5a. Upload file ke server

Dari **PC lokal** (PowerShell), jalankan:

```powershell
# Upload seluruh folder PinPlay ke server
scp -i "C:\path\to\ssh-key-xxxxx.key" -r "C:\Users\HP\OneDrive\Documents\CODINGAN\BOT-DISCORD\PinPlay" ubuntu@<PUBLIC_IP>:~/PinPlay

# Upload Lavalink
scp -i "C:\path\to\ssh-key-xxxxx.key" -r "C:\Users\HP\OneDrive\Documents\CODINGAN\BOT-DISCORD\PinPlay-Lavalink" ubuntu@<PUBLIC_IP>:~/PinPlay-Lavalink
```

### 5b. Login dan jalankan auto-install

```bash
ssh -i "C:\path\to\ssh-key-xxxxx.key" ubuntu@<PUBLIC_IP>

# Di server:
cd ~/PinPlay
chmod +x deploy.sh
./deploy.sh
```

Script `deploy.sh` akan otomatis:
1. ✅ Install Java 17 (untuk Lavalink)
2. ✅ Install Node.js 20 (untuk Bot)
3. ✅ Install PM2 (process manager untuk 24/7)
4. ✅ Setup swap file (2 GB cadangan RAM)
5. ✅ Buka firewall ports
6. ✅ Start Lavalink + Bot
7. ✅ Setup auto-restart on reboot

---

## STEP 6: Verifikasi

Setelah `deploy.sh` selesai:

```bash
# Cek status semua proses
pm2 status

# Harus muncul:
# ┌──────────┬────┬─────┬──────┬───────┐
# │ Name     │ id │ mode│ status│ cpu   │
# ├──────────┼────┼─────┼──────┼───────┤
# │ lavalink │ 0  │ fork│ online│ ...   │
# │ pinplay  │ 1  │ fork│ online│ ...   │
# └──────────┴────┴─────┴──────┴───────┘

# Cek log bot
pm2 logs pinplay --lines 30

# Cek log lavalink
pm2 logs lavalink --lines 30
```

---

## 📌 Perintah Berguna Sehari-hari

```bash
# === Status ===
pm2 status                    # Lihat semua proses
pm2 logs                      # Lihat semua log live
pm2 logs pinplay --lines 50   # Log bot (50 baris terakhir)
pm2 logs lavalink --lines 50  # Log lavalink

# === Restart ===
pm2 restart pinplay           # Restart bot saja
pm2 restart lavalink          # Restart lavalink saja
pm2 restart all               # Restart semua

# === Stop ===
pm2 stop pinplay              # Stop bot
pm2 stop all                  # Stop semua

# === Update Bot (setelah edit kode) ===
cd ~/PinPlay
git pull                      # kalau pakai git
pm2 restart pinplay           # restart bot

# === Monitor Resource ===
pm2 monit                     # Monitor CPU/RAM real-time
htop                          # System monitor
```

---

## 🔄 Update Bot dari PC Lokal

Kalau kamu edit kode di PC, upload ulang:

```powershell
# Dari PC (PowerShell):
scp -i "C:\path\to\key" -r "C:\...\PinPlay\src" ubuntu@<IP>:~/PinPlay/src
scp -i "C:\path\to\key" "C:\...\PinPlay\package.json" ubuntu@<IP>:~/PinPlay/

# Lalu di server:
ssh -i "C:\path\to\key" ubuntu@<IP>
cd ~/PinPlay && npm install && pm2 restart pinplay
```

---

## ⚠️ Troubleshooting

### Bot tidak bisa connect ke Lavalink
```bash
# Pastikan lavalink sudah running
pm2 logs lavalink --lines 20
# Cari "Started Launcher" atau "Lavalink is ready"
```

### Out of memory
```bash
# Cek memory
free -h

# Kalau swap belum ada, tambah manual:
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

### Server reboot, bot mati
```bash
# Harusnya auto-start. Kalau tidak:
pm2 startup
pm2 save
```

### Mau ganti token / .env
```bash
nano ~/PinPlay/.env
# Edit, save (Ctrl+X, Y, Enter)
pm2 restart pinplay
```

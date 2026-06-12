# Panduan Mengatur Spotify API

Untuk mengaktifkan fitur pencarian dan pemutaran dari link Spotify (Playlist, Album, Track), kamu perlu menambahkan kredensial Spotify API ke dalam file `.env`. 

Berikut langkah-langkahnya:

### 1. Buat Aplikasi di Spotify Developer
1. Buka [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Login menggunakan akun Spotify kamu (akun gratis juga bisa).
3. Klik tombol **Create app** di pojok kanan atas.
4. Isi formulir pembuatan aplikasi:
   - **App name**: Bebas, contoh: `PinPlay Bot`
   - **App description**: Bebas, contoh: `Discord Music Bot`
   - **Website**: Bebas, bisa dikosongkan atau isi `https://github.com`
   - **Redirect URI**: Ketik `https://example.com` (wajib diisi dan pakai https, lalu klik tombol "Add" di sebelahnya)
   - Centang opsi **Web API** (dan opsi lainnya jika diperlukan).
   - Centang persetujuan *Terms of Service*.
   - Klik **Save**.

### 2. Dapatkan Client ID & Client Secret
1. Setelah aplikasi dibuat, kamu akan masuk ke halaman dashboard aplikasimu.
2. Klik tombol **Settings**.
3. Di bawah nama aplikasi, kamu akan melihat **Client ID**. Salin kode tersebut.
4. Di bawahnya, klik **View client secret**. Salin kode rahasia tersebut. 

### 3. Tambahkan ke File .env
Buka file `.env` kamu, lalu tambahkan/ubah bagian ini:

```env
# ==================== Spotify (Optional) ====================
# Get from https://developer.spotify.com/dashboard
SPOTIFY_CLIENT_ID=masukkan_client_id_kamu_disini
SPOTIFY_CLIENT_SECRET=masukkan_client_secret_kamu_disini
```

Simpan file `.env`, lalu restart bot kamu. Sekarang PinPlay sudah bisa menerima link Spotify! 🎵

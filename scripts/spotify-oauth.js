/**
 * PinPlay - Spotify OAuth Setup Script
 * Run once to get a refresh token that allows reading ANY public playlist.
 *
 * Usage: node scripts/spotify-oauth.js
 */

const http = require("http");
const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");

const dotenv = require("dotenv");
const envPath = path.join(__dirname, "../.env");
dotenv.config({ path: envPath });

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = "http://127.0.0.1:8889/callback";
const SCOPE = "playlist-read-private playlist-read-collaborative";
const PORT = 8889;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("❌ SPOTIFY_CLIENT_ID dan SPOTIFY_CLIENT_SECRET harus diisi di .env dulu!");
  process.exit(1);
}

const authUrl =
  "https://accounts.spotify.com/authorize?" +
  new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
  }).toString();

console.log("\n========================================");
console.log("  PinPlay - Spotify OAuth Setup");
console.log("========================================\n");
console.log("✅ SEBELUM LANJUT, pastikan kamu sudah menambahkan URL ini ke");
console.log("   Redirect URIs di Spotify Developer Dashboard:");
console.log(`   → http://127.0.0.1:8889/callback\n`);
console.log("1. Buka URL ini di browser kamu:\n");
console.log("   " + authUrl + "\n");

// Try to auto-open browser
try {
  const platform = process.platform;
  if (platform === "win32") {
    execSync(`start "" "${authUrl}"`, { stdio: "ignore" });
    console.log("   (Browser telah dibuka otomatis!)\n");
  } else if (platform === "darwin") {
    execSync(`open "${authUrl}"`, { stdio: "ignore" });
  } else {
    execSync(`xdg-open "${authUrl}"`, { stdio: "ignore" });
  }
} catch {
  console.log("   (Buka URL di atas secara manual jika browser tidak terbuka otomatis)\n");
}

console.log("2. Login ke Spotify dan klik AGREE/SETUJU.\n");
console.log("3. Tunggu... script ini akan menangkap kodenya otomatis.\n");

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (urlObj.pathname !== "/callback") {
    res.end("Not found");
    return;
  }

  const code = urlObj.searchParams.get("code");
  const error = urlObj.searchParams.get("error");

  if (error) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<h2>❌ Error: ${error}</h2><p>Tutup tab ini dan coba lagi.</p>`);
    server.close();
    return;
  }

  if (!code) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h2>❌ Tidak ada kode dari Spotify. Coba lagi.</h2>");
    server.close();
    return;
  }

  console.log("✅ Kode berhasil diterima! Menukar kode dengan token...\n");

  // Exchange code for tokens
  const creds = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${creds}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
    }).toString(),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    console.error("❌ Gagal mendapat token:", errText);
    res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<h2>❌ Gagal mendapat token.</h2><pre>${errText}</pre>`);
    server.close();
    return;
  }

  const tokenData = await tokenRes.json();
  const refreshToken = tokenData.refresh_token;
  const accessToken = tokenData.access_token;

  if (!refreshToken) {
    console.error("❌ Refresh token tidak ditemukan dalam respons Spotify!");
    res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h2>❌ Refresh token tidak ada. Coba lagi.</h2>");
    server.close();
    return;
  }

  // Verify the token works (get user info)
  const userRes = await fetch("https://api.spotify.com/v1/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const userData = await userRes.json();

  console.log(`✅ Berhasil login sebagai: ${userData.display_name || userData.id} (${userData.email})\n`);

  // Save refresh token to .env
  let envContent = fs.readFileSync(envPath, "utf8");
  if (envContent.includes("SPOTIFY_REFRESH_TOKEN=")) {
    envContent = envContent.replace(/SPOTIFY_REFRESH_TOKEN=.*/, `SPOTIFY_REFRESH_TOKEN=${refreshToken}`);
  } else {
    envContent = envContent.trimEnd() + `\n\n# Spotify OAuth Refresh Token (dibuat otomatis oleh spotify-oauth.js)\nSPOTIFY_REFRESH_TOKEN=${refreshToken}\n`;
  }
  fs.writeFileSync(envPath, envContent, "utf8");

  console.log("✅ SPOTIFY_REFRESH_TOKEN berhasil disimpan ke file .env!");
  console.log("\n========================================");
  console.log("  SETUP SELESAI! 🎉");
  console.log("========================================");
  console.log("\nSekarang restart bot kamu dari PinPlay Launcher.");
  console.log("Bot sudah bisa membaca SEMUA playlist Spotify publik!\n");

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`
    <html><body style="font-family:sans-serif;text-align:center;padding:50px;background:#1DB954;color:white">
      <h1>✅ Setup Berhasil!</h1>
      <p>Login sebagai: <b>${userData.display_name || userData.id}</b></p>
      <p>Refresh token sudah disimpan ke .env</p>
      <p><b>Tutup tab ini dan restart PinPlay Bot!</b></p>
    </body></html>
  `);

  server.close();
  setTimeout(() => process.exit(0), 1000);
});

server.listen(PORT, () => {
  console.log(`⏳ Menunggu login Spotify di port ${PORT}...\n`);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`❌ Port ${PORT} sedang digunakan. Tutup aplikasi lain yang memakai port ini lalu coba lagi.`);
  } else {
    console.error("❌ Server error:", err);
  }
  process.exit(1);
});

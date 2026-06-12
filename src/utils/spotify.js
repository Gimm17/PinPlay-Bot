const { config } = require("../config");
const { makeLogger } = require("./logger");

const log = makeLogger(config.logLevel);

// ─── Cache Token ─────────────────────────────────────────
let _token = null;
let _tokenExpiresAt = 0;

// ─── Cache Playlist ─────────────────────────────────────
const _playlistCache = new Map();
const PLAYLIST_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// ─── Cache YouTube Search ───────────────────────────────
const _youtubeCache = new Map();
const YOUTUBE_CACHE_TTL = 15 * 60 * 1000; // 15 minutes

function _cleanupPlaylistCache() {
  const now = Date.now();
  for (const [key, value] of _playlistCache.entries()) {
    if (now - value.timestamp > PLAYLIST_CACHE_TTL) {
      _playlistCache.delete(key);
    }
  }
}

function _getPlaylistCache(key) {
  const cached = _playlistCache.get(key);
  if (cached && Date.now() - cached.timestamp < PLAYLIST_CACHE_TTL) {
    return cached.data;
  }
  return null;
}

function _setPlaylistCache(key, data) {
  _cleanupPlaylistCache();
  _playlistCache.set(key, {
    data,
    timestamp: Date.now()
  });
}

function _getYoutubeCache(key) {
  const cached = _youtubeCache.get(key);
  if (cached && Date.now() - cached.timestamp < YOUTUBE_CACHE_TTL) {
    return cached.data;
  }
  return null;
}

function _setYoutubeCache(key, data) {
  _youtubeCache.set(key, {
    data,
    timestamp: Date.now()
  });
}

// Run cleanup periodically
setInterval(_cleanupPlaylistCache, 5 * 60 * 1000); // every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of _youtubeCache.entries()) {
    if (now - value.timestamp > YOUTUBE_CACHE_TTL) {
      _youtubeCache.delete(key);
    }
  }
}, 10 * 60 * 1000); // every 10 minutes for YouTube cache

/**
 * [PRIORITAS 1] Mendapatkan token via OAuth Refresh Token.
 * Token ini bersifat user-level sehingga bisa membaca SEMUA playlist publik.
 * Setup sekali dengan: node scripts/spotify-oauth.js
 */
async function getTokenViaRefreshToken() {
  const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN;
  if (!refreshToken) return null;

  // Return cached token if still valid
  if (_token && Date.now() < _tokenExpiresAt - 60000) return _token;

  try {
    const creds = Buffer.from(
      `${config.spotify.clientId}:${config.spotify.clientSecret}`
    ).toString("base64");

    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${creds}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }).toString(),
    });

    if (!res.ok) {
      log.warn("[Spotify/RefreshToken] Gagal refresh token, status:", res.status);
      return null;
    }

    const data = await res.json();
    _token = data.access_token;
    _tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
    log.info("[Spotify/RefreshToken] ✅ Token user berhasil direfresh.");
    return _token;
  } catch (err) {
    log.error("[Spotify/RefreshToken] Error:", err.message);
    return null;
  }
}

/**
 * [PRIORITAS 2] Mendapatkan token via Client ID & Secret (OAuth2 Client Credentials).
 * Hanya bisa akses data publik umum (track, album). Playlist milik orang lain = 403.
 */
async function getTokenViaClientCredentials() {
  if (!config.spotify?.clientId || !config.spotify?.clientSecret) return null;
  if (_token && Date.now() < _tokenExpiresAt - 60000) return _token;

  try {
    const creds = Buffer.from(
      `${config.spotify.clientId}:${config.spotify.clientSecret}`
    ).toString("base64");
    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${creds}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });

    if (!res.ok) {
      log.warn("[Spotify/ClientCreds] Gagal mendapat token:", res.statusText);
      return null;
    }

    const data = await res.json();
    _token = data.access_token;
    _tokenExpiresAt = Date.now() + data.expires_in * 1000;
    return _token;
  } catch (err) {
    log.error("[Spotify/ClientCreds] Error:", err.message);
    return null;
  }
}

/**
 * Mendapatkan token terbaik yang tersedia.
 * Refresh Token (OAuth) >> Client Credentials
 */
async function getSpotifyToken() {
  const now = Date.now();
  if (_token && now < _tokenExpiresAt - 60000) return _token;
  _token = null;

  const refreshToken = await getTokenViaRefreshToken();
  if (refreshToken) return refreshToken;

  return getTokenViaClientCredentials();
}


/**
 * Fallback: Scrape track list dari Spotify embed page.
 * Mengembalikan array Spotify track URLs (bukan nama lagu).
 * URL ini nanti di-resolve satu per satu via Kazagumo (LavaSrc).
 */
async function scrapePlaylistTracks(playlistId) {
  try {
    const url = `https://open.spotify.com/embed/playlist/${playlistId}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) return null;

    const html = await res.text();

    // Spotify embed page menyertakan JSON di dalam <script id="__NEXT_DATA__">
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!nextDataMatch) return null;

    const jsonData = JSON.parse(nextDataMatch[1]);

    // Navigate ke playlist tracks
    const props = jsonData?.props?.pageProps;
    if (!props) return null;

    const state = props.state;
    let trackItems = null;

    if (state?.data?.entity?.trackList) {
      trackItems = state.data.entity.trackList;
    } else if (state?.data?.entity?.tracks) {
      trackItems = state.data.entity.tracks;
    }

    if (!trackItems || !Array.isArray(trackItems)) return null;

    // Ambil track URI/ID untuk construct Spotify URL
    const tracks = [];
    for (const item of trackItems) {
      const uri = item.uri || item.trackUri;
      if (uri && uri.startsWith("spotify:track:")) {
        const id = uri.replace("spotify:track:", "");
        tracks.push({
          url: `https://open.spotify.com/track/${id}`,
          name: item.title || item.name || "Unknown",
          artist: item.artists?.[0]?.name || item.artistName || "",
        });
      }
    }

    const playlistName = state?.data?.entity?.name || state?.data?.entity?.title || "Spotify Playlist";

    if (tracks.length === 0) return null;

    return { type: "PLAYLIST", name: playlistName, tracks };
  } catch (err) {
    log.warn("[Spotify/Scrape] Gagal scrape playlist:", err.message);
    return null;
  }
}

/**
 * Resolve playlist track URLs ke Kazagumo tracks secara paralel.
 * Setiap track URL di-resolve individual via LavaSrc (bisa ambil dari Spotify source).
 */
async function resolvePlaylistViaTrackUrls(kazagumo, playlistData, requester) {
  if (!playlistData?.tracks?.length) return null;

  const resolvedTracks = [];
  const BATCH_SIZE = 5; // Lebih kecil karena LavaSrc resolve per track
  const MAX_RETRIES = 2;

  for (let i = 0; i < playlistData.tracks.length; i += BATCH_SIZE) {
    const batch = playlistData.tracks.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (trackInfo) => {
        let result = null;
        for (let attempt = 0; attempt < MAX_RETRIES && !result; attempt++) {
          try {
            const res = await kazagumo.search(trackInfo.url, { requester });
            result = res?.tracks?.length > 0 ? res.tracks[0] : null;
          } catch (e) {
            if (attempt < MAX_RETRIES - 1) {
              await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
            } else {
              log.warn(`[Playlist→Track] Gagal resolve: ${trackInfo.name} - ${trackInfo.artist}`);
            }
          }
        }
        return result;
      })
    );
    resolvedTracks.push(...results.filter(Boolean));

    // Delay antar batch untuk hindari rate limit
    if (i + BATCH_SIZE < playlistData.tracks.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  if (resolvedTracks.length === 0) return null;

  return {
    type: "PLAYLIST",
    playlistName: playlistData.name,
    tracks: resolvedTracks,
  };
}

/**
 * Background: Resolve sisa track URLs ke Kazagumo tracks dan add ke queue.
 * Dipanggil tanpa await dari play command agar user tidak perlu menunggu.
 */
async function resolveRemainingTracks(client, guildId, remainingTracks, requester) {
  const BATCH_SIZE = 2;
  const DELAY_BETWEEN_BATCHES = 750;
  let addedCount = 0;

  for (let i = 0; i < remainingTracks.length; i += BATCH_SIZE) {
    // Cek player masih ada sebelum resolve
    const player = client.kazagumo.players.get(guildId);
    if (!player) {
      log.info("[BG Load] Player sudah tidak ada, stop background loading.");
      break;
    }

    const batch = remainingTracks.slice(i, i + BATCH_SIZE);

    // Resolve satu per satu SEQUENTIAL (bukan parallel) agar tidak saturate Lavalink
    for (const trackInfo of batch) {
      try {
        const res = await client.kazagumo.search(trackInfo.url, { requester });
        const track = res?.tracks?.[0] || null;
        if (track) {
          // Cek lagi player masih ada sebelum add
          const p = client.kazagumo.players.get(guildId);
          if (!p) {
            log.info("[BG Load] Player gone, stopping.");
            break;
          }
          p.queue.add(track);
          addedCount++;
        }
      } catch {
        log.warn(`[BG Load] Gagal resolve: ${trackInfo.name}`);
      }
    }

    // Update panel setelah setiap batch
    try {
      const { updatePanel } = require("../music/panel");
      await updatePanel(client, guildId);
    } catch { /* ignore panel errors */ }

    // Delay antar batch — biar Lavalink bisa handle command lain
    if (i + BATCH_SIZE < remainingTracks.length) {
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES));
    }
  }

  log.info(`[BG Load] Selesai: ${addedCount}/${remainingTracks.length} tracks loaded di guild ${guildId}`);
}

/**
 * Fetch helper ke Spotify API dengan token otomatis.
 */
async function fetchSpotifyAPI(endpoint) {
  const token = await getSpotifyToken();
  if (!token) return null;

  try {
    const res = await fetch(`https://api.spotify.com/v1${endpoint}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      log.warn(`[Spotify API] ${res.status} pada endpoint: ${endpoint}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    log.warn(`[Spotify API] Error pada ${endpoint}:`, err.message);
    return null;
  }
}

/**
 * Parsing URL Spotify dan mengembalikan data (Track/Playlist/Album).
 */
async function resolveSpotifyUrl(url) {
  // Cek cache dulu
  const cacheKey = `playlist:${url}`;
  const cached = _getPlaylistCache(cacheKey);
  if (cached) {
    return cached;
  }

  const trackMatch = url.match(/track\/([a-zA-Z0-9]+)/);
  if (trackMatch) {
    const data = await fetchSpotifyAPI(`/tracks/${trackMatch[1]}`);
    if (!data) return null;
    const artists = data.artists.map((a) => a.name).join(" ");
    const result = { type: "TRACK", name: data.name, tracks: [`${data.name} ${artists}`] };
    _setPlaylistCache(cacheKey, result);
    return result;
  }

  const albumMatch = url.match(/album\/([a-zA-Z0-9]+)/);
  if (albumMatch) {
    const data = await fetchSpotifyAPI(`/albums/${albumMatch[1]}`);
    if (!data) return null;
    const artist = data.artists[0]?.name || "";
    const tracks = data.tracks.items.map((t) => `${t.name} ${artist}`);
    const result = { type: "PLAYLIST", name: data.name, tracks };
    _setPlaylistCache(cacheKey, result);
    return result;
  }

  const playlistMatch = url.match(/playlist\/([a-zA-Z0-9]+)/);
  if (playlistMatch) {
    const playlistId = playlistMatch[1];

    // Step 1: Ambil metadata playlist (nama, dll)
    const info = await fetchSpotifyAPI(`/playlists/${playlistId}?fields=name,owner`);
    if (!info || !info.name) return null;

    // Step 2: Ambil tracks dari endpoint khusus (Spotify API tidak lagi
    //         menyertakan tracks di objek playlist untuk beberapa scope)
    const MAX_TRACKS = 500;
    let tracks = [];

    // Coba endpoint /tracks dulu (butuh scope yang benar)
    const tracksData = await fetchSpotifyAPI(`/playlists/${playlistId}/tracks?limit=100&fields=items(track(name,artists(name))),next,total`);
    if (tracksData && tracksData.items) {
      tracks = tracksData.items
        .slice(0, MAX_TRACKS)
        .map((item) => {
          const t = item.track;
          if (!t) return null;
          const artist = t.artists?.[0]?.name || "";
          return `${t.name} ${artist}`;
        })
        .filter(Boolean);

      // Pagination
      let nextUrl = tracksData.next;
      let fetchedCount = tracks.length;

      while (nextUrl && fetchedCount < MAX_TRACKS) {
        const token = await getSpotifyToken();
        if (!token) break;

        try {
          const res = await fetch(nextUrl, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(10000),
          });

          if (!res.ok) break;
          const data = await res.json();

          const moreTracks = data.items
            .slice(0, MAX_TRACKS - fetchedCount)
            .map((item) => {
              const t = item.track;
              if (!t) return null;
              const artist = t.artists?.[0]?.name || "";
              return `${t.name} ${artist}`;
            })
            .filter(Boolean);

          tracks.push(...moreTracks);
          fetchedCount += moreTracks.length;
          nextUrl = data.next;

          if (nextUrl) await new Promise(resolve => setTimeout(resolve, 300));
        } catch (error) {
          log.warn("[Spotify/Playlist] Timeout atau error saat fetch pagination:", error.message);
          break;
        }
      }
    }

    // Fallback: jika endpoint /tracks gagal (scope kurang),
    // coba ambil dari objek playlist langsung
    if (tracks.length === 0) {
      const fullInfo = await fetchSpotifyAPI(`/playlists/${playlistId}`);
      const playlistTracks = fullInfo?.tracks;
      if (playlistTracks?.items) {
        tracks = playlistTracks.items
          .slice(0, MAX_TRACKS)
          .map((item) => {
            const t = item.track || item.item;
            if (!t) return null;
            const artist = t.artists?.[0]?.name || "";
            return `${t.name} ${artist}`;
          })
          .filter(Boolean);
      }
    }

    if (tracks.length === 0) return null;

    const result = { type: "PLAYLIST", name: info.name, tracks };
    _setPlaylistCache(cacheKey, result);
    return result;
  }

  return null;
}

/**
 * Resolve array of string queries ke Kazagumo tracks via YouTube search (paralel).
 */
async function searchYouTubeForSpotify(kazagumo, spotifyResult, requester) {
  if (!spotifyResult?.tracks?.length) return null;

  const queries = spotifyResult.tracks;
  const resolvedTracks = [];
  const MAX_RETRIES = 2;
  const BATCH_SIZE = 15; // Batch size yang lebih optimal

  for (let i = 0; i < queries.length; i += BATCH_SIZE) {
    const batch = queries.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (query) => {
        let attempts = 0;
        let result = null;

        // Cek cache YouTube dulu
        const cacheKey = `yt:${query}`;
        const cached = _getYoutubeCache(cacheKey);
        if (cached) {
          return cached;
        }

        while (attempts < MAX_RETRIES && !result) {
          try {
            const res = await kazagumo.search(query, { requester });
            result = res?.tracks?.length > 0 ? res.tracks[0] : null;
          } catch (e) {
            attempts++;
            if (attempts < MAX_RETRIES) {
              log.warn(`[Spotify→YT] Gagal resolve (attempt ${attempts}/${MAX_RETRIES}):`, query);
              await new Promise(resolve => setTimeout(resolve, 1000 * attempts)); // Exponential backoff
            } else {
              log.warn("[Spotify→YT] Gagal resolve setelah retries:", query);
            }
          }
        }

        // Simpan ke cache jika berhasil
        if (result) {
          _setYoutubeCache(cacheKey, result);
        }

        return result;
      })
    );
    resolvedTracks.push(...results.filter(Boolean));
  }

  if (resolvedTracks.length === 0) return null;

  return spotifyResult.type === "PLAYLIST"
    ? { type: "PLAYLIST", playlistName: spotifyResult.name, tracks: resolvedTracks }
    : { type: "SEARCH", tracks: resolvedTracks };
}

module.exports = { resolveSpotifyUrl, searchYouTubeForSpotify, scrapePlaylistTracks, resolvePlaylistViaTrackUrls, resolveRemainingTracks };

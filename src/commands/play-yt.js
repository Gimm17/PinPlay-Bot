const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { config } = require("../config");
const { getGuildSettings, setGuildSettings } = require("../utils/storage");
const { getPlayer } = require("../utils/player");
const { Colors } = require("../utils/colors");
const {
  scrapePlaylistTracks,
  resolveRemainingTracksYouTube,
  resolveSpotifyUrl,
} = require("../utils/spotify");
const { validateQuery } = require("../utils/validation");
const { makeLogger } = require("../utils/logger");
const { errorEmbed, infoEmbed } = require("../utils/embeds");

const log = makeLogger(config.logLevel);

function isSpotifyUrl(url) {
  return /^https?:\/\/(open\.)?spotify\.com\//i.test(url);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("play-yt")
    .setDescription("Play lagu/playlist — semua di-resolve via YouTube (bebas rate limit)")
    .addStringOption((opt) =>
      opt
        .setName("query")
        .setDescription("URL atau judul lagu (Spotify link juga bisa, auto YouTube)")
        .setRequired(true)
    ),

  async execute(interaction, clientArg) {
    const client = clientArg || interaction.client;
    const rawQuery = interaction.options.getString("query", true);

    const { valid, sanitized: query, error } = validateQuery(rawQuery);
    if (!valid) {
      return interaction.reply({ embeds: [errorEmbed(`❌ ${error}`)], flags: 64 });
    }

    const settings = getGuildSettings(interaction.guildId);

    if (settings.requestChannelId && interaction.channelId !== settings.requestChannelId) {
      return interaction.reply({
        embeds: [errorEmbed(`❌ Command music hanya boleh dipakai di <#${settings.requestChannelId}>`)],
        flags: 64,
      });
    }

    const vc = interaction.member?.voice?.channel;
    if (!vc) {
      return interaction.reply({
        embeds: [errorEmbed("❌ Kamu harus **join voice channel** dulu.")],
        flags: 64,
      });
    }

    try {
      await interaction.deferReply();
    } catch {
      return;
    }

    // === Player setup ===
    let player = getPlayer(client, interaction.guildId);
    if (!player) {
      player = await client.kazagumo.createPlayer({
        guildId: interaction.guildId,
        voiceId: vc.id,
        textId: interaction.channelId,
        volume: settings.volume ?? config.defaults.volume,
        deaf: true,
      });
    } else {
      if (player.voiceId !== vc.id) {
        await player.setVoiceChannel(vc.id);
      }
      player.textId = interaction.channelId;
    }

    // =============================================
    //  CASE 1: Spotify URL → YouTube-only resolve
    // =============================================
    if (isSpotifyUrl(query)) {
      const isPlaylist = /\/playlist\//.test(query);
      const isAlbum = /\/album\//.test(query);
      const playlistIdMatch = query.match(/playlist\/([a-zA-Z0-9]+)/);

      // --- Spotify PLAYLIST → scrape + YouTube search ---
      if (isPlaylist && playlistIdMatch) {
        const playlistId = playlistIdMatch[1];
        await interaction.editReply({ content: null, embeds: [infoEmbed("⏳ Memuat playlist via YouTube...")] });
        log.info(`[PlayYT] Spotify playlist: ${playlistId}, resolving via YouTube`);

        const scraped = await scrapePlaylistTracks(playlistId);
        if (!scraped || scraped.tracks.length === 0) {
          return interaction.editReply(
            "❌ Gagal memuat playlist dari Spotify.\n" +
            "Pastikan playlist bersifat **publik**."
          );
        }

        const totalTracks = scraped.tracks.length;

        // Resolve track PERTAMA via YouTube search → langsung play
        const first = scraped.tracks[0];
        let firstTrack = null;
        try {
          const searchQ = `${first.name} ${first.artist}`.trim();
          const firstRes = await client.kazagumo.search(searchQ, {
            requester: interaction.user,
          });
          firstTrack = firstRes?.tracks?.[0] || null;
        } catch { /* ignore */ }

        if (!firstTrack) {
          return interaction.editReply(
            "❌ Gagal menemukan track pertama di YouTube.\n" +
            "Coba lagu lain atau gunakan `.p` untuk resolve via Spotify."
          );
        }

        player.queue.add(firstTrack);
        if (!player.playing && !player.paused) player.play();
        setGuildSettings(interaction.guildId, { textChannelId: interaction.channelId });

        try {
          const { updatePanel } = require("../music/panel");
          await updatePanel(client, interaction.guildId);
        } catch { /* ignore */ }

        const remainingCount = totalTracks - 1;
        const embed = new EmbedBuilder()
          .setTitle("Playlist Spotify → YouTube ✅")
          .setColor(Colors.QUEUED)
          .setDescription(
            `🎵 **${firstTrack.title}** sedang diputar!\n` +
            `📂 Playlist: **${scraped.name}** (${totalTracks} tracks)\n` +
            `⏳ Loading **${remainingCount}** lagu via YouTube di background...`
          );

        await interaction.editReply({ embeds: [embed] });

        // Background load sisa tracks via YouTube
        if (remainingCount > 0) {
          const remaining = scraped.tracks.slice(1);
          resolveRemainingTracksYouTube(
            client,
            interaction.guildId,
            remaining,
            interaction.user
          );
        }
        return;
      }

      // --- Spotify ALBUM → scrape embed + YouTube search ---
      if (isAlbum) {
        await interaction.editReply({ content: null, embeds: [infoEmbed("⏳ Memuat album via YouTube...")] });
        log.info(`[PlayYT] Spotify album, resolving via YouTube`);

        const albumIdMatch = query.match(/album\/([a-zA-Z0-9]+)/);
        let albumTracks = null;

        // Coba scrape embed page dulu (tanpa API)
        if (albumIdMatch) {
          albumTracks = await _scrapeAlbumTracks(albumIdMatch[1]);
        }

        // Fallback ke Spotify API kalau scrape gagal
        if (!albumTracks || albumTracks.tracks.length === 0) {
          const spotifyData = await resolveSpotifyUrl(query).catch(() => null);
          if (spotifyData && spotifyData.tracks?.length > 0) {
            albumTracks = {
              name: spotifyData.name || "Album",
              tracks: spotifyData.tracks.map((q) => ({ query: q })),
            };
          }
        }

        if (!albumTracks || albumTracks.tracks.length === 0) {
          return interaction.editReply({ content: null, embeds: [errorEmbed("❌ Gagal memuat album dari Spotify.")] });
        }

        const totalTracks = albumTracks.tracks.length;
        await interaction.editReply(
          `⏳ Resolving **${totalTracks} track** via YouTube...`
        );

        const resolved = await _resolveBatchYouTube(
          client.kazagumo,
          albumTracks.tracks,
          interaction.user
        );

        if (!resolved || resolved.length === 0) {
          return interaction.editReply({ content: null, embeds: [errorEmbed("❌ Gagal menemukan track di YouTube.")] });
        }

        player.queue.add(resolved);
        if (!player.playing && !player.paused) player.play();
        setGuildSettings(interaction.guildId, { textChannelId: interaction.channelId });

        try {
          const { updatePanel } = require("../music/panel");
          await updatePanel(client, interaction.guildId);
        } catch { /* ignore */ }

        const embed = new EmbedBuilder()
          .setTitle("Album → YouTube ✅")
          .setColor(Colors.QUEUED)
          .setDescription(
            `Added **${resolved.length}** of **${totalTracks}** tracks dari **${albumTracks.name}**`
          );
        return interaction.editReply({ embeds: [embed] });
      }

      // --- Spotify TRACK → YouTube search ---
      await interaction.editReply({ content: null, embeds: [infoEmbed("⏳ Mencari via YouTube...")] });
      log.info(`[PlayYT] Spotify track, resolving via YouTube`);

      // Scrape embed page untuk dapetin judul + artis (tanpa Spotify API)
      const trackIdMatch = query.match(/track\/([a-zA-Z0-9]+)/);
      let searchQ;
      if (trackIdMatch) {
        const trackInfo = await _scrapeTrackInfo(trackIdMatch[1]);
        searchQ = trackInfo
          ? `${trackInfo.name} ${trackInfo.artist}`.trim()
          : null;
      }

      // Fallback: kalau scrape gagal, coba Spotify API
      if (!searchQ) {
        const trackData = await resolveSpotifyUrl(query).catch(() => null);
        if (trackData && trackData.tracks?.length > 0) {
          searchQ = trackData.tracks[0];
        }
      }

      // Fallback terakhir: tidak bisa dapetin nama lagu
      if (!searchQ) {
        return interaction.editReply(
          "❌ Gagal mendapatkan info lagu dari Spotify (rate limit).\n" +
          "Coba lagi nanti atau gunakan `.p` sebagai alternatif."
        );
      }

      const res = await client.kazagumo
        .search(searchQ, { requester: interaction.user })
        .catch(() => null);

      if (!res || !res.tracks || res.tracks.length === 0) {
        return interaction.editReply(
          "❌ Tidak menemukan di YouTube.\n" +
          "Coba `.p` untuk resolve via Spotify langsung."
        );
      }

      player.queue.add(res.tracks[0]);
      if (!player.playing && !player.paused) player.play();
      setGuildSettings(interaction.guildId, { textChannelId: interaction.channelId });

      try {
        const { updatePanel } = require("../music/panel");
        await updatePanel(client, interaction.guildId);
      } catch { /* ignore */ }

      const embed = new EmbedBuilder()
        .setTitle("Queued ✅")
        .setColor(Colors.QUEUED)
        .setDescription(
          `Added **${res.tracks[0].title}** by **${res.tracks[0].author || "Unknown"}**`
        );
      return interaction.editReply({ embeds: [embed] });
    }

    // =============================================
    //  CASE 2: Bukan Spotify → YouTube search biasa
    // =============================================
    // Kazagumo otomatis search YouTube kalau bukan URL,
    // jadi langsung pass plain text saja.
    const searchQuery = query;

    const res = await client.kazagumo
      .search(searchQuery, { requester: interaction.user })
      .catch(() => null);

    if (!res || !res.tracks || res.tracks.length === 0) {
      return interaction.editReply({ content: null, embeds: [errorEmbed("❌ Tidak menemukan hasil.")] });
    }

    if (res.type === "PLAYLIST") {
      player.queue.add(res.tracks);
    } else {
      player.queue.add(res.tracks[0]);
    }

    if (!player.playing && !player.paused) player.play();
    setGuildSettings(interaction.guildId, { textChannelId: interaction.channelId });

    const embed = new EmbedBuilder()
      .setTitle("Queued ✅")
      .setColor(Colors.QUEUED)
      .setDescription(
        res.type === "PLAYLIST"
          ? `Added **${res.tracks.length}** tracks from **${res.playlistName || "playlist"}**`
          : `Added **${res.tracks[0].title}** by **${res.tracks[0].author || "Unknown"}**`
      );

    return interaction.editReply({ embeds: [embed] });
  },
};

/**
 * Scrape Spotify embed page untuk dapetin judul + artis dari track ID.
 * Tidak butuh Spotify API — hanya fetch HTML embed page.
 * @returns {{ name: string, artist: string } | null}
 */
async function _scrapeTrackInfo(trackId) {
  try {
    const url = `https://open.spotify.com/embed/track/${trackId}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;

    const html = await res.text();
    const nextDataMatch = html.match(
      /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/
    );
    if (!nextDataMatch) return null;

    const jsonData = JSON.parse(nextDataMatch[1]);
    const entity =
      jsonData?.props?.pageProps?.state?.data?.entity;

    if (!entity) return null;

    const name = entity.name || entity.title || "";
    const artist = entity.artists?.[0]?.name || entity.artistName || "";
    if (!name) return null;

    return { name, artist };
  } catch {
    return null;
  }
}

/**
 * Scrape Spotify embed page untuk dapetin track list dari album ID.
 * Tidak butuh Spotify API — hanya fetch HTML embed page.
 * @returns {{ name: string, tracks: Array<{query: string}> } | null}
 */
async function _scrapeAlbumTracks(albumId) {
  try {
    const url = `https://open.spotify.com/embed/album/${albumId}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;

    const html = await res.text();
    const nextDataMatch = html.match(
      /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/
    );
    if (!nextDataMatch) return null;

    const jsonData = JSON.parse(nextDataMatch[1]);
    const state = jsonData?.props?.pageProps?.state;
    const entity = state?.data?.entity;

    if (!entity) return null;

    const albumName = entity.name || entity.title || "Album";
    const trackList = entity.trackList || entity.tracks;

    if (!Array.isArray(trackList) || trackList.length === 0) return null;

    const tracks = [];
    for (const item of trackList) {
      const name = item.title || item.name || "";
      const artist = item.artists?.[0]?.name || item.artistName || "";
      if (name) {
        tracks.push({ query: `${name} ${artist}`.trim() });
      }
    }

    if (tracks.length === 0) return null;
    return { name: albumName, tracks };
  } catch {
    return null;
  }
}

/**
 * Helper: resolve batch of { query: "title artist" } ke Kazagumo tracks via YouTube.
 * Dipakai untuk album dimana kita sudah punya "Title Artist" strings.
 */
async function _resolveBatchYouTube(kazagumo, items, requester) {
  const BATCH_SIZE = 5;
  const MAX_RETRIES = 2;
  const resolved = [];

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (item) => {
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          try {
            const res = await kazagumo.search(item.query, { requester });
            if (res?.tracks?.length > 0) return res.tracks[0];
          } catch {
            if (attempt < MAX_RETRIES - 1) {
              await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
            }
          }
        }
        return null;
      })
    );
    resolved.push(...results.filter(Boolean));

    // Delay antar batch
    if (i + BATCH_SIZE < items.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  return resolved;
}

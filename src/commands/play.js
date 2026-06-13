const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { config } = require("../config");
const { getGuildSettings, setGuildSettings } = require("../utils/storage");
const { getPlayer } = require("../utils/player");
const { Colors } = require("../utils/colors");
const { resolveSpotifyUrl, searchYouTubeForSpotify, scrapePlaylistTracks, resolvePlaylistViaTrackUrls, resolveRemainingTracks } = require("../utils/spotify");
const { validateQuery } = require("../utils/validation");
const { makeLogger } = require("../utils/logger");
const { errorEmbed } = require("../utils/embeds");

const log = makeLogger(config.logLevel);

function isSpotifyUrl(url) {
  return /^https?:\/\/(open\.)?spotify\.com\//i.test(url);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("play")
    .setDescription("Tambah lagu / playlist dari link atau judul (auto search)")
    .addStringOption((opt) =>
      opt
        .setName("query")
        .setDescription("URL atau judul lagu (contoh: 'Blinding Lights')")
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

    // optional: batasi command hanya di channel tertentu
    if (settings.requestChannelId && interaction.channelId !== settings.requestChannelId) {
      return interaction.reply({
        embeds: [errorEmbed(`❌ Command music hanya boleh dipakai di <#${settings.requestChannelId}>`)],
        flags: 64,
      });
    }

    // Check voice BEFORE deferring
    const vc = interaction.member?.voice?.channel;
    if (!vc) {
      return interaction.reply({
        embeds: [errorEmbed("❌ Kamu harus **join voice channel** dulu.")],
        flags: 64,
      });
    }

    // DEFER IMMEDIATELY — Discord only gives 3 seconds
    try {
      await interaction.deferReply();
    } catch {
      // If deferReply itself fails (interaction already expired), bail out silently
      return;
    }

    // Check if it's a Spotify playlist (will be processed via API fallback)
    const isSpotifyPlaylist = isSpotifyUrl(query) && query.includes("/playlist/");
    let totalTracks = 0;
    let processedTracks = 0;

    // create player (or reuse)
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

    // Search — LavaSrc menangani URL Spotify langsung, bot hanya sebagai fallback
    let res;

    if (isSpotifyUrl(query)) {
      // Cek apakah ini playlist Spotify — kalau ya, skip LavaSrc langsung
      // karena LavaSrc punya issue #255 (playlist 401)
      const isPlaylist = /\/playlist\//.test(query);
      const playlistIdMatch = query.match(/playlist\/([a-zA-Z0-9]+)/);

      if (isPlaylist && playlistIdMatch) {
        // PLAYLIST: Play first track ASAP, load rest in background
        const playlistId = playlistIdMatch[1];
        await interaction.editReply("⏳ Memuat playlist Spotify...");
        log.info(`[Play] Spotify playlist detected: ${playlistId}, using scrape+play-first`);

        const scraped = await scrapePlaylistTracks(playlistId);
        if (!scraped || scraped.tracks.length === 0) {
          return interaction.editReply(
            "❌ Gagal memuat playlist dari Spotify.\n" +
            "Pastikan playlist bersifat **publik**."
          );
        }

        totalTracks = scraped.tracks.length;

        // Step 1: Resolve track PERTAMA saja → langsung play
        const firstTrackInfo = scraped.tracks[0];
        let firstTrack = null;
        try {
          const firstRes = await client.kazagumo.search(firstTrackInfo.url, { requester: interaction.user });
          firstTrack = firstRes?.tracks?.[0] || null;
        } catch { /* ignore */ }

        if (!firstTrack) {
          return interaction.editReply("❌ Gagal memuat track pertama dari playlist.");
        }

        player.queue.add(firstTrack);
        if (!player.playing && !player.paused) player.play();
        setGuildSettings(interaction.guildId, { textChannelId: interaction.channelId });

        // Update panel
        try {
          const { updatePanel } = require("../music/panel");
          await updatePanel(client, interaction.guildId);
        } catch { /* ignore */ }

        const remainingCount = totalTracks - 1;
        const embed = new EmbedBuilder()
          .setTitle("Playlist Spotify ✅")
          .setColor(Colors.QUEUED)
          .setDescription(
            `🎵 **${firstTrack.title}** sedang diputar!\n` +
            `📂 Playlist: **${scraped.name}** (${totalTracks} tracks)\n` +
            `⏳ Loading **${remainingCount}** lagu lainnya di background...`
          );

        await interaction.editReply({ embeds: [embed] });

        // Step 2: Fire-and-forget — load sisa tracks di background
        if (remainingCount > 0) {
          const remaining = scraped.tracks.slice(1);
          resolveRemainingTracks(client, interaction.guildId, remaining, interaction.user);
        }

        return; // Selesai — interaction sudah di-reply, music sudah play
      } else {
        // TRACK / ALBUM: Langsung pakai LavaSrc (works fine)
        await interaction.editReply("⏳ Memuat dari Spotify...");
        res = await client.kazagumo.search(query, { requester: interaction.user }).catch(() => null);

        // Fallback ke Spotify API kalau LavaSrc gagal untuk album
        if (!res || !res.tracks || res.tracks.length === 0) {
          if (config.spotify?.clientId && config.spotify?.clientSecret) {
            await interaction.editReply("⏳ Mencoba via Spotify API...");
            const spotifyData = await resolveSpotifyUrl(query);
            if (spotifyData && spotifyData.tracks.length > 0) {
              await interaction.editReply(`⏳ Resolving **${spotifyData.tracks.length} track**...`);
              res = await searchYouTubeForSpotify(client.kazagumo, spotifyData, interaction.user);
            }
          }

          if (!res || !res.tracks || res.tracks.length === 0) {
            return interaction.editReply("❌ Gagal memuat dari Spotify.");
          }
        }
      }
    } else {
      // Search biasa (judul lagu / URL YouTube / dll) — cek cache dulu
      res = client.searchCache ? client.searchCache.get(query) : null;
      if (!res) {
        res = await client.kazagumo.search(query, { requester: interaction.user });
        if (res && res.tracks && res.tracks.length > 0 && client.searchCache) {
          client.searchCache.set(query, res);
        }
      }
    }

    if (!res || !res.tracks || res.tracks.length === 0) {
      return interaction.editReply("❌ Tidak menemukan hasil.");
    }

    if (res.type === "PLAYLIST") {
      player.queue.add(res.tracks);
    } else {
      player.queue.add(res.tracks[0]);
    }

    if (!player.playing && !player.paused) player.play();

    // simpan last text channel buat 24/7 restore
    setGuildSettings(interaction.guildId, { textChannelId: interaction.channelId });

    // Tampilkan progress final untuk playlist besar
    if (totalTracks > 0 && processedTracks > 0) {
      const embed = new EmbedBuilder()
        .setTitle("Queued ✅")
        .setColor(Colors.QUEUED)
        .setDescription(
          `Added **${processedTracks}** of **${totalTracks}** tracks from **${res.playlistName || res.data?.info?.name || "playlist"}**`
        );
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle("Queued ✅")
      .setColor(Colors.QUEUED)
      .setDescription(
        res.type === "PLAYLIST"
          ? `Added **${res.tracks.length}** tracks from **${res.playlistName || res.data?.info?.name || "playlist"}**`
          : `Added **${res.tracks[0].title}** by **${res.tracks[0].author || "Unknown"}**`
      );

    return interaction.editReply({ embeds: [embed] });
  },
};

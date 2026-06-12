const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
} = require("discord.js");

const { config } = require("../config");
const { getGuildSettings, setGuildSettings } = require("../utils/storage");
const { requireControl, requireVoiceForPlay } = require("../utils/permissions");
const { getPlayer, getCurrentTrack, getUpcomingTracks } = require("../utils/player");
const { updatePanel } = require("./panel");
const { formatMs } = require("../utils/format");
const { Colors } = require("../utils/colors");
const { resolveSpotifyUrl, searchYouTubeForSpotify } = require("../utils/spotify");
const { validateQuery } = require("../utils/validation");
const { getHistory } = require("../commands/history");

async function handlePanelButton(interaction, client) {
  const id = interaction.customId;
  if (!id.startsWith("pinplay:")) return false;

  const action = id.split(":")[1];
  const guildId = interaction.guildId;
  const settings = getGuildSettings(guildId);
  const player = getPlayer(client, guildId);

  // Button Add -> bebas untuk semua orang (tetap wajib VC)
  if (action === "add") {
    const vc = await requireVoiceForPlay(interaction);
    if (!vc) return true;

    const modal = new ModalBuilder()
      .setCustomId("pinplay:addModal")
      .setTitle("Add Song / Playlist");

    const input = new TextInputBuilder()
      .setCustomId("query")
      .setLabel("Judul atau link (YouTube/Spotify)")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(input));

    await interaction.showModal(modal).catch(() => null);
    return true;
  }

  // Queue button — read-only, accessible to everyone (like /queue command)
  if (action === "queue") {
    await interaction.deferUpdate().catch(() => null);

    const current = getCurrentTrack(player);
    const upcoming = getUpcomingTracks(player).slice(0, 10);

    const embed = new EmbedBuilder()
      .setTitle("📜 Queue (Top 10)")
      .setDescription(
        current
          ? `**Now Playing:** ${current.title}`
          : upcoming.length
          ? "**Now Playing:** (buffering...)"
          : "Tidak ada lagu."
      );

    if (upcoming.length) {
      embed.addFields({
        name: "Up Next",
        value: upcoming.map((t, i) => `\`${i + 1}.\` ${t.title} ${t.length ? `• \`${formatMs(t.length)}\`` : ""}`).join("\n"),
      });
    } else {
      embed.addFields({ name: "Up Next", value: "Kosong." });
    }

    await interaction.followUp({ embeds: [embed], flags: 64 }).catch(() => null);
    return true;
  }

  if (action === "history") {
    await interaction.deferReply({ flags: 64 }).catch(() => null);
    const hist = getHistory(guildId);
    
    if (hist.length === 0) {
      await interaction.editReply("📭 Belum ada riwayat lagu yang diputar.");
      return true;
    }

    const list = hist.slice(0, 15).map((h, i) => {
      const dur = h.length ? ` • \`${formatMs(h.length)}\`` : "";
      const title = h.uri ? `[${h.title}](${h.uri})` : h.title;
      return `\`${i + 1}.\` ${title}${dur}`;
    }).join("\n");

    const embed = new EmbedBuilder()
      .setTitle("📜 Song History (Last 15)")
      .setDescription(list)
      .setColor(Colors.INFO);

    await interaction.editReply({ embeds: [embed] }).catch(() => null);
    return true;
  }

  if (action === "lyrics") {
    await interaction.deferReply({ flags: 64 }).catch(() => null);
    const current = getCurrentTrack(player);
    if (!current) {
      await interaction.editReply("❌ Tidak ada lagu yang sedang diputar.");
      return true;
    }

    let query = (current.title || "")
      .replace(/\(.*?\)/g, "")
      .replace(/\[.*?\]/g, "")
      .replace(/official|video|audio|lyrics|hd|hq|mv/gi, "")
      .trim();

    if (current.author) query = `${current.author} ${query}`;

    try {
      const encoded = encodeURIComponent(query);
      const res = await fetch(`https://lrclib.net/api/search?q=${encoded}`);
      
      if (!res.ok) {
        await interaction.editReply("❌ Gagal mengambil lirik. Coba lagi nanti.");
        return true;
      }

      const data = await res.json();
      if (!data || data.length === 0) {
        await interaction.editReply(`❌ Lirik tidak ditemukan untuk: **${query}**`);
        return true;
      }

      const best = data[0];
      const lyrics = best.plainLyrics || best.syncedLyrics || "Lirik tidak tersedia.";
      const trimmed = lyrics.length > 3900
        ? lyrics.slice(0, 3900) + "\n\n*... (lirik terlalu panjang, terpotong)*"
        : lyrics;

      const embed = new EmbedBuilder()
        .setTitle(`🎤 ${best.trackName || query}`)
        .setDescription(trimmed)
        .setColor(Colors.INFO);

      if (best.artistName) embed.setAuthor({ name: best.artistName });
      await interaction.editReply({ embeds: [embed] }).catch(() => null);
    } catch (e) {
      await interaction.editReply(`❌ Error: ${e?.message || e}`).catch(() => null);
    }
    return true;
  }

  // selain Add & Queue -> kontrol (restricted/all + same VC)
  const ok = await requireControl(interaction, player, settings);
  if (!ok) return true;

  // biar tombol nggak "failed" -> kita pakai deferUpdate
  await interaction.deferUpdate().catch(() => null);

  try {
    if (action === "toggle") {
      player.pause(!player.paused);
    } else if (action === "next") {
      await player.skip();
    } else if (action === "stop") {
      player.queue.clear();
      await player.skip();
    } else if (action === "shuffle") {
      player.queue.shuffle();
    } else if (action === "loop") {
      const cur = player.loop || "none";
      const next = cur === "none" ? "track" : cur === "track" ? "queue" : "none";
      await player.setLoop(next);
    } else if (action === "volup") {
      const next = Math.min(100, (player.volume ?? 80) + 10);
      await player.setVolume(next);
      setGuildSettings(guildId, { volume: next });
    } else if (action === "voldown") {
      const next = Math.max(0, (player.volume ?? 80) - 10);
      await player.setVolume(next);
      setGuildSettings(guildId, { volume: next });
    } else if (action === "prev") {
      const prev = player.getPrevious();

      if (!prev) {
        await interaction.followUp({ content: "❌ Tidak ada track sebelumnya.", flags: 64 }).catch(() => null);
      } else {
        // Use queue.add to properly trigger internal state tracking,
        // then move the added track to position 0 via splice, then skip.
        player.queue.add(prev);
        const lastIdx = player.queue.length - 1;
        if (lastIdx > 0) {
          const [moved] = player.queue.splice(lastIdx, 1);
          player.queue.splice(0, 0, moved);
        }
        await player.skip();
      }
    }
  } catch (e) {
    await interaction.followUp({ content: `❌ Error: ${e?.message || e}`, flags: 64 }).catch(() => null);
  }

  // update panel setelah aksi
  await updatePanel(client, guildId);

  return true;
}

async function handleAddModal(interaction, client) {
  if (interaction.customId !== "pinplay:addModal") return false;

  const rawQuery = interaction.fields.getTextInputValue("query");
  const { valid, sanitized: query, error } = validateQuery(rawQuery);
  if (!valid) {
    await interaction.reply({ content: `❌ ${error}`, flags: 64 }).catch(() => null);
    return true;
  }

  const guildId = interaction.guildId;
  const settings = getGuildSettings(guildId);

  // optional request channel restriction
  if (settings.requestChannelId && interaction.channelId !== settings.requestChannelId) {
    await interaction.reply({
      content: `❌ Add song hanya boleh di <#${settings.requestChannelId}>`,
      flags: 64,
    }).catch(() => null);
    return true;
  }

  const vc = await requireVoiceForPlay(interaction);
  if (!vc) return true;

  await interaction.deferReply({ flags: 64 }).catch(() => null);

  let player = getPlayer(client, guildId);
  if (!player) {
    player = await client.kazagumo.createPlayer({
      guildId,
      voiceId: vc.id,
      textId: interaction.channelId,
      volume: settings.volume ?? config.defaults.volume,
      deaf: true,
    });
  } else {
    if (player.voiceId !== vc.id) await player.setVoiceChannel(vc.id);
    player.textId = interaction.channelId;
  }

  let res;
  const isSpotify = /^https?:\/\/(open\.)?spotify\.com\//i.test(query);

  if (isSpotify) {
    // Langsung kasih ke LavaSrc
    await interaction.editReply("⏳ Memuat dari Spotify...").catch(() => null);
    res = await client.kazagumo.search(query, { requester: interaction.user }).catch(() => null);

    // Fallback ke Spotify API bot jika LavaSrc gagal
    if (!res || !res.tracks || res.tracks.length === 0) {
      if (config.spotify?.clientId && config.spotify?.clientSecret) {
        const spotifyData = await resolveSpotifyUrl(query);
        if (spotifyData && spotifyData.tracks.length > 0) {
          await interaction.editReply(`⏳ Resolving **${spotifyData.tracks.length} track**...`).catch(() => null);
          res = await searchYouTubeForSpotify(client.kazagumo, spotifyData, interaction.user);
        }
      }

      if (!res || !res.tracks || res.tracks.length === 0) {
        await interaction.editReply("❌ Gagal memuat dari Spotify. Pastikan playlist/album bersifat **publik**.").catch(() => null);
        return true;
      }
    }
  } else {
    res = client.searchCache ? client.searchCache.get(query) : null;
    if (!res) {
      res = await client.kazagumo.search(query, { requester: interaction.user });
      if (res && res.tracks && res.tracks.length > 0 && client.searchCache) {
        client.searchCache.set(query, res);
      }
    }
  }

  if (!res || !res.tracks || res.tracks.length === 0) {
    await interaction.editReply("❌ Tidak menemukan hasil.").catch(() => null);
    return true;
  }

  if (res.type === "PLAYLIST") player.queue.add(res.tracks);
  else player.queue.add(res.tracks[0]);

  if (!player.playing && !player.paused) player.play();

  setGuildSettings(guildId, { textChannelId: interaction.channelId });

  await interaction.editReply(
    res.type === "PLAYLIST"
      ? `✅ Added **${res.tracks.length}** tracks dari playlist.`
      : `✅ Added **${res.tracks[0].title}**`
  ).catch(() => null);

  await updatePanel(client, guildId);

  return true;
}

module.exports = { handlePanelButton, handleAddModal };

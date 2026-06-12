const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { Colors } = require("../utils/colors");
const { validateQuery } = require("../utils/validation");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("lyrics")
    .setDescription("Cari lirik lagu")
    .addStringOption((opt) =>
      opt
        .setName("query")
        .setDescription("Judul lagu (kosongkan untuk lagu yang sedang diputar)")
        .setRequired(false)
    ),

  async execute(interaction, clientArg) {
    const client = clientArg || interaction.client;
    let query = interaction.options.getString("query");

    // If no query, use currently playing track
    if (!query) {
      const { getPlayer, getCurrentTrack } = require("../utils/player");
      const player = getPlayer(client, interaction.guildId);
      const current = getCurrentTrack(player);
      if (!current) {
        return interaction.reply({
          content: "❌ Tidak ada lagu yang sedang diputar. Gunakan `/lyrics query:<judul>`.",
          flags: 64,
        });
      }
      // Clean up the title: remove things like (Official Video), [Lyrics], etc.
      query = (current.title || "")
        .replace(/\(.*?\)/g, "")
        .replace(/\[.*?\]/g, "")
        .replace(/official|video|audio|lyrics|hd|hq|mv/gi, "")
        .trim();

      if (current.author) {
        query = `${current.author} ${query}`;
      }
    } else {
      const { valid, sanitized, error } = validateQuery(query);
      if (!valid) {
        return interaction.reply({ content: `❌ ${error}`, flags: 64 });
      }
      query = sanitized;
    }

    await interaction.deferReply({ flags: 64 });

    try {
      // Use lrclib.net — free, no API key needed
      const encoded = encodeURIComponent(query);
      const res = await fetch(`https://lrclib.net/api/search?q=${encoded}`);

      if (!res.ok) {
        return interaction.editReply("❌ Gagal mengambil lirik. Coba lagi nanti.");
      }

      const data = await res.json();

      if (!data || data.length === 0) {
        return interaction.editReply(`❌ Lirik tidak ditemukan untuk: **${query}**`);
      }

      const best = data[0];
      const lyrics = best.plainLyrics || best.syncedLyrics || "Lirik tidak tersedia.";

      // Discord embed has a 4096 char limit for description
      const trimmed = lyrics.length > 3900
        ? lyrics.slice(0, 3900) + "\n\n*... (lirik terlalu panjang, terpotong)*"
        : lyrics;

      const embed = new EmbedBuilder()
        .setTitle(`🎤 ${best.trackName || query}`)
        .setDescription(trimmed)
        .setColor(Colors.INFO);

      if (best.artistName) embed.setAuthor({ name: best.artistName });
      if (best.albumName) embed.setFooter({ text: `Album: ${best.albumName}` });

      return interaction.editReply({ embeds: [embed] });
    } catch (e) {
      return interaction.editReply(`❌ Error: ${e?.message || e}`);
    }
  },
};

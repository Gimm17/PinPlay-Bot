const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require("discord.js");
const { config } = require("../config");
const { getGuildSettings, setGuildSettings } = require("../utils/storage");
const { requireVoiceForPlay } = require("../utils/permissions");
const { getPlayer } = require("../utils/player");
const { Colors } = require("../utils/colors");
const { validateQuery } = require("../utils/validation");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("search")
    .setDescription("Cari lagu dan pilih dari daftar hasil (top 5)")
    .addStringOption((opt) =>
      opt
        .setName("query")
        .setDescription("Judul lagu yang dicari")
        .setRequired(true)
    ),

  async execute(interaction, clientArg) {
    const client = clientArg || interaction.client;
    const rawQuery = interaction.options.getString("query", true);

    const { valid, sanitized: query, error } = validateQuery(rawQuery);
    if (!valid) {
      return interaction.reply({ content: `❌ ${error}`, flags: 64 });
    }

    const settings = getGuildSettings(interaction.guildId);

    if (settings.requestChannelId && interaction.channelId !== settings.requestChannelId) {
      return interaction.reply({
        content: `❌ Command music hanya boleh dipakai di <#${settings.requestChannelId}>`,
        flags: 64,
      });
    }

    const vc = interaction.member?.voice?.channel;
    if (!vc) {
      return interaction.reply({
        content: "❌ Kamu harus **join voice channel** dulu.",
        flags: 64,
      });
    }

    await interaction.deferReply({ flags: 64 });

    let res = client.searchCache ? client.searchCache.get(query) : null;
    if (!res) {
      res = await client.kazagumo.search(query, { requester: interaction.user });
      if (res && res.tracks && res.tracks.length > 0 && client.searchCache) {
        client.searchCache.set(query, res);
      }
    }

    if (!res || !res.tracks || res.tracks.length === 0) {
      return interaction.editReply("❌ Tidak menemukan hasil.");
    }

    const tracks = res.tracks.slice(0, 5);

    const embed = new EmbedBuilder()
      .setTitle("🔍 Hasil Pencarian")
      .setDescription(`Hasil untuk: **${query}**\n\nPilih lagu dari menu di bawah:`)
      .setColor(Colors.INFO);

    const options = tracks.map((t, i) => ({
      label: (t.title || "Unknown").slice(0, 100),
      description: `${t.author || "Unknown"} • ${t.length ? Math.floor(t.length / 1000) + "s" : "?"}`.slice(0, 100),
      value: `search_pick:${i}`,
    }));

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId("pinplay:search_select")
      .setPlaceholder("Pilih lagu...")
      .addOptions(options);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    // Store search results temporarily on the client (keyed by interaction user + guild)
    if (!client._searchCache) client._searchCache = new Map();
    const cacheKey = `${interaction.user.id}:${interaction.guildId}`;
    client._searchCache.set(cacheKey, { tracks, voiceId: vc.id, channelId: interaction.channelId });

    // Auto-expire cache after 60s
    setTimeout(() => client._searchCache.delete(cacheKey), 60_000);

    return interaction.editReply({ embeds: [embed], components: [row] });
  },
};

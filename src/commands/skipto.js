const { SlashCommandBuilder } = require("discord.js");
const { getGuildSettings } = require("../utils/storage");
const { requireControl } = require("../utils/permissions");
const { getPlayer, getUpcomingTracks } = require("../utils/player");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("skipto")
    .setDescription("Loncat ke posisi tertentu di queue, skip semua sebelumnya")
    .addIntegerOption((opt) =>
      opt
        .setName("position")
        .setDescription("Posisi lagu di queue yang ingin diputar (1, 2, 3, ...)")
        .setRequired(true)
        .setMinValue(1)
    ),

  async execute(interaction, clientArg) {
    const client = clientArg || interaction.client;
    const player = getPlayer(client, interaction.guildId);
    const settings = getGuildSettings(interaction.guildId);

    const ok = await requireControl(interaction, player, settings);
    if (!ok) return;

    const pos = interaction.options.getInteger("position", true);
    const upcoming = getUpcomingTracks(player);

    if (pos < 1 || pos > upcoming.length) {
      return interaction.reply({
        content: `❌ Posisi tidak valid. Queue punya **${upcoming.length}** lagu.`,
        flags: 64,
      });
    }

    // Remove all tracks before the target position
    if (pos > 1) {
      player.queue.splice(0, pos - 1);
    }

    const target = getUpcomingTracks(player)[0];
    await player.skip();

    return interaction.reply({
      content: `⏭️ Melompat ke posisi **${pos}**: **${target?.title || "Unknown"}**`,
      flags: 64,
    });
  },
};

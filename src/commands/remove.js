const { SlashCommandBuilder } = require("discord.js");
const { getGuildSettings } = require("../utils/storage");
const { requireControl } = require("../utils/permissions");
const { getPlayer, getUpcomingTracks } = require("../utils/player");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("remove")
    .setDescription("Hapus lagu dari queue berdasarkan posisi")
    .addIntegerOption((opt) =>
      opt
        .setName("position")
        .setDescription("Posisi lagu di queue (1, 2, 3, ...)")
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

    const removed = player.queue.splice(pos - 1, 1);
    const title = removed?.[0]?.title || "Unknown";

    return interaction.reply({
      content: `🗑️ Dihapus dari queue: **${title}** (posisi ${pos})`,
      flags: 64,
    });
  },
};

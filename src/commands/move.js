const { SlashCommandBuilder } = require("discord.js");
const { getGuildSettings } = require("../utils/storage");
const { requireControl } = require("../utils/permissions");
const { getPlayer, getUpcomingTracks } = require("../utils/player");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("move")
    .setDescription("Pindahkan lagu di queue dari posisi A ke posisi B")
    .addIntegerOption((opt) =>
      opt
        .setName("from")
        .setDescription("Posisi lagu yang ingin dipindahkan")
        .setRequired(true)
        .setMinValue(1)
    )
    .addIntegerOption((opt) =>
      opt
        .setName("to")
        .setDescription("Posisi tujuan")
        .setRequired(true)
        .setMinValue(1)
    ),

  async execute(interaction, clientArg) {
    const client = clientArg || interaction.client;
    const player = getPlayer(client, interaction.guildId);
    const settings = getGuildSettings(interaction.guildId);

    const ok = await requireControl(interaction, player, settings);
    if (!ok) return;

    const from = interaction.options.getInteger("from", true);
    const to = interaction.options.getInteger("to", true);
    const upcoming = getUpcomingTracks(player);
    const max = upcoming.length;

    if (from < 1 || from > max || to < 1 || to > max) {
      return interaction.reply({
        content: `❌ Posisi tidak valid. Queue punya **${max}** lagu.`,
        flags: 64,
      });
    }

    if (from === to) {
      return interaction.reply({
        content: "❌ Posisi asal dan tujuan sama.",
        flags: 64,
      });
    }

    // Remove the track from 'from' position and insert at 'to' position
    const [track] = player.queue.splice(from - 1, 1);
    player.queue.splice(to - 1, 0, track);

    return interaction.reply({
      content: `✅ Dipindahkan: **${track?.title || "Unknown"}** dari posisi **${from}** ke **${to}**`,
      flags: 64,
    });
  },
};

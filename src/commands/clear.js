const { SlashCommandBuilder } = require("discord.js");
const { getGuildSettings } = require("../utils/storage");
const { requireControl } = require("../utils/permissions");
const { getPlayer, getUpcomingTracks } = require("../utils/player");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Bersihkan queue tanpa menghentikan lagu yang sedang diputar"),

  async execute(interaction, clientArg) {
    const client = clientArg || interaction.client;
    const player = getPlayer(client, interaction.guildId);
    const settings = getGuildSettings(interaction.guildId);

    const ok = await requireControl(interaction, player, settings);
    if (!ok) return;

    const count = getUpcomingTracks(player).length;
    player.queue.clear();

    return interaction.reply({
      content: count > 0
        ? `🗑️ Queue dibersihkan (**${count}** lagu dihapus). Lagu yang sedang diputar tetap jalan.`
        : "Queue sudah kosong.",
      flags: 64,
    });
  },
};

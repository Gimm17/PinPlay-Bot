const { SlashCommandBuilder } = require("discord.js");
const { getGuildSettings } = require("../utils/storage");
const { requireControl } = require("../utils/permissions");
const { getPlayer } = require("../utils/player");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("pause")
    .setDescription("Pause lagu yang sedang diputar"),
  async execute(interaction, clientArg) {
    const client = clientArg || interaction.client;
    const player = getPlayer(client, interaction.guildId);
    const settings = getGuildSettings(interaction.guildId);

    const ok = await requireControl(interaction, player, settings);
    if (!ok) return;

    player.pause(true);
    return interaction.reply({ content: "Paused ⏸️", flags: 64 });
  }
};

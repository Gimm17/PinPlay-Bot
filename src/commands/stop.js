const { SlashCommandBuilder } = require("discord.js");
const { getGuildSettings } = require("../utils/storage");
const { requireControl } = require("../utils/permissions");
const { getPlayer } = require("../utils/player");
const { successEmbed } = require("../utils/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Stop & clear queue"),
  async execute(interaction, clientArg) {
    const client = clientArg || interaction.client;
    const player = getPlayer(client, interaction.guildId);
    const settings = getGuildSettings(interaction.guildId);

    const ok = await requireControl(interaction, player, settings);
    if (!ok) return;

    player.queue.clear();
    await player.skip();
    return interaction.reply({ embeds: [successEmbed("⏹️ **Stopped** — musik dihentikan & queue dibersihkan.")], flags: 64 });
  }
};

const { SlashCommandBuilder } = require("discord.js");
const { getGuildSettings, setGuildSettings } = require("../utils/storage");
const { requireControl } = require("../utils/permissions");
const { getPlayer } = require("../utils/player");
const { successEmbed } = require("../utils/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("leave")
    .setDescription("Suruh bot keluar dari voice (disconnect)"),
  async execute(interaction, clientArg) {
    const client = clientArg || interaction.client;
    const player = getPlayer(client, interaction.guildId);
    const settings = getGuildSettings(interaction.guildId);

    const ok = await requireControl(interaction, player, settings);
    if (!ok) return;

    // reset 24/7
    setGuildSettings(interaction.guildId, { stay247: false, voiceChannelId: null, textChannelId: null });

    player.queue.clear();
    await player.destroy();

    return interaction.reply({ embeds: [successEmbed("👋 **Keluar dari voice** — sampai jumpa!")], flags: 64 });
  }
};

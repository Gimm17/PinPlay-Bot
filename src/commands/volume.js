const { SlashCommandBuilder } = require("discord.js");
const { getGuildSettings, setGuildSettings } = require("../utils/storage");
const { requireControl } = require("../utils/permissions");
const { getPlayer } = require("../utils/player");
const { validateIntRange } = require("../utils/validation");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("volume")
    .setDescription("Atur volume (0-100)")
    .addIntegerOption((opt) =>
      opt.setName("value").setDescription("0 - 100").setRequired(true)
    ),
  async execute(interaction, clientArg) {
    const client = clientArg || interaction.client;
    const player = getPlayer(client, interaction.guildId);
    const settings = getGuildSettings(interaction.guildId);

    const ok = await requireControl(interaction, player, settings);
    if (!ok) return;

    const value = interaction.options.getInteger("value", true);
    
    const { valid, error } = validateIntRange(value, 0, 100, "Volume");
    if (!valid) {
      return interaction.reply({ content: `❌ ${error}`, flags: 64 });
    }

    const vol = value;

    await player.setVolume(vol);
    setGuildSettings(interaction.guildId, { volume: vol });

    return interaction.reply({ content: `🔊 Volume set to **${vol}%**`, flags: 64 });
  }
};

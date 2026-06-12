const { SlashCommandBuilder } = require("discord.js");
const { getGuildSettings } = require("../utils/storage");
const { requireControl } = require("../utils/permissions");
const { getPlayer, getCurrentTrack } = require("../utils/player");
const { validateIntRange } = require("../utils/validation");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("seek")
    .setDescription("Loncat ke posisi tertentu (detik)")
    .addIntegerOption((opt) =>
      opt.setName("seconds").setDescription("Posisi dalam detik").setRequired(true)
    ),
  async execute(interaction, clientArg) {
    const client = clientArg || interaction.client;
    const player = getPlayer(client, interaction.guildId);
    const settings = getGuildSettings(interaction.guildId);

    const ok = await requireControl(interaction, player, settings);
    if (!ok) return;

    const current = getCurrentTrack(player);
    if (!current || !current.length) {
      return interaction.reply({ content: "❌ Track ini tidak bisa di-seek.", flags: 64 });
    }

    const sec = interaction.options.getInteger("seconds", true);
    
    const { valid, error } = validateIntRange(sec, 0, Math.floor(current.length / 1000), "Detik");
    if (!valid) {
      return interaction.reply({ content: `❌ ${error}`, flags: 64 });
    }

    const pos = sec * 1000;

    await player.seek(pos);
    return interaction.reply({ content: `⏩ Seek ke **${sec}s**`, flags: 64 });
  }
};

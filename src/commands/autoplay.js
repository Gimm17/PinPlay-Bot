// src/commands/autoplay.js
// Simple toggle: /autoplay and .autoplay both flip the per-guild autoplay state.
// No subcommands — Discord slash builders allow a command with no subcommands,
// and the prefix pipeline routes .autoplay through the "none" parser.
const { SlashCommandBuilder } = require('discord.js');
const { getAutoplayOn, setAutoplayOn } = require('../utils/autoplay');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('autoplay')
    .setDescription('Toggle autoplay (auto-add related tracks when queue ends)'),

  async execute(interaction) {
    const guildId = interaction.guildId;
    const wasOn = getAutoplayOn(guildId);
    const nowOn = !wasOn;
    setAutoplayOn(guildId, nowOn);

    return interaction.reply({
      content: nowOn
        ? '✅ **Autoplay enabled** — adding related tracks when queue ends'
        : '❌ **Autoplay disabled**',
      flags: 64, // ephemeral
    });
  },
};

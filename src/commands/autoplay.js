// src/commands/autoplay.js
const { SlashCommandBuilder } = require('discord.js');
const { getAutoplayOn, setAutoplayOn } = require('../utils/autoplay');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('autoplay')
    .setDescription('Toggle autoplay (auto-add related tracks when queue ends)')
    .addSubcommand(sub =>
      sub.setName('on').setDescription('Enable autoplay for this server')
    )
    .addSubcommand(sub =>
      sub.setName('off').setDescription('Disable autoplay for this server')
    )
    .addSubcommand(sub =>
      sub.setName('status').setDescription('Check current autoplay status')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === 'on') {
      setAutoplayOn(guildId, true);
      return interaction.reply({
        content: '✅ **Autoplay enabled** — adding related tracks when queue ends',
        flags: 64, // ephemeral
      });
    }

    if (sub === 'off') {
      setAutoplayOn(guildId, false);
      return interaction.reply({
        content: '❌ **Autoplay disabled**',
        flags: 64,
      });
    }

    if (sub === 'status') {
      const on = getAutoplayOn(guildId);
      return interaction.reply({
        content: `Autoplay is **${on ? 'ON' : 'OFF'}** for this server`,
        flags: 64,
      });
    }
  },
};

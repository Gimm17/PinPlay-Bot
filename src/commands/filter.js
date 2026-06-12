const { SlashCommandBuilder } = require("discord.js");
const { getGuildSettings } = require("../utils/storage");
const { requireControl } = require("../utils/permissions");
const { getPlayer } = require("../utils/player");

const FILTERS = {
  off: null,
  bassboost: {
    equalizer: [
      { band: 0, gain: 0.6 },
      { band: 1, gain: 0.67 },
      { band: 2, gain: 0.67 },
      { band: 3, gain: 0.0 },
      { band: 4, gain: 0.0 },
    ],
  },
  nightcore: { timescale: { speed: 1.15, pitch: 1.12, rate: 1.05 } },
  vaporwave: { timescale: { speed: 0.85, pitch: 0.9, rate: 1.0 } },
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("filter")
    .setDescription("Apply filter sederhana")
    .addStringOption((opt) =>
      opt
        .setName("name")
        .setDescription("Nama filter")
        .setRequired(true)
        .addChoices(
          { name: "off", value: "off" },
          { name: "bassboost", value: "bassboost" },
          { name: "nightcore", value: "nightcore" },
          { name: "vaporwave", value: "vaporwave" }
        )
    ),

  async execute(interaction, clientArg) {
    const client = clientArg || interaction.client;
    const player = getPlayer(client, interaction.guildId);
    const settings = getGuildSettings(interaction.guildId);

    const ok = await requireControl(interaction, player, settings);
    if (!ok) return;

    const name = interaction.options.getString("name", true);

    if (name === "off") {
      await player.shoukaku.clearFilters();
      return interaction.reply({ content: "Filters cleared ✅", flags: 64 });
    }

    const data = FILTERS[name];
    if (!data) {
      return interaction.reply({ content: "❌ Filter tidak dikenal.", flags: 64 });
    }

    await player.shoukaku.setFilters(data);
    return interaction.reply({ content: `✅ Filter applied: **${name}**`, flags: 64 });
  },
};

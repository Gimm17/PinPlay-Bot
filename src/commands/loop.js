const { SlashCommandBuilder } = require("discord.js");
const { getGuildSettings } = require("../utils/storage");
const { requireControl } = require("../utils/permissions");
const { getPlayer, getCurrentTrack } = require("../utils/player");
const { successEmbed, errorEmbed } = require("../utils/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("loop")
    .setDescription("Atur mode loop")
    .addStringOption((opt) =>
      opt
        .setName("mode")
        .setDescription("Pilih mode loop")
        .setRequired(true)
        // value HARUS: none | track | queue (sesuai Kazagumo)
        .addChoices(
          { name: "Off", value: "none" },
          { name: "Track", value: "track" },
          { name: "Queue", value: "queue" }
        )
    ),

  async execute(interaction, clientArg) {
    const client = clientArg || interaction.client;

    const player = getPlayer(client, interaction.guildId);
    const settings = getGuildSettings(interaction.guildId);

    const ok = await requireControl(interaction, player, settings);
    if (!ok) return;

    const current = getCurrentTrack(player);
    const hasSomething = !!current || (Array.isArray(player?.queue) ? player.queue.length > 0 : false);
    if (!hasSomething) {
      return interaction.reply({ embeds: [errorEmbed("❌ Tidak ada lagu/queue aktif.")], flags: 64 });
    }

    const mode = interaction.options.getString("mode", true);
    await player.setLoop(mode);

    const text =
      mode === "none"
        ? "➡️ Loop **OFF**"
        : mode === "track"
        ? "🔂 Loop **TRACK** — lagu sekarang diulang terus."
        : "🔁 Loop **QUEUE** — antrian diulang dari awal.";

    return interaction.reply({ embeds: [successEmbed(text)], flags: 64 });
  },
};

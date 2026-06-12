const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getPlayer, getCurrentTrack } = require("../utils/player");
const { formatMs, progressBar, thumb } = require("../utils/format");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("nowplaying")
    .setDescription("Lihat lagu yang sedang diputar"),

  async execute(interaction, clientArg) {
    const client = clientArg || interaction.client;
    const player = getPlayer(client, interaction.guildId);
    const current = getCurrentTrack(player);

    if (!player || !current) {
      return interaction.reply({ content: "❌ Tidak ada lagu yang sedang diputar.", flags: 64 });
    }

    const pos = player.position || 0;
    const dur = current.length || 0;

    const embed = new EmbedBuilder()
      .setTitle("🎶 Sedang Diputar")
      .setDescription(`**${current.title}**\n${current.uri ? `[Open Link](${current.uri})` : ""}`)
      .addFields(
        {
          name: "⏱ Durasi",
          value: `\`${progressBar(pos, dur)}\`  **${formatMs(pos)} / ${formatMs(dur)}**`,
        },
        {
          name: "👤 Diminta oleh",
          value: current.requester ? `${current.requester}` : "—",
          inline: true,
        },
        {
          name: "🔊 Volume",
          value: `${player.volume ?? "?"}%`,
          inline: true,
        },
        {
          name: "🔁 Loop",
          value: `${player.loop || "none"}`,
          inline: true,
        }
      );

    const t = thumb(current);
    if (t) embed.setThumbnail(t);

    return interaction.reply({ embeds: [embed] });
  },
};

const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getPlayer, getCurrentTrack } = require("../utils/player");
const { formatMs, progressBar, thumb } = require("../utils/format");
const { Colors } = require("../utils/colors");

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
    const isPaused = player.paused;

    const loopIcon = player.loop === "track" ? "🔂" : player.loop === "queue" ? "🔁" : "➡️";
    const reqName = current.requester?.displayName || current.requester?.username || "—";

    const embed = new EmbedBuilder()
      .setColor(isPaused ? Colors.PAUSED : Colors.PLAYING)
      .setAuthor({ name: isPaused ? "⏸ PAUSED" : "▶ NOW PLAYING" })
      .setTitle(current.title?.slice(0, 250) || "Unknown")
      .setURL(current.uri || null)
      .setDescription(
        (current.author ? `**${current.author}**\n` : "") +
        `\`${progressBar(pos, dur)}\` ${formatMs(pos)} / ${formatMs(dur)}\n` +
        `🔊 ${player.volume ?? "?"}%  •  ${loopIcon} ${player.loop || "off"}  •  👤 ${reqName}`
      );

    const t = thumb(current);
    if (t) embed.setThumbnail(t);

    return interaction.reply({ embeds: [embed] });
  },
};


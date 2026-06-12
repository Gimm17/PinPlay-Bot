const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getGuildSettings } = require("../utils/storage");
const { getPlayer } = require("../utils/player");
const { Colors } = require("../utils/colors");
const { formatMs } = require("../utils/format");

// In-memory song history per guild (max 20 per guild, cleared on bot restart)
const guildHistory = new Map();

/**
 * Record a track to the guild's history.
 * Called from music/events.js on playerStart.
 */
function recordTrack(guildId, track) {
  if (!track) return;
  let hist = guildHistory.get(guildId);
  if (!hist) {
    hist = [];
    guildHistory.set(guildId, hist);
  }
  hist.unshift({
    title: track.title || "Unknown",
    author: track.author || "Unknown",
    uri: track.uri || null,
    length: track.length || 0,
    requester: track.requester?.tag || track.requester?.username || null,
    playedAt: Date.now(),
  });
  // Keep max 20
  if (hist.length > 20) hist.length = 20;
}

function getHistory(guildId) {
  return guildHistory.get(guildId) || [];
}

module.exports = {
  recordTrack,
  getHistory,

  data: new SlashCommandBuilder()
    .setName("history")
    .setDescription("Lihat daftar 20 lagu terakhir yang diputar di server ini"),

  async execute(interaction, clientArg) {
    const hist = getHistory(interaction.guildId);

    if (hist.length === 0) {
      return interaction.reply({
        content: "📭 Belum ada riwayat lagu yang diputar.",
        flags: 64,
      });
    }

    const list = hist
      .slice(0, 15)
      .map((h, i) => {
        const dur = h.length ? ` • \`${formatMs(h.length)}\`` : "";
        const title = h.uri ? `[${h.title}](${h.uri})` : h.title;
        return `\`${i + 1}.\` ${title}${dur}`;
      })
      .join("\n");

    const embed = new EmbedBuilder()
      .setTitle("📜 Song History (Last 15)")
      .setDescription(list)
      .setColor(Colors.INFO)
      .setFooter({ text: "History direset saat bot restart." });

    return interaction.reply({ embeds: [embed], flags: 64 });
  },
};

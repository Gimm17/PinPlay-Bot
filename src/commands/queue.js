const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getPlayer, getCurrentTrack, getUpcomingTracks } = require("../utils/player");
const { formatMs } = require("../utils/format");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("queue")
    .setDescription("Lihat daftar antrian (queue)")
    .addIntegerOption((opt) =>
      opt.setName("page").setDescription("Halaman queue (default 1)")
    ),

  async execute(interaction, clientArg) {
    const client = clientArg || interaction.client;

    const player = getPlayer(client, interaction.guildId);

    // Queue hanya butuh player aktif — tidak perlu cek voice/permission
    if (!player) {
      return interaction.reply({ content: "❌ Tidak ada player aktif di server ini.", flags: 64 });
    }

    const current = getCurrentTrack(player);
    const upcoming = getUpcomingTracks(player);
    const total = upcoming.length;

    if (!current && total === 0) {
      return interaction.reply({ content: "📭 Queue kosong — tidak ada lagu yang sedang diputar.", flags: 64 });
    }

    const page = interaction.options.getInteger("page") ?? 1;
    const perPage = 10;

    const maxPage = Math.max(1, Math.ceil(total / perPage));
    const safePage = Math.min(Math.max(page, 1), maxPage);

    const start = (safePage - 1) * perPage;
    const slice = upcoming.slice(start, start + perPage);

    const embed = new EmbedBuilder()
      .setTitle("📜 Queue")
      .setDescription(
        `**Now Playing:** **${current ? current.title : "(buffering...)"}**\n` +
        `**Up Next:** ${total} track\n` +
        `**Page:** ${safePage}/${maxPage}`
      );

    if (slice.length === 0) {
      embed.addFields({ name: "Up Next", value: "Kosong." });
    } else {
      const list = slice
        .map((t, i) => {
          const idx = start + i + 1;
          const dur = t.length ? ` • \`${formatMs(t.length)}\`` : "";
          return `\`${idx}.\` **${t.title}**${dur}`;
        })
        .join("\n");

      embed.addFields({ name: "Up Next", value: list });
    }

    return interaction.reply({ embeds: [embed], flags: 64 });
  },
};

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const { getGuildSettings } = require("../utils/storage");
const {
  getPlayer,
  getCurrentTrack,
  getUpcomingTracks,
} = require("../utils/player");
const { Colors } = require("../utils/colors");
const { formatMs, progressBar, thumb } = require("../utils/format");

function buildPanelEmbed(player, client) {
  const current = getCurrentTrack(player);

  const embed = new EmbedBuilder().setTitle("🎶 Music Panel");

  if (!player || !current) {
    embed.setDescription("Tidak ada lagu yang sedang diputar.")
         .setColor(Colors.IDLE);
    return embed;
  }

  const pos = player.position || 0;
  const dur = current.length || 0;
  const isPaused = player.paused;

  embed.setColor(isPaused ? Colors.PAUSED : Colors.PLAYING);

  embed.setDescription(
    `**[${current.title}](${current.uri || "https://discord.com"})**\n` +
    (current.author ? `by *${current.author}*\n\n` : "\n") +
    `\`${progressBar(pos, dur)}\`  **${formatMs(pos)} / ${formatMs(dur)}**`
  );

  embed.addFields(
    {
      name: "👤 Req by",
      value: current.requester ? `${current.requester}` : "—",
      inline: true,
    },
    {
      name: "🔊 Vol",
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
  
  const upNext = getUpcomingTracks(player);
  let queueText = upNext.length > 0 ? `${upNext.length} tracks` : "Empty";
  
  const s = getGuildSettings(player.guildId);
  if (s.stay247) {
    queueText += " • 24/7 Mode ON";
  }

  embed.setFooter({ text: `Queue: ${queueText}` });

  return embed;
}

function buildPanelComponents(player) {
  const paused = !!player?.paused;

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("pinplay:prev")
      .setLabel("Prev")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("⏮️"),
    new ButtonBuilder()
      .setCustomId("pinplay:toggle")
      .setLabel(paused ? "Resume" : "Pause")
      .setStyle(ButtonStyle.Primary)
      .setEmoji(paused ? "▶️" : "⏸️"),
    new ButtonBuilder()
      .setCustomId("pinplay:next")
      .setLabel("Next")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("⏭️"),
    new ButtonBuilder()
      .setCustomId("pinplay:stop")
      .setLabel("Stop")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("⏹️")
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("pinplay:shuffle")
      .setLabel("Shuffle")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("🔀"),
    new ButtonBuilder()
      .setCustomId("pinplay:loop")
      .setLabel("Loop")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("🔁"),
    new ButtonBuilder()
      .setCustomId("pinplay:voldown")
      .setLabel("Vol-")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("🔉"),
    new ButtonBuilder()
      .setCustomId("pinplay:volup")
      .setLabel("Vol+")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("🔊"),
    new ButtonBuilder()
      .setCustomId("pinplay:queue")
      .setLabel("Queue")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("📜")
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("pinplay:add")
      .setLabel("Add Song")
      .setStyle(ButtonStyle.Success)
      .setEmoji("➕"),
    new ButtonBuilder()
      .setCustomId("pinplay:lyrics")
      .setLabel("Lyrics")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("🎤"),
    new ButtonBuilder()
      .setCustomId("pinplay:history")
      .setLabel("History")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("🕰️")
  );

  // disable control buttons kalau ga ada lagu
  const hasTrack = !!getCurrentTrack(player);
  if (!hasTrack) {
    for (const b of row1.components) b.setDisabled(true);
    for (const b of row2.components) b.setDisabled(true);
    // Add & History tetap bisa diklik meskipun kosong
    row3.components[1].setDisabled(true); // Lyrics didisable kalau kosong
  }

  return [row1, row2, row3];
}

async function updatePanel(client, guildId) {
  const settings = getGuildSettings(guildId);
  if (!settings.panelChannelId || !settings.panelMessageId) return;

  const channel = await client.channels
    .fetch(settings.panelChannelId)
    .catch(() => null);
  if (!channel) return;

  const message = await channel.messages
    .fetch(settings.panelMessageId)
    .catch(() => null);
  if (!message) return;

  const player = getPlayer(client, guildId);
  const embed = buildPanelEmbed(player, client);
  const components = buildPanelComponents(player);

  await message.edit({ embeds: [embed], components }).catch(() => null);
}

module.exports = {
  buildPanelEmbed,
  buildPanelComponents,
  updatePanel,
};

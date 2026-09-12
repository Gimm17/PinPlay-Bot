const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const { getGuildSettings, setGuildSettings } = require("../utils/storage");
const {
  getPlayer,
  getCurrentTrack,
  getUpcomingTracks,
} = require("../utils/player");
const { Colors } = require("../utils/colors");
const { formatMs, progressBar, thumb } = require("../utils/format");

function buildPanelEmbed(player, client) {
  const current = getCurrentTrack(player);

  const embed = new EmbedBuilder();

  if (!player || !current) {
    embed
      .setAuthor({ name: "PinPlay • Music" })
      .setDescription("💤 *Lagi nganggur — gaada lagu yang diputar.*\nKetik `/play` atau klik **Add Song** buat mulai.")
      .setColor(Colors.IDLE);
    return embed;
  }

  const pos = player.position || 0;
  const dur = current.length || 0;
  const isPaused = player.paused;

  embed.setColor(isPaused ? Colors.PAUSED : Colors.PLAYING);

  // Status pill ala mockup: "NOW PLAYING" / "PAUSED"
  const statusLabel = isPaused ? "⏸ PAUSED" : "▶ NOW PLAYING";
  embed.setAuthor({ name: statusLabel });

  // Judul + artist sebagai title (bukan thumbnail besar)
  embed
    .setTitle(current.title?.slice(0, 250) || "Unknown")
    .setURL(current.uri || null);

  const upNext = getUpcomingTracks(player);
  const queueCount = upNext.length;

  // Body: artist + progress bar compact + meta dalam satu baris
  const lines = [];
  if (current.author) lines.push(`**${current.author}**`);
  lines.push(`\`${progressBar(pos, dur)}\` ${formatMs(pos)} / ${formatMs(dur)}`);

  const loopIcon = player.loop === "track" ? "🔂" : player.loop === "queue" ? "🔁" : "➡️";
  const reqName = current.requester?.displayName || current.requester?.username || "—";
  lines.push(
    `🔊 ${player.volume ?? "?"}%  •  ${loopIcon} ${player.loop || "off"}  •  👤 ${reqName}`
  );

  embed.setDescription(lines.join("\n"));

  // Thumbnail kecil (default Discord ~80px) — tetap dipakai tapi kecil & di kanan
  const t = thumb(current);
  if (t) embed.setThumbnail(t);

  const s = getGuildSettings(player.guildId);
  const footerParts = [`📜 Queue: ${queueCount > 0 ? `${queueCount} lagu` : "kosong"}`];
  if (s.stay247) footerParts.push("24/7 ON");
  if (current?.isAutoplay) {
    const source = current.autoplaySource || "auto";
    footerParts.push(`🎵 Autoplay (${source})`);
  }
  embed.setFooter({ text: footerParts.join("  •  ") });

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
    .catch(async (err) => {
      // M7 (audit): if the user deleted the panel, this fetch failed on EVERY
      // player event forever, spamming REST calls. 10008 = Unknown Message —
      // clear the stored ids so we stop trying.
      if (err?.code === 10008 || err?.status === 404) {
        setGuildSettings(guildId, { panelChannelId: null, panelMessageId: null });
      }
      return null;
    });
  if (!message) return;

  const player = getPlayer(client, guildId);
  const embed = buildPanelEmbed(player, client);
  const components = buildPanelComponents(player);

  await message.edit({ embeds: [embed], components }).catch(() => null);
}

// M6 (audit): a 100-track Spotify playlist edits the panel once per resolve
// batch — ~50 edits, each preceded by a messages.fetch — which sits close to
// Discord's rate limit (and panel.js swallows the resulting 429 silently).
// Coalesce bursts into one edit per guild. Panel BUTTONS still call updatePanel
// directly, so user-facing responsiveness is unchanged.
const _pendingPanelUpdate = new Map(); // guildId -> timer

function schedulePanelUpdate(client, guildId, ms = 2000) {
  if (_pendingPanelUpdate.has(guildId)) return;
  _pendingPanelUpdate.set(
    guildId,
    setTimeout(() => {
      _pendingPanelUpdate.delete(guildId);
      updatePanel(client, guildId).catch(() => null);
    }, ms)
  );
}

module.exports = {
  buildPanelEmbed,
  buildPanelComponents,
  schedulePanelUpdate,
  updatePanel,
};

const { EmbedBuilder } = require("discord.js");
const { config } = require("../config");
const { getGuildSettings, setGuildSettings } = require("../utils/storage");
const { makeLogger } = require("../utils/logger");
const { updatePanel } = require("./panel");
const { recordTrack } = require("../commands/history");
const { Colors } = require("../utils/colors");
const { formatMs, thumb } = require("../utils/format");

function attachMusicEvents(client) {
  const kazagumo = client.kazagumo;
  const log = makeLogger(config.logLevel);

  // Auto-leave when queue empty and 24/7 OFF
  const leaveTimers = new Map();

  function clearLeaveTimer(guildId) {
    const t = leaveTimers.get(guildId);
    if (t) clearTimeout(t);
    leaveTimers.delete(guildId);
  }

  function scheduleLeave(player) {
    const guildId = player.guildId;
    const s = getGuildSettings(guildId);
    if (s.stay247) return;

    clearLeaveTimer(guildId);

    const timeoutMs = (config.defaults.leaveTimeoutSec ?? 120) * 1000;
    leaveTimers.set(
      guildId,
      setTimeout(async () => {
        try {
          const cur = getGuildSettings(guildId);
          if (cur.stay247) return;

          if (player.queue.size === 0 && !player.playing) {
            await player.destroy();
            log.info(`👋 Auto-leave (empty) guild ${guildId}`);
          }
        } catch (e) {
          log.warn("Auto-leave failed:", e);
        } finally {
          leaveTimers.delete(guildId);
          try {
            await updatePanel(client, guildId);
          } catch (e) {
            log.warn("updatePanel failed (auto-leave):", e?.message || e);
          }
        }
      }, timeoutMs)
    );
  }

  function escapeMarkdown(text = "") {
    return String(text).replace(
      /(\*|_|`|~|\[|\]|\(|\)|>|#|\+|-|=|\||\{|\}|\.|!)/g,
      "\\$1"
    );
  }

  function normalizeUrl(track) {
    const uri = track?.uri || "";
    if (/^https?:\/\//i.test(uri)) return uri;

    // Spotify URI -> URL
    const m = uri.match(
      /^spotify:(track|album|playlist|episode|show):([A-Za-z0-9]+)$/i
    );
    if (m) return `https://open.spotify.com/${m[1].toLowerCase()}/${m[2]}`;

    // YouTube fallback (kalau ada identifier)
    const id = track?.identifier;
    const src = (track?.sourceName || "").toLowerCase();
    if (!uri && id && (src.includes("youtube") || src.includes("yt"))) {
      return `https://www.youtube.com/watch?v=${id}`;
    }

    return null;
  }

  function buildStartedPlayingEmbed(track) {
    const title = (track?.title || "Unknown title").slice(0, 250);
    const author = track?.author || "";
    const url = normalizeUrl(track);
    const dur = track?.length ? `  •  ${formatMs(track.length)}` : "";
    const reqName =
      track?.requester?.displayName || track?.requester?.username || null;

    const embed = new EmbedBuilder()
      .setColor(Colors.PLAYING)
      .setAuthor({ name: "▶ NOW PLAYING" })
      .setTitle(title)
      .setURL(url || null)
      .setDescription(
        (author ? `**${author}**` : "") +
        (reqName ? `${author ? "  •  " : ""}👤 ${reqName}` : "") +
        dur
      );

    const t = thumb(track);
    if (t) embed.setThumbnail(t);

    return embed;
  }

  kazagumo.on("playerStart", async (player, track) => {
    clearLeaveTimer(player.guildId);

    // Record to history
    recordTrack(player.guildId, track);

    // Jangan biarkan panel nge-block pesan started playing
    try {
      await updatePanel(client, player.guildId);
    } catch (e) {
      log.warn("updatePanel failed (playerStart):", e?.message || e);
    }

    // Kirim "Now Playing" sebagai embed (serasi dengan style Queued)
    const embed = buildStartedPlayingEmbed(track);

    const ch = await client.channels.fetch(player.textId).catch(() => null);
    if (!ch) {
      log.warn(
        `Started playing NOT sent: channel player.textId not found (guild ${player.guildId})`
      );
      return;
    }

    ch.send({
      embeds: [embed],
      allowedMentions: { parse: [] },
    }).catch((e) => log.warn("Started playing send failed:", e?.message || e));
  });

  kazagumo.on("playerEnd", async (player) => {
    try {
      await updatePanel(client, player.guildId);
    } catch (e) {
      log.warn("updatePanel failed (playerEnd):", e?.message || e);
    }
    scheduleLeave(player);
  });

  kazagumo.on("playerEmpty", async (player) => {
    try {
      await updatePanel(client, player.guildId);
    } catch (e) {
      log.warn("updatePanel failed (playerEmpty):", e?.message || e);
    }
    scheduleLeave(player);
  });

  kazagumo.on("playerDestroy", async (player) => {
    clearLeaveTimer(player.guildId);
    try {
      await updatePanel(client, player.guildId);
    } catch (e) {
      log.warn("updatePanel failed (playerDestroy):", e?.message || e);
    }
  });

  kazagumo.on("playerException", async (player, data) => {
    log.warn("Player exception:", data?.exception?.message || data);
    try {
      await updatePanel(client, player.guildId);
    } catch (e) {
      log.warn("updatePanel failed (playerException):", e?.message || e);
    }
  });

  // save voice/text channel for 24/7 when connected
  kazagumo.on("playerCreate", (player) => {
    const s = getGuildSettings(player.guildId);
    if (s.stay247) {
      setGuildSettings(player.guildId, {
        voiceChannelId: player.voiceId,
        textChannelId: player.textId,
      });
    }
  });
}

module.exports = { attachMusicEvents };

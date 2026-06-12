const { config } = require("../config");
const { getGuildSettings, setGuildSettings } = require("../utils/storage");
const { makeLogger } = require("../utils/logger");
const { updatePanel } = require("./panel");
const { recordTrack } = require("../commands/history");

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

  function buildStartedPlayingText(track) {
    const title = escapeMarkdown(track?.title || "Unknown title");
    const authorRaw = track?.author || "";
    const author = authorRaw ? ` by **${escapeMarkdown(authorRaw)}**` : "";
    const url = normalizeUrl(track);

    // Slim, judul clickable, tanpa requested by
    if (url) return `🎶 Started playing **[${title}](${url})**${author}`;
    return `Started playing ${title}${author}`;
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

    // Kirim started playing ke channel command (yang sama seperti versi awal kamu)
    const text = buildStartedPlayingText(track);

    const ch = await client.channels.fetch(player.textId).catch(() => null);
    if (!ch) {
      log.warn(
        `Started playing NOT sent: channel player.textId not found (guild ${player.guildId})`
      );
      return;
    }

    ch.send({ content: text, allowedMentions: { parse: [] } }).catch((e) =>
      log.warn("Started playing send failed:", e?.message || e)
    );
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

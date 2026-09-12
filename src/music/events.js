const { EmbedBuilder } = require("discord.js");
const { config } = require("../config");
const { getGuildSettings, setGuildSettings } = require("../utils/storage");
const { makeLogger } = require("../utils/logger");
const { updatePanel } = require("./panel");
const { recordTrack } = require("../commands/history");
const { Colors } = require("../utils/colors");
const { formatMs, thumb } = require("../utils/format");
const { getAutoplayOn } = require("../utils/autoplay");

// Auto-leave when queue empty and 24/7 OFF.
// Module-level (not per-attach) so play paths outside this file can cancel a
// pending leave as soon as they queue a track — see clearLeaveTimer export (H8).
const leaveTimers = new Map();

function clearLeaveTimer(guildId) {
  const t = leaveTimers.get(guildId);
  if (t) clearTimeout(t);
  leaveTimers.delete(guildId);
}

function attachMusicEvents(client) {
  const kazagumo = client.kazagumo;
  const log = makeLogger(config.logLevel);

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

          // H8 is handled at the source: the queue.add patch in playerCreate
          // cancels this timer the moment a track is queued, which covers the
          // long-resolve case (where queue.current is still null anyway, so a
          // "!player.queue.current" guard here would not have helped).
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

    // Autoplay hook intentionally REMOVED from playerStart.
    // Reason: playerStart fires when a track BEGINS, but the autoplay spec
    // is "auto-add related tracks WHEN QUEUE ENDS". If the user enables
    // autoplay after a track has already started, this hook would never
    // fire for the current playing track — so nothing gets prefetched.
    // The hook is now in playerEnd (with queue.size === 0 guard), which
    // fires exactly when the last track finishes and the queue is about
    // to become empty.
  });

  kazagumo.on("playerEnd", async (player, track) => {
    try {
      await updatePanel(client, player.guildId);
    } catch (e) {
      log.warn("updatePanel failed (playerEnd):", e?.message || e);
    }

    // Autoplay hook: only when the queue will become empty after this track.
    // - getAutoplayOn(): per-guild toggle must be on
    // - player.queue.size === 0: this was the LAST track (no more after it)
    // - track: kazagumo passes the finished track as 2nd arg (see
    //   node_modules/kazagumo/.../KazagumoPlayer.js:93)
    if (getAutoplayOn(player.guildId) && player.queue.size === 0 && track) {
      log.info(
        `[autoplay] playerEnd fired (queue empty), fetching related for "${track.title}"`
      );
      const { fetchRelated } = require("../utils/autoplay");
      fetchRelated(player, track, client).catch((err) => {
        log.error(`[autoplay] unhandled error in playerEnd: ${err.message}`);
      });
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
    // H8 (audit): cancel any pending auto-leave the moment a track is queued.
    //
    // The dangerous case is a LONG RESOLVE: a big Spotify playlist is added
    // track-by-track over many seconds (spotify.js sleeps 750ms per 2 tracks).
    // Until the first track lands, queue.size is 0, playing is false and
    // queue.current is null — so every cheap "is it idle?" check passes and the
    // leave timer can destroy the player mid-import, cancelling the rest.
    //
    // Rather than sprinkle a clearLeaveTimer() call across the 16 queue.add
    // sites in 6 files (and forget it in the 17th), wrap the queue's add once
    // per player. Any queued track therefore cancels the leave, including from
    // code paths added later.
    const queue = player.queue;
    if (queue && typeof queue.add === "function" && !queue.__leaveTimerPatched) {
      const originalAdd = queue.add.bind(queue);
      queue.add = (...args) => {
        clearLeaveTimer(player.guildId);
        return originalAdd(...args);
      };
      queue.__leaveTimerPatched = true;
    }

    const s = getGuildSettings(player.guildId);
    if (s.stay247) {
      setGuildSettings(player.guildId, {
        voiceChannelId: player.voiceId,
        textChannelId: player.textId,
      });
    }
  });
}

module.exports = { attachMusicEvents, clearLeaveTimer };

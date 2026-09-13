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

  /**
   * Tear down a player whose voice connection is gone.
   *
   * WHY THIS EXISTS: when a human right-clicks the bot and hits Disconnect,
   * Discord sends VOICE_STATE_UPDATE with channel_id null. Kazagumo only emits
   * `playerMoved(LEFT)` for that — it does NOT destroy the player, clear the
   * queue, or clear `queue.current`. Nothing in this app reacted either, so the
   * stale KazagumoPlayer stayed in `kazagumo.players` with its whole queue.
   *
   * Consequences seen in production:
   *   - `player.voiceId` still equals the OLD channel (Shoukaku updates only its
   *     internal Connection.channelId), so the next `/play` in that same channel
   *     skipped `setVoiceChannel()` and no OP4 rejoin was ever sent;
   *   - the next `/play` added behind the stale `queue.current`, so the previous
   *     user's song restarted (or, if `playerClosed` never arrived, `playing`
   *     stayed true and the new track hung in the queue without playing);
   *   - the panel kept rendering a NOW PLAYING for a bot that had left.
   *
   * Deliberately NOT applied when 24/7 is on: staying in voice is the whole
   * point there, and the settings are what rejoin on restart. `/247 false` or
   * `/leave` remain the explicit teardown paths.
   */
  async function handleVoiceLeave(guildId) {
    const player = kazagumo.players.get(guildId);
    if (!player) return;
    if (getGuildSettings(guildId).stay247) return;

    clearLeaveTimer(guildId);
    log.info(
      `[player] teardown guild=${guildId} reason=voice-left "queue dropped (${player.queue.size} pending)"`
    );
    try {
      await player.destroy();
    } catch (e) {
      log.warn("Player teardown after voice leave failed:", e?.message || e);
    }
    try {
      await updatePanel(client, guildId);
    } catch (e) {
      log.warn("updatePanel failed (voice leave):", e?.message || e);
    }
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

    // Playback was invisible in the dashboard log — the only visible lines were
    // the background loader's, so the feed looked frozen after "[BG Load]
    // Selesai" while music kept playing. Log every lifecycle event from here.
    log.info(
      `[player] play guild=${player.guildId} "${(track?.title || "?").slice(0, 90)}" src=${track?.sourceName || "?"} by=${track?.requester?.id || "?"}`
    );

    // Remember what is actually playing: by the time playerException fires,
    // Lavalink has already sent TrackEndEvent and queue.current is null, so
    // the fallback below cannot read the failed track from the queue.
    player.__currentTrack = track;

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
    // Normal-path end was silent (only the autoplay branch logged) — this is
    // the "next track" moment the dashboard never showed.
    log.info(
      `[player] end guild=${player.guildId} "${(track?.title || "-").slice(0, 90)}" left=${player.queue.size}`
    );
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
    log.info(`[player] empty guild=${player.guildId}`);
    try {
      await updatePanel(client, player.guildId);
    } catch (e) {
      log.warn("updatePanel failed (playerEmpty):", e?.message || e);
    }
    scheduleLeave(player);
  });

  kazagumo.on("playerDestroy", async (player) => {
    clearLeaveTimer(player.guildId);
    log.info(`[player] destroy guild=${player.guildId}`);
    try {
      await updatePanel(client, player.guildId);
    } catch (e) {
      log.warn("updatePanel failed (playerDestroy):", e?.message || e);
    }
  });

  kazagumo.on("playerException", async (player, data) => {
    const msg = data?.exception?.message || String(data || "");
    log.warn("Player exception:", msg);

    // YouTube playback fails from this VPS (datacenter IP is blocked by
    // YouTube even with valid OAuth — see PINPLAY_PLAYBACK_DIAGNOSIS.md).
    // playerStart already fired by then, so the panel shows a playing track
    // that will never be heard. Recover by re-searching the SAME song on
    // SoundCloud and skipping into it. One attempt per cooldown so a broken
    // source cannot loop exceptions forever.
    const SOURCE_FAILURE =
      /All clients failed|requires login|Sign in to confirm|Video player configuration|page needs to be reloaded/i;
    // queue.current is already null here (TrackEndEvent arrived first) — the
    // playing track was stashed on playerStart instead.
    const cur = player.__currentTrack;
    const fromYouTube = (cur?.sourceName || "").toLowerCase().includes("youtube");

    if (SOURCE_FAILURE.test(msg) && cur && fromYouTube && !player.__scFallback) {
      player.__scFallback = true;
      try {
        const query = `${cur.title} ${cur.author || ""}`.trim();
        const res = await client.kazagumo.search(query, {
          requester: cur.requester,
          engine: "soundcloud",
        });
        const t = res?.tracks?.[0];
        if (t) {
          // Not skip(): by the time the exception fires the player already went
          // through TrackEnd -> empty, so skip() would send an empty track stop
          // instead of starting the queued one. play(track) replaces directly.
          await player.play(t);
          log.info(
            `[fallback] YouTube failed (${msg.slice(0, 60)}…) — playing "${t.title}" from SoundCloud`
          );
          const ch = await client.channels.fetch(player.textId).catch(() => null);
          if (ch) {
            ch.send({
              content: `⚠️ YouTube gagal dimuat dari server — diputar dari SoundCloud: **${t.title}**`,
              allowedMentions: { parse: [] },
            }).catch(() => {});
          }
        }
      } catch (e) {
        log.warn("[fallback] SoundCloud fallback failed:", e?.message || e);
      } finally {
        setTimeout(() => {
          player.__scFallback = false;
        }, 10_000);
      }
    }

    try {
      await updatePanel(client, player.guildId);
    } catch (e) {
      log.warn("updatePanel failed (playerException):", e?.message || e);
    }
  });

  // Previously-unhandled lifecycle events — every one of these was silent.
  // Event names verified against node_modules/kazagumo/dist/Modules/Interfaces.js.
  kazagumo.on("playerStuck", (player, data) => {
    log.warn(
      `[player] stuck guild=${player.guildId} "${(player.queue?.current?.title || "-").slice(0, 90)}" threshold=${data?.thresholdMs ?? "?"}`
    );
  });

  kazagumo.on("playerResolveError", (player, track, message) => {
    log.error(
      `[player] resolve-error guild=${player.guildId} "${(track?.title || "-").slice(0, 90)}" ${String(message || "").slice(0, 120)}`
    );
  });

  // Emitted by the PlayerMoved plugin (loaded in kazagumo.js) on voice moves.
  kazagumo.on("playerMoved", (player, state, meta) => {
    log.info(
      `[player] moved guild=${player.guildId} state=${state || "?"} ${meta?.oldChannelId || "?"}->${meta?.newChannelId || "?"}`
    );
  });

  // The PlayerMoved plugin only logs — it never cleans up. A forced Disconnect
  // from Discord therefore left a stale player + queue behind (see
  // handleVoiceLeave). Catch that raw state change here: if the BOT itself has
  // no voice channel any more, the player is dead weight.
  //
  // Listening to the raw event (not a Kazagumo one) is deliberate: it fires for
  // every transition, including the Disconnect case where no Lavalink
  // WebSocketClosedEvent is guaranteed, so it does not depend on nodes.
  client.on("voiceStateUpdate", (oldState, newState) => {
    if (oldState?.id !== client.user?.id) return; // only the bot's own state
    // Still in a channel => a move, not a leave; the player stays valid.
    if (newState?.channelId) return;
    if (!oldState?.channelId) return; // was already out; nothing to tear down
    handleVoiceLeave(oldState.guild.id).catch(() => {});
  });

  kazagumo.on("playerClosed", (player, data) => {
    log.warn(
      `[player] closed guild=${player.guildId} code=${data?.code ?? "?"} reason=${String(data?.reason ?? "").slice(0, 80)}`
    );
  });

  // save voice/text channel for 24/7 when connected
  kazagumo.on("playerCreate", (player) => {
    log.info(`[player] create guild=${player.guildId} voice=${player.voiceId}`);
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

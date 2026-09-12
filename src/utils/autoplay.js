// src/utils/autoplay.js
const { makeLogger } = require('./logger');
const { getGuildSettings, setGuildSettings } = require('./storage');
const { config } = require('../config');

const logger = makeLogger(config.logLevel);

const _cooldownMap = new Map();        // guildId → lastFailTimestamp (ms)
const _notifiedThisSession = new Set(); // guildId (one-time notify per session)

const COOLDOWN_MS = 30_000;
const TIMEOUT_MS = 5_000;

// Public API - state helpers
function getAutoplayOn(guildId) {
  const settings = getGuildSettings(guildId);
  return Boolean(settings?.autoplayOn);
}

function setAutoplayOn(guildId, on) {
  setGuildSettings(guildId, { autoplayOn: Boolean(on) });
  if (on) {
    _notifiedThisSession.delete(guildId); // reset notify flag so next on re-announces
  }
  logger.info(`[autoplay] ${on ? 'enabled' : 'disabled'} for guild ${guildId}`);
}

function resetCooldown(guildId) {
  _cooldownMap.delete(guildId);
}

// Private helpers

async function fetchFromYouTube(player, seedTrack) {
  // Resolve YouTube video ID from URI or use search query
  let query = null;

  if (seedTrack.uri && (seedTrack.uri.includes('youtube.com') || seedTrack.uri.includes('youtu.be'))) {
    const videoIdMatch = seedTrack.uri.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (videoIdMatch) {
      const videoId = videoIdMatch[1];
      query = `https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}`;
    }
  }

  if (!query) {
    query = `${seedTrack.author || ''} ${seedTrack.title || ''} mix`.trim();
  }
  if (!query) return null;

  // Get kazagumo instance from player (Kazagumo Player has .kazagumo ref)
  const kazagumo = player.kazagumo;
  if (!kazagumo) {
    logger.warn(`[autoplay] no kazagumo instance on player for guild ${player.guildId}`);
    return null;
  }

  const result = await kazagumo.search(query, { requester: seedTrack.requester || null });
  if (!result || !result.tracks || result.tracks.length === 0) return null;

  const topPicks = _filterUnplayed(player, result.tracks.slice(0, 5));
  const pick = topPicks[Math.floor(Math.random() * topPicks.length)];

  // Duration filter: 1-10 minutes
  const durationMs = pick.length || pick.duration || 0;
  if (durationMs > 0 && (durationMs < 60_000 || durationMs > 600_000)) {
    for (const t of topPicks) {
      const d = t.length || t.duration || 0;
      if (d === 0 || (d >= 60_000 && d <= 600_000)) return t;
    }
    return null;
  }

  return pick;
}

function isCooldownActive(guildId) {
  const lastFail = _cooldownMap.get(guildId);
  if (!lastFail) return false;
  const elapsed = Date.now() - lastFail;
  if (elapsed >= COOLDOWN_MS) {
    _cooldownMap.delete(guildId);
    return false;
  }
  return true;
}

function isSpotifySource(track) {
  return track?.sourceName === 'spotify' || track?.uri?.includes('spotify');
}

/**
 * M4 (audit): YouTube's radio mix for a given seed is stable, so the same few
 * videos resurface across consecutive autoplay picks — an audible repeat loop.
 * history.js already records the last 20 played tracks per guild, so prefer
 * picks that are not in it. Falls back to the full pool when everything has
 * been played recently, so we never stall by refusing to pick.
 */
function _filterUnplayed(player, picks) {
  try {
    const { getHistory } = require('../commands/history');
    const seen = new Set(
      (getHistory(player.guildId) || []).map((h) => h.uri).filter(Boolean)
    );
    if (seen.size === 0) return picks;
    const fresh = picks.filter((t) => !seen.has(t.uri));
    return fresh.length ? fresh : picks;
  } catch (e) {
    logger.warn(`[autoplay] history dedup skipped: ${e.message}`);
    return picks;
  }
}

// fetchRelated - core autoplay logic
// @param {Client} [client] - needed to resolve the notify channel (player.textId)
async function fetchRelated(player, currentTrack, client) {
  const guildId = player.guildId;

  // Cooldown check
  if (isCooldownActive(guildId)) {
    const remaining = Math.ceil((COOLDOWN_MS - (Date.now() - _cooldownMap.get(guildId))) / 1000);
    logger.info(`[autoplay] cooldown active, skipping fetch (guild=${guildId}, remaining=${remaining}s)`);
    return null;
  }

  // H2 (audit): the Spotify branch that used to live here was dead code —
  // spotify.js does not export getRecommendations, so the feature check was
  // always false. It nonetheless burned a Promise.race + 5s timer on every
  // Spotify-seeded autoplay before falling through to YouTube. Autoplay is
  // YouTube-only; sourceName in the log line is accurate.
  let track = null;
  const source = 'youtube';

  try {
    logger.info(`[autoplay] fetch from youtube for "${currentTrack.title}"`);
    const result = await Promise.race([
      fetchFromYouTube(player, currentTrack),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)),
    ]);
    if (result) track = result;
  } catch (err) {
    logger.warn(`[autoplay] youtube fetch failed: ${err.message}`);
  }

  // Both failed
  if (!track) {
    _cooldownMap.set(guildId, Date.now());
    logger.warn(`[autoplay] both sources failed, retry in 30s (guild=${guildId})`);
    return null;
  }

  // Success: tag + add to queue
  track.isAutoplay = true;
  track.autoplaySource = source;
  player.queue.add(track);
  logger.info(`[autoplay] added to queue: "${track.title}" (source=${source})`);

  // Kick off playback. player.queue.add() alone doesn't start the player —
  // the player only auto-advances via the 'end' shoukaku event when a track
  // is already playing. Since this hook fires on playerEnd (player is now
  // idle), we have to explicitly call play() so the new track actually
  // starts. Pattern matches src/commands/play.js:124,194.
  try {
    if (!player.playing && !player.paused) {
      await player.play();
      logger.info(`[autoplay] resumed playback with "${track.title}"`);
    }
  } catch (playErr) {
    // Don't let a play() failure mask the successful queue.add — we did our
    // job (got a related track in the queue), play() rejection is usually
    // "Player is already destroyed" (race with scheduleLeave) and unrecoverable.
    logger.warn(`[autoplay] player.play() failed after queue.add: ${playErr.message}`);
  }

  // M3 (audit): this used `player.textChannel`, which does not exist on a
  // Kazagumo player — the correct property is `textId` (a string), so the
  // notify never fired. The flag was also set BEFORE the guard, marking the
  // session notified even when nothing was sent, which killed it permanently.
  // Now: resolve the channel via the client and only set the flag on success.
  if (!_notifiedThisSession.has(guildId) && player.textId) {
    try {
      const channel = await client?.channels?.fetch(player.textId).catch(() => null);
      if (channel) {
        await channel
          .send(
            `🎵 **Autoplay started** — adding related tracks based on "${currentTrack.title}"`,
            { allowedMentions: { parse: [] } } // H1: title is untrusted input
          )
          .then(() => _notifiedThisSession.add(guildId))
          .catch((err) => logger.warn(`[autoplay] failed to send notify: ${err.message}`));
      }
    } catch (err) {
      logger.warn(`[autoplay] notify failed: ${err.message}`);
    }
  }

  return track;
}

module.exports = {
  fetchRelated,
  getAutoplayOn,
  setAutoplayOn,
  resetCooldown,
  _cooldownMap,
  _notifiedThisSession,
};

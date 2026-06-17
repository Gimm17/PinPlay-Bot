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

// Private helpers (stubs - implemented in Task 4 & 5)
async function fetchFromSpotify(seedTrack) {
  // TODO Task 4
  return null;
}

async function fetchFromYouTube(seedTrack) {
  // TODO Task 5
  return null;
}

function hasSpotifyConfig() {
  const { config } = require('../config');
  return Boolean(config.spotify?.clientId && config.spotify?.clientSecret);
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

// fetchRelated - core autoplay logic
async function fetchRelated(player, currentTrack) {
  const guildId = player.guildId;

  // Cooldown check
  if (isCooldownActive(guildId)) {
    const remaining = Math.ceil((COOLDOWN_MS - (Date.now() - _cooldownMap.get(guildId))) / 1000);
    logger.info(`[autoplay] cooldown active, skipping fetch (guild=${guildId}, remaining=${remaining}s)`);
    return null;
  }

  // Try Spotify first
  let track = null;
  let source = null;

  if (hasSpotifyConfig() && isSpotifySource(currentTrack)) {
    try {
      logger.info(`[autoplay] fetch from spotify for "${currentTrack.title}"`);
      const result = await Promise.race([
        fetchFromSpotify(currentTrack),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)),
      ]);
      if (result) {
        track = result;
        source = 'spotify';
      }
    } catch (err) {
      logger.warn(`[autoplay] spotify fetch failed: ${err.message}, trying youtube`);
    }
  }

  // Fallback YouTube
  if (!track) {
    try {
      logger.info(`[autoplay] fetch from youtube for "${currentTrack.title}"`);
      const result = await Promise.race([
        fetchFromYouTube(currentTrack),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)),
      ]);
      if (result) {
        track = result;
        source = 'youtube';
      }
    } catch (err) {
      logger.warn(`[autoplay] youtube fetch failed: ${err.message}`);
    }
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

  // One-time notify per session
  if (!_notifiedThisSession.has(guildId)) {
    _notifiedThisSession.add(guildId);
    const channel = player.textChannel;
    if (channel) {
      channel.send(`🎵 **Autoplay started** — adding related tracks based on "${currentTrack.title}"`).catch(err => {
        logger.warn(`[autoplay] failed to send notify: ${err.message}`);
      });
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

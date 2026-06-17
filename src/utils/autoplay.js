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

module.exports = {
  fetchRelated: undefined, // defined in Task 3
  getAutoplayOn,
  setAutoplayOn,
  resetCooldown,
  _cooldownMap,
  _notifiedThisSession,
};

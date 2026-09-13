/**
 * voiceStatus.js - Show the current song in the voice channel's status text.
 *
 * Discord exposes this as `PUT /channels/{id}/voice-status` with body
 * `{ status }`. discord.js 14.25.1 does NOT wrap it (verified: no VoiceStatus
 * route, no setStatus on VoiceChannel), so this goes through the raw REST
 * client that discord.js already owns — no extra dependency.
 *
 * Permission: SET_VOICE_CHANNEL_STATUS. MANAGE_CHANNELS is only additionally
 * required when the bot is NOT connected to the channel; the bot is always
 * connected while playing, so the invite link we ship is sufficient.
 *
 * Two deliberate behaviours:
 *   - Per-channel throttle. `playerStart` can fire rapidly during a skip or a
 *     playlist import; Discord rate-limits this route and a burst of PUTs would
 *     make the status lag behind the actual track. Only the newest text in a
 *     window is sent.
 *   - Failures are swallowed (debug-level). A missing permission or a deleted
 *     channel must never break playback — this is decoration, not function.
 */

const { Routes } = require("discord.js");
const { config } = require("../config");
const { makeLogger } = require("./logger");

const log = makeLogger(config.logLevel);

const MAX_STATUS_LEN = 500; // Discord's documented limit
const THROTTLE_MS = 5_000;
const _lastSent = new Map(); // channelId -> { text, at }
const _pending = new Map(); // channelId -> timer

/** Trim to Discord's limit without splitting a surrogate pair. */
function truncate(text) {
  if (text.length <= MAX_STATUS_LEN) return text;
  return text.slice(0, MAX_STATUS_LEN - 1) + "…";
}

function _send(client, channelId, text) {
  _lastSent.set(channelId, { text, at: Date.now() });
  client.rest
    .put(Routes.channel(channelId) + "/voice-status", { body: { status: text } })
    .catch((e) => {
      // 50013 missing permission / 10003 unknown channel are expected and fine.
      log.debug(`[voiceStatus] put failed channel=${channelId}: ${e?.message || e}`);
    });
}

/**
 * Set (or clear) the voice channel status.
 * @param {import('discord.js').Client} client
 * @param {string|null} channelId  voice channel id the bot is connected to
 * @param {string|null} text       null/empty clears the status
 */
function setVoiceStatus(client, channelId, text) {
  if (!client || !channelId) return;
  const next = text ? truncate(String(text)) : null;

  const last = _lastSent.get(channelId);
  // Nothing changed — skip the request entirely (playerStart on a replay, etc).
  if (last && last.text === next) return;

  const since = last ? Date.now() - last.at : Infinity;
  if (since >= THROTTLE_MS) {
    _send(client, channelId, next);
    return;
  }

  // Inside the throttle window: remember only the newest text and send it once
  // the window closes, so the status converges on the current track.
  const existing = _pending.get(channelId);
  if (existing) clearTimeout(existing);
  _pending.set(
    channelId,
    setTimeout(() => {
      _pending.delete(channelId);
      _send(client, channelId, next);
    }, THROTTLE_MS - since)
  );
}

/** Clear the status for a channel and drop any queued update. */
function clearVoiceStatus(client, channelId) {
  if (!channelId) return;
  const timer = _pending.get(channelId);
  if (timer) {
    clearTimeout(timer);
    _pending.delete(channelId);
  }
  // Always send the clear even if the last value is unchanged, so a thumbs-up
  // after a failed PUT cannot leave a stale title on screen forever.
  _lastSent.delete(channelId);
  setVoiceStatus(client, channelId, null);
}

/** Format a track for the status line: "Title — Author". */
function formatTrackStatus(track) {
  if (!track) return null;
  const title = track.title || "Unknown";
  const author = track.author ? ` — ${track.author}` : "";
  return `${title}${author}`;
}

module.exports = { setVoiceStatus, clearVoiceStatus, formatTrackStatus, MAX_STATUS_LEN };

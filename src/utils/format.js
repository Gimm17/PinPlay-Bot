/**
 * Shared formatting utilities for PinPlay.
 * Centralized to avoid duplication across commands and music modules.
 */

/**
 * Convert milliseconds to human-readable duration string.
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Formatted string like "3:45" or "1:02:30"
 */
function formatMs(ms) {
  const total = Math.floor(ms / 1000);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  if (h)
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Build a text-based progress bar.
 * @param {number} pos - Current position in ms
 * @param {number} total - Total duration in ms
 * @param {number} size - Width of the bar in characters
 * @returns {string} Progress bar like "───●────────────"
 */
function progressBar(pos, total, size = 16) {
  if (!total || total <= 0) return "──────────────";
  const pct = Math.max(0, Math.min(1, pos / total));
  const filled = Math.round(pct * size);
  const left = "─".repeat(Math.max(0, filled - 1));
  const right = "─".repeat(Math.max(0, size - filled));
  return left + "●" + right;
}

/**
 * Get a thumbnail URL for a track.
 * Checks track.thumbnail, track.artworkUrl, or builds from YouTube identifier.
 * @param {object|null} track - Kazagumo track object
 * @returns {string|null} Thumbnail URL or null
 */
function thumb(track) {
  if (!track) return null;
  if (track.thumbnail) return track.thumbnail;
  if (track.artworkUrl) return track.artworkUrl;
  if (track.uri && track.identifier && track.uri.includes("youtube")) {
    return `https://img.youtube.com/vi/${track.identifier}/hqdefault.jpg`;
  }
  return null;
}

module.exports = { formatMs, progressBar, thumb };

/**
 * logBuffer.js - In-memory ring buffer of recent log lines, for the dashboard.
 *
 * WHY THIS EXISTS: `logger.js` only writes to stdout (PM2 captures it to a
 * file). A web dashboard cannot read that file from another machine, and we do
 * NOT want to expose the raw log file over HTTP — it contains tokens, API keys
 * and user IDs.
 *
 * So the logger ALSO pushes each line here, already REDACTED. The buffer is:
 *   - bounded (fixed max entries, oldest dropped) so it cannot grow forever,
 *   - in-memory only (nothing extra written to disk),
 *   - redacted on the way IN, so a secret can never sit in the buffer waiting
 *     for a reader to ask for it.
 *
 * Redaction matters more than it looks: this bot logs provider errors and
 * `console.error` of raw Error objects. Any of those can carry an
 * Authorization header or an api key in its message/stack.
 *
 * Dipakai oleh:
 *   - src/utils/logger.js       (push every emitted line)
 *   - src/dashboard/api.js      (read recent lines for GET /logs)
 */

// 2000 entries ≈ 0.6–1.0 MB resident. Raised from 500 (2026-09-13): playback
// lifecycle logging fills the feed much faster now, and 500 lines of history
// scrolled off within minutes on an active bot.
const MAX_ENTRIES = 2000;
const MAX_LINE_LEN = 500; // truncate absurdly long lines (stacks, big payloads)

const _lines = []; // oldest -> newest
let _seq = 0;

/**
 * Mask anything that looks like a credential.
 *
 * Deliberately aggressive: a false positive (masking something harmless) costs
 * nothing, while a false negative leaks a live key. Order matters — the
 * generic "long random string" rule runs last so the specific patterns get to
 * label what they found first.
 */
function redact(input) {
  let s = typeof input === "string" ? input : String(input ?? "");

  // Discord bot tokens: <base64>.<6 chars>.<27+ chars>
  s = s.replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{25,}\b/g, "<DISCORD_TOKEN>");

  // Bearer / Authorization headers
  s = s.replace(/\b(Bearer|Bot)\s+[A-Za-z0-9._~+/-]{10,}=*/gi, "$1 <TOKEN>");

  // Explicit key=value forms (API keys, passwords, secrets, cookies).
  // NOTE the trailing `\w*`: env vars in this project are prefixed by the
  // subject, e.g. SPOTIFY_CLIENT_SECRET / LAVALINK_PASSWORD / NVIDIA_API_KEY.
  // Without it, only the exact word "secret" matched and
  // "SPOTIFY_CLIENT_SECRET=<32-char secret>" sailed through unredacted —
  // caught by running this against the project's real credentials.
  s = s.replace(
    /\b(\w*(?:api[_-]?key|apikey|password|passwd|secret|token|auth|sp_dc|cookie)\w*)\b(\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi,
    "$1$2<REDACTED>"
  );

  // Known key shapes used by this project's providers.
  // The `sk-lr-` check runs BEFORE the key=value pass so it gets a precise
  // label rather than a generic <REDACTED>.
  s = s.replace(/\bsk-[A-Za-z0-9-]{10,}\b/g, "<API_KEY>");

  // Long high-entropy blobs — catches opaque tokens/refresh tokens that no
  // name=value pattern exposed. 32+ chars, since API secrets in this project
  // (Spotify client secret) are exactly 32.
  s = s.replace(/\b[A-Za-z0-9_-]{32,}\b/g, "<REDACTED_LONG>");

  // Spotify sp_dc cookies are long base64-ish strings starting with AQ.
  s = s.replace(/\bAQ[A-Za-z0-9_+/=-]{20,}/g, "<SPOTIFY_SP_DC>");

  return s;
}

function _stringifyArg(a) {
  if (a instanceof Error) {
    // Include the message only — stacks are long and rarely useful in a
    // dashboard, and they are where credentials most often hide.
    return `${a.name}: ${a.message}`;
  }
  if (typeof a === "string") return a;
  if (typeof a === "object" && a !== null) {
    try {
      return JSON.stringify(a);
    } catch {
      return "[unserializable object]";
    }
  }
  return String(a);
}

/**
 * Push a log line into the buffer (redacted + truncated).
 * @param {string} level - "debug" | "info" | "warn" | "error"
 * @param {Array} args - the original console arguments
 */
function push(level, args) {
  const text = args.map(_stringifyArg).join(" ");
  const clean = redact(text);
  const line = clean.length > MAX_LINE_LEN ? clean.slice(0, MAX_LINE_LEN - 1) + "…" : clean;

  _lines.push({ seq: ++_seq, ts: new Date().toISOString(), level, line });
  if (_lines.length > MAX_ENTRIES) {
    _lines.splice(0, _lines.length - MAX_ENTRIES);
  }
}

/**
 * Read recent lines, newest last.
 * @param {object} [opts]
 * @param {number} [opts.limit=200] - max lines to return
 * @param {string} [opts.level]     - only this level ("error", "warn", ...)
 * @param {number} [opts.since]     - only entries with seq > since
 */
function read({ limit = 200, level, since } = {}) {
  let out = _lines;
  if (typeof since === "number") out = out.filter((e) => e.seq > since);
  if (level) out = out.filter((e) => e.level === level);
  const n = Math.max(1, Math.min(Number(limit) || 200, MAX_ENTRIES));
  return out.slice(-n);
}

/** Current sequence number — lets a client poll for only-new lines. */
function lastSeq() {
  return _seq;
}

/** Counts per level over the whole buffer. */
function counts() {
  const c = { debug: 0, info: 0, warn: 0, error: 0 };
  for (const l of _lines) if (c[l.level] !== undefined) c[l.level] += 1;
  return c;
}

function clear() {
  _lines.length = 0;
}

module.exports = { push, read, lastSeq, counts, clear, redact, MAX_ENTRIES };

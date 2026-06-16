/**
 * aiProviderFallback.js - Multi-provider auto-fallback wrapper
 *
 * Wraps callAI() with retry to alternative provider on retriable errors:
 *   - HTTP 5xx (server error)
 *   - timeout / connection error
 *   - EMPTY_RESPONSE
 *
 * NOT retried: 401/403 (bad API key), 429 (rate limit), validation errors.
 *
 * Capped at 1 fallback per call (no chains) to prevent latency blowup.
 * Toggleable via aiSettings.fallbackEnabled (default true).
 *
 * API:
 *   callAIWithFallback(opts) -> Promise<string>
 *   isFallbackEnabled() -> boolean
 *   setFallbackEnabled(bool) -> void
 *
 * Dipakai oleh:
 *   - src/commands/chat.js
 *   - src/commands/roast.js
 *   - src/commands/aiplaylist.js
 *   - src/utils/personalities.js (classifier)
 */

const { callAI, isProviderAvailable, getDefaultProviderName } = require("./ai");
const { getAISettings } = require("./aiSettings");
const { makeLogger } = require("./logger");
const { config } = require("../config");

const log = makeLogger(config.logLevel);

function isFallbackEnabled() {
  const s = getAISettings();
  return s?.fallbackEnabled !== false; // default true
}

function isRetriableError(err) {
  const msg = err?.message || "";
  const status = err?.status || err?.response?.status;
  // 5xx server errors
  if (status && status >= 500 && status < 600) return true;
  // Connection/timeout (any ECONN* / network error code)
  const code = String(err?.code || "").toUpperCase();
  if (
    err?.name === "APIConnectionTimeoutError" ||
    err?.name === "APIConnectionError" ||
    /^(ETIMEDOUT|ECONNRESET|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|EPIPE)$/.test(code) ||
    /timeout|connection|network|connect econn|refused|reset|unreachable/i.test(msg)
  ) {
    return true;
  }
  // Empty response
  if (/kosong|empty/i.test(msg)) return true;
  return false;
}

function getFallbackProvider(currentProvider) {
  // Prefer tokenrouter over nvidia for fallback (usually faster, more reliable)
  const order = ["tokenrouter", "nvidia"];
  for (const name of order) {
    if (name === currentProvider) continue;
    if (isProviderAvailable(name)) return name;
  }
  return null;
}

/**
 * Call AI with optional fallback to alternative provider.
 * @param {Object} opts - same as callAI()
 * @returns {Promise<string>}
 */
async function callAIWithFallback(opts = {}) {
  // If caller explicitly disabled fallback, just call directly
  if (opts._noFallback || !isFallbackEnabled()) {
    return callAI(opts);
  }

  const currentProvider = opts.provider || getDefaultProviderName();

  try {
    return await callAI(opts);
  } catch (err) {
    if (!isRetriableError(err)) throw err;

    const fallback = getFallbackProvider(currentProvider);
    if (!fallback) {
      log.warn(`[AI] No fallback provider available (current=${currentProvider})`);
      throw err;
    }

    log.warn(
      `[AI] Primary ${currentProvider} failed (${err.message || err}), trying fallback ${fallback}`
    );

    try {
      const result = await callAI({ ...opts, provider: fallback });
      log.info(`[AI] Fallback ${fallback} succeeded`);
      return result;
    } catch (fbErr) {
      log.error(
        `[AI] Fallback ${fallback} also failed:`,
        fbErr?.message || fbErr
      );
      // Throw original error (more user-friendly context)
      throw err;
    }
  }
}

module.exports = {
  callAIWithFallback,
  isFallbackEnabled,
  isRetriableError,
  getFallbackProvider,
};

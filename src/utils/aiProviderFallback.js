/**
 * aiProviderFallback.js - Multi-provider auto-fallback wrapper
 *
 * Wraps callAI() with retry to alternative provider on retriable errors:
 *   - HTTP 5xx (server error)
 *   - timeout / connection error
 *   - EMPTY_RESPONSE
 *
 * NOT retried: 401/403 (bad API key), 429 (rate limit), 404 (model not found),
 * 4xx validation errors.
 *
 * Behavior on retriable primary error:
 *   1. Retry primary call up to MAX_PRIMARY_RETRIES times (handles transient
 *      blips like empty response from tokenrouter).
 *   2. If still failing, fall back to alternative provider.
 *   3. On fallback, SWAP the model if the original model is not available on
 *      the fallback provider (use fallback provider's default model). This
 *      prevents "model not found" 404s on the fallback provider.
 *
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

const {
  callAI,
  isProviderAvailable,
  getDefaultProviderName,
  getDefaultModel,
  isModelAvailableOnProvider,
  getModelsForProvider,
} = require("./ai");
const { getAISettings } = require("./aiSettings");
const { makeLogger } = require("./logger");
const { config } = require("../config");

const log = makeLogger(config.logLevel);

function isFallbackEnabled() {
  const s = getAISettings();
  return s?.fallbackEnabled !== false; // default true
}

function isRetriableError(err) {
  if (!err) return false;
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
 * Decide which model to use on the fallback provider.
 *
 * Rules:
 *   - If original model is registered for the fallback provider, keep it.
 *   - If not, use the fallback provider's default model.
 *   - If no default model is configured for fallback, return null (caller
 *     will surface "model not set" error from callAI).
 *
 * @param {string} fallbackProvider
 * @param {string} originalModel
 * @returns {string|null}
 */
function resolveFallbackModel(fallbackProvider, originalModel) {
  if (!fallbackProvider) return null;
  if (originalModel && isModelAvailableOnProvider(fallbackProvider, originalModel)) {
    return originalModel;
  }
  // Fallback model not registered on this provider — use its default
  const def = getDefaultModel(fallbackProvider);
  if (def) {
    const available = getModelsForProvider(fallbackProvider);
    if (available.length === 0 || available.includes(def)) {
      return def;
    }
    // Default model itself not registered — pick first available
    return available[0] || def;
  }
  return def || null;
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

  // === Phase 1: Retry primary for transient errors ===
  // 1 initial attempt + 1 retry = 2 attempts max on primary.
  const MAX_PRIMARY_RETRIES = 1;
  const RETRY_DELAY_MS = 500;

  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_PRIMARY_RETRIES + 1; attempt++) {
    try {
      return await callAI(opts);
    } catch (err) {
      lastErr = err;
      if (!isRetriableError(err)) {
        // Non-retriable (e.g. 404 model not found, 401 bad key, 429 rate limit):
        // skip remaining retries, but still try fallback below — fallback may
        // have a working model on a different provider, fixing 404 issues.
        log.warn(
          `[AI] Primary ${currentProvider} got non-retriable error (${err.message || err}), trying fallback...`
        );
        break;
      }
      if (attempt <= MAX_PRIMARY_RETRIES) {
        log.warn(
          `[AI] Primary ${currentProvider} attempt ${attempt} failed (${err.message || err}), retrying in ${RETRY_DELAY_MS}ms...`
        );
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
      // Exhausted primary retries — fall through to fallback
      break;
    }
  }

  // === Phase 2: Fallback to alternative provider ===
  const fallback = getFallbackProvider(currentProvider);
  if (!fallback) {
    log.warn(`[AI] No fallback provider available (current=${currentProvider})`);
    throw lastErr;
  }

  // Smart model swap: if original model is not on fallback provider, use
  // fallback provider's default. Prevents 404 "model not found" when
  // primary was tokenrouter/MiniMax-M3 and fallback is nvidia (which has
  // no M3 model).
  const swapModel = resolveFallbackModel(fallback, opts.model);
  const swapProvider = fallback;
  const swapNote = swapModel !== opts.model
    ? ` (swapped model: ${opts.model} -> ${swapModel})`
    : "";

  log.warn(
    `[AI] Primary ${currentProvider} failed after retries (${lastErr?.message || lastErr}), trying fallback ${swapProvider}${swapNote}`
  );

  try {
    const result = await callAI({
      ...opts,
      provider: swapProvider,
      model: swapModel,
    });
    log.info(`[AI] Fallback ${swapProvider}/${swapModel} succeeded`);
    return result;
  } catch (fbErr) {
    log.error(
      `[AI] Fallback ${swapProvider}/${swapModel} also failed:`,
      fbErr?.message || fbErr
    );
    // Surface original error to the user, but include fallback failure in
    // the message so logs and Discord embeds give the full picture. Internal
    // logs already capture both errors separately above.
    if (fbErr && fbErr !== lastErr) {
      const wrapped = new Error(
        `${lastErr?.message || lastErr} (fallback ${swapProvider}/${swapModel} juga gagal: ${fbErr?.message || fbErr})`
      );
      wrapped.cause = lastErr;
      wrapped.fallbackError = fbErr;
      wrapped.originalError = lastErr;
      throw wrapped;
    }
    throw lastErr;
  }
}

module.exports = {
  callAIWithFallback,
  isFallbackEnabled,
  isRetriableError,
  getFallbackProvider,
  resolveFallbackModel,
};

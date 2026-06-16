/**
 * AI Client Wrapper - Multi-provider (OpenAI-compatible)
 *
 * Providers:
 *   - nvidia:      https://integrate.api.nvidia.com/v1   (default model: meta/llama-3.3-70b-instruct)
 *   - tokenrouter: https://api.tokenrouter.com/v1         (default model: MiniMax-M3)
 *
 * Default provider/model is read from data/aiSettings.json (set by /ai-set)
 * with config.ai.defaultProvider / config.ai.defaultModel as the cold-start fallback.
 *
 * Phase A upgrade:
 *   - Added prewarmAll() to initialize clients at boot (faster first call)
 *   - callAI() signature unchanged for backward compat
 *   - Pre-warm uses existing _getClient() so cache stays warm
 *
 * Dipakai oleh:
 *   - src/commands/aiplaylist.js
 *   - src/commands/roast.js
 *   - src/commands/chat.js
 *   - src/utils/personalities.js (classifier)
 *   - src/utils/aiProviderFallback.js (wrapper)
 */

const OpenAI = require("openai");
const { config } = require("../config");
const { getAISettings } = require("./aiSettings");
const { makeLogger } = require("./logger");

const log = makeLogger(config.logLevel);

const PROVIDERS = {
  nvidia: {
    name: "nvidia",
    label: "NVIDIA Build",
    baseURL: "https://integrate.api.nvidia.com/v1",
    defaultModel: "meta/llama-3.3-70b-instruct",
  },
  tokenrouter: {
    name: "tokenrouter",
    label: "TokenRouter",
    baseURL: "https://api.tokenrouter.com/v1",
    defaultModel: "MiniMax-M3",
  },
};

/**
 * MODELS — model name -> { provider, label, description }.
 * Used by /ai-set model <choice> to auto-resolve the provider.
 * Adding a new model = add an entry here (provider must exist in PROVIDERS).
 */
const MODELS = {
  "llama-3.3-70b": {
    provider: "nvidia",
    label: "Llama 3.3 70B",
    description: "NVIDIA Build • meta/llama-3.3-70b-instruct • General-purpose, Bahasa Indonesia OK",
  },
  "MiniMax-M3": {
    provider: "tokenrouter",
    label: "M3 (TokenRouter)",
    description: "TokenRouter • MiniMax-M3 • Ringan & cepat",
  },
};

const MODEL_NAMES = Object.keys(MODELS);

const TIMEOUT_MS = 90_000;
const _clients = new Map();

/**
 * Strip internal "thinking" blocks some models emit (Qwen, DeepSeek-R1,
 * certain Llama variants, TokenRouter MiniMax-M3, etc.) so they don't leak
 * to the user.
 *
 * Supported patterns:
 *   <think>...</think>
 *   <thinking>...</thinking>
 *   <reasoning>...</reasoning>
 *   <reflection>...</reflection>
 *
 * Result is trimmed; if empty after stripping, EMPTY_RESPONSE is thrown
 * by the caller (callAI).
 */
function _stripThinking(text) {
  if (!text) return text;
  // Match any of the angle-bracket forms. The inner body is allowed to
  // contain newlines ([\s\S]*?) and is matched non-greedily.
  const re = /<\s*(?:think|thinking|reasoning|reflection)\s*>[\s\S]*?<\s*\/\s*(?:think|thinking|reasoning|reflection)\s*>/gi;
  return text.replace(re, "").trim();
}

function getProviderApiKey(name) {
  if (name === "nvidia") return config.nvidia?.apiKey || null;
  if (name === "tokenrouter") return config.tokenrouter?.apiKey || null;
  return null;
}

function getAvailableProviders() {
  return {
    nvidia: Boolean(getProviderApiKey("nvidia")),
    tokenrouter: Boolean(getProviderApiKey("tokenrouter")),
  };
}

function isProviderAvailable(name) {
  return Boolean(getProviderApiKey(name));
}

function isAIAvailable() {
  return Object.values(getAvailableProviders()).some(Boolean);
}

function getDefaultProviderName() {
  // If a model is set, derive provider from MODELS map.
  const settings = getAISettings();
  const m = settings?.model;
  if (m && MODELS[m]) return MODELS[m].provider;
  const p = settings?.provider;
  if (p && p in PROVIDERS) return p;
  return config.ai?.defaultProvider || "nvidia";
}

function getDefaultModel(providerName) {
  // If a model is set in settings, use it (and trust its provider mapping).
  const settings = getAISettings();
  const m = settings?.model;
  if (m && typeof m === "string" && m.trim()) return m.trim();
  const envDefault = config.ai?.defaultModel;
  if (envDefault && typeof envDefault === "string" && envDefault.trim()) return envDefault.trim();
  return PROVIDERS[providerName]?.defaultModel || null;
}

function _getClient(providerName) {
  const apiKey = getProviderApiKey(providerName);
  if (!apiKey) {
    throw new Error(`API key untuk provider "${providerName}" belum di-set di .env`);
  }
  let client = _clients.get(providerName);
  if (!client) {
    const def = PROVIDERS[providerName];
    if (!def) throw new Error(`Provider tidak dikenal: ${providerName}`);
    client = new OpenAI({
      apiKey,
      baseURL: def.baseURL,
      timeout: TIMEOUT_MS,
    });
    _clients.set(providerName, client);
  }
  return client;
}

/**
 * Pre-warm all available provider clients at boot.
 * Call this from index.js once on ready to avoid first-call latency.
 * Idempotent & silent on failure (logs only).
 */
async function prewarmAll() {
  const avail = getAvailableProviders();
  for (const [name, ok] of Object.entries(avail)) {
    if (!ok) continue;
    try {
      _getClient(name);
      log.info(`[AI] Pre-warmed client for provider "${name}"`);
    } catch (e) {
      log.warn(`[AI] Pre-warm failed for "${name}":`, e?.message || e);
    }
  }
}

function _resolveCall({ provider, model }) {
  const providerName =
    provider || getDefaultProviderName();
  if (!isProviderAvailable(providerName)) {
    const avail = Object.entries(getAvailableProviders())
      .filter(([, v]) => v)
      .map(([k]) => k);
    throw new Error(
      `Provider "${providerName}" tidak tersedia. ` +
        `Cek API key di .env. ` +
        `Provider yang aktif: ${avail.length ? avail.join(", ") : "(tidak ada)"}`
    );
  }
  const resolvedModel = model || getDefaultModel(providerName);
  if (!resolvedModel) {
    throw new Error(
      `Model untuk provider "${providerName}" belum di-set. Gunakan /ai-set model <nama>.`
    );
  }
  return { providerName, resolvedModel };
}

/**
 * Panggil AI chat completion.
 * @param {Object} opts
 * @param {Array<{role: string, content: string}>} opts.messages
 * @param {number} [opts.temperature=0.6]
 * @param {number} [opts.maxTokens=4096]
 * @param {string} [opts.provider] - override default provider
 * @param {string} [opts.model]    - override default model
 * @returns {Promise<string>} teks respons dari assistant
 */
async function callAI({ messages, temperature = 0.6, maxTokens = 4096, provider, model }) {
  const { providerName, resolvedModel } = _resolveCall({ provider, model });
  const client = _getClient(providerName);

  try {
    const completion = await client.chat.completions.create({
      model: resolvedModel,
      messages,
      temperature,
      top_p: 0.7,
      max_tokens: maxTokens,
      stream: false,
    });

    const content = completion?.choices?.[0]?.message?.content;
    if (!content || !content.trim()) {
      throw new Error("EMPTY_RESPONSE");
    }
    const cleaned = _stripThinking(content);
    if (!cleaned) {
      throw new Error("EMPTY_RESPONSE");
    }
    return cleaned;
  } catch (err) {
    log.error(
      `AI call error [${providerName}/${resolvedModel}] (status=${err?.status || err?.response?.status || "?"}):`,
      err?.message || err
    );

    const status = err?.status || err?.response?.status;
    if (status === 401 || status === 403) {
      throw new Error(`API key ${providerName} tidak valid. Hubungi admin.`);
    }
    if (status === 429) {
      throw new Error("AI lagi ke-rate limit. Tunggu sebentar dan coba lagi.");
    }
    if (err?.message === "EMPTY_RESPONSE") {
      throw new Error("AI ngasih respons kosong. Coba lagi.");
    }
    if (
      err?.name === "APIConnectionTimeoutError" ||
      err?.code === "ETIMEDOUT" ||
      /timeout/i.test(err?.message || "")
    ) {
      throw new Error("AI lagi lambat (timeout). Coba lagi nanti.");
    }
    // 5xx / unknown: surface the upstream message for diagnostics, but keep
    // user-facing message friendly. Include model name if status is set.
    if (status && status >= 500) {
      throw new Error(
        `AI provider ${providerName} lagi bermasalah (HTTP ${status}). Cek model name atau coba lagi nanti.`
      );
    }
    throw new Error("AI sedang tidak bisa diakses. Coba lagi nanti.");
  }
}

module.exports = {
  callAI,
  isAIAvailable,
  isProviderAvailable,
  getAvailableProviders,
  getDefaultProviderName,
  getDefaultModel,
  prewarmAll,
  PROVIDERS,
  MODELS,
  MODEL_NAMES,
};

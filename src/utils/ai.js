/**
 * AI Client Wrapper — NVIDIA Build API (OpenAI-compatible)
 *
 * Model: qwen/qwen3-next-80b-a3b-instruct
 * Base URL: https://integrate.api.nvidia.com/v1
 *
 * Dipakai oleh:
 *   - src/commands/aiplaylist.js  (AI Playlist Generator)
 *   - src/commands/roast.js       (AI Roast)
 */

const OpenAI = require("openai");
const { config } = require("../config");
const { makeLogger } = require("./logger");

const log = makeLogger(config.logLevel);

const BASE_URL = "https://integrate.api.nvidia.com/v1";
const MODEL = "meta/llama-3.3-70b-instruct";
const TIMEOUT_MS = 90_000;

let _client = null;

/**
 * Lazy-init singleton OpenAI client.
 * Tidak dibuat sampai command AI pertama dipanggil — supaya bot tetap
 * jalan normal meski NVIDIA_API_KEY belum di-set.
 */
function _getClient() {
  if (!config.nvidia?.apiKey) {
    throw new Error("NVIDIA_API_KEY belum di-set di .env");
  }
  if (!_client) {
    _client = new OpenAI({
      apiKey: config.nvidia.apiKey,
      baseURL: BASE_URL,
      timeout: TIMEOUT_MS,
    });
  }
  return _client;
}

/**
 * Cek apakah fitur AI aktif (API key tersedia).
 * Dipakai command untuk kasih error cepat sebelum deferReply.
 * @returns {boolean}
 */
function isAIAvailable() {
  return Boolean(config.nvidia?.apiKey);
}

/**
 * Panggil AI chat completion.
 * @param {Object} opts
 * @param {Array<{role: string, content: string}>} opts.messages
 * @param {number} [opts.temperature=0.6]
 * @param {number} [opts.maxTokens=4096]
 * @returns {Promise<string>} teks respons dari assistant
 */
async function callAI({ messages, temperature = 0.6, maxTokens = 4096 }) {
  const client = _getClient();

  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
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
    return content.trim();
  } catch (err) {
    log.error("AI call error:", err?.message || err);

    // Map error ke pesan user-friendly (Bahasa Indonesia)
    const status = err?.status || err?.response?.status;
    if (status === 401 || status === 403) {
      throw new Error("API key NVIDIA tidak valid. Hubungi admin.");
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
    throw new Error("AI sedang tidak bisa diakses. Coba lagi nanti.");
  }
}

module.exports = { callAI, isAIAvailable };

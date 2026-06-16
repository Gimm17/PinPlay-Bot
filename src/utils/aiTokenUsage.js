/**
 * aiTokenUsage.js - Global token usage tracking + cost estimation
 *
 * Captures OpenAI SDK `usage` field from every successful AI call
 * (via callAI in src/utils/ai.js) and aggregates by:
 *   - Global totals
 *   - Per-provider (nvidia | tokenrouter)
 *   - Per-source (chat | roast | aiplaylist | classifier | extractFacts)
 *
 * Cache hits (no API call) are 0 tokens — natural behavior since
 * recordUsage is only called from callAI which is bypassed on cache hit.
 *
 * Persistence: data/aiTokenUsage.json (in-memory cache + debounced
 * atomic write via jsonFile.js). All-time totals (no rolling window).
 *
 * Cost estimation: reads aiSettings.costPerMillion[modelKey] (USD per 1M
 * tokens). Owner-configurable via /ai-set tokens cost. 0 if unset.
 *
 * API:
 *   recordUsage({ provider, model, source, usage }) -> void
 *   getStats() -> deep copy of current cache
 *   resetStats() -> zeros everything except startedAt
 *   getEstimatedCost() -> number (USD)
 *   getSourceBreakdown() -> array of { source, calls, tokens }
 *
 * Used by:
 *   - src/utils/ai.js (record on every successful call)
 *   - src/commands/ai-set.js (display via /ai-set tokens stats, /ai-set view)
 */

const { atomicWriteJsonSync, readJsonSafeSync } = require("./jsonFile");
const { getCostPerMillion } = require("./aiSettings");
const path = require("path");

const dataDir = path.join(process.cwd(), "data");
const file = path.join(dataDir, "aiTokenUsage.json");

let _cache = null;
let _writeTimer = null;
const WRITE_DEBOUNCE_MS = 500;

const PROVIDERS = ["nvidia", "tokenrouter"];
const SOURCES = ["chat", "roast", "aiplaylist", "classifier", "extractFacts"];

function _emptyBucket() {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0, calls: 0 };
}

function _emptyProvider() {
  const out = {};
  for (const p of PROVIDERS) out[p] = _emptyBucket();
  return out;
}

function _emptySource() {
  const out = {};
  for (const s of SOURCES) out[s] = { totalTokens: 0, calls: 0 };
  return out;
}

const DEFAULTS = () => ({
  totals: _emptyBucket(),
  byProvider: _emptyProvider(),
  bySource: _emptySource(),
  byModel: {},
  startedAt: new Date().toISOString(),
  lastUpdated: null,
});

function _loadCache() {
  if (_cache !== null) return;
  const parsed = readJsonSafeSync(file, {});
  _cache = {
    ...DEFAULTS(),
    ...parsed,
    totals: { ..._emptyBucket(), ...(parsed.totals || {}) },
    byProvider: { ..._emptyProvider(), ...(parsed.byProvider || {}) },
    bySource: { ..._emptySource(), ...(parsed.bySource || {}) },
    byModel: typeof parsed.byModel === "object" && parsed.byModel ? parsed.byModel : {},
  };
  // Ensure all known providers/sources exist after load
  for (const p of PROVIDERS) {
    if (!_cache.byProvider[p]) _cache.byProvider[p] = _emptyBucket();
  }
  for (const s of SOURCES) {
    if (!_cache.bySource[s]) _cache.bySource[s] = { totalTokens: 0, calls: 0 };
  }
}

function _scheduleSave() {
  if (_writeTimer) clearTimeout(_writeTimer);
  _writeTimer = setTimeout(() => {
    _writeTimer = null;
    try {
      atomicWriteJsonSync(file, _cache);
    } catch (e) {
      console.error("[WARN] Failed to persist aiTokenUsage:", e?.message || e);
    }
  }, WRITE_DEBOUNCE_MS);
}

/**
 * Record token usage from a single AI call. Called by ai.js after
 * successful completion (where completion.usage is available).
 *
 * @param {Object} params
 * @param {string} params.provider - "nvidia" | "tokenrouter"
 * @param {string} params.model - resolved model name
 * @param {string} params.source - "chat" | "roast" | "aiplaylist" | "classifier" | "extractFacts" | "unknown"
 * @param {Object} params.usage - { prompt_tokens, completion_tokens, total_tokens }
 */
function recordUsage({ provider, model, source, usage }) {
  if (!usage || typeof usage !== "object") return;
  const prompt = Number(usage.prompt_tokens) || 0;
  const completion = Number(usage.completion_tokens) || 0;
  const total = Number(usage.total_tokens) || prompt + completion;
  if (total <= 0) return;

  _loadCache();
  const prov = PROVIDERS.includes(provider) ? provider : "unknown";
  const src = SOURCES.includes(source) ? source : "unknown";

  // Totals
  _cache.totals.promptTokens += prompt;
  _cache.totals.completionTokens += completion;
  _cache.totals.totalTokens += total;
  _cache.totals.calls += 1;

  // Per-provider
  if (!_cache.byProvider[prov]) _cache.byProvider[prov] = _emptyBucket();
  const bp = _cache.byProvider[prov];
  bp.promptTokens += prompt;
  bp.completionTokens += completion;
  bp.totalTokens += total;
  bp.calls += 1;

  // Per-source
  if (!_cache.bySource[src]) _cache.bySource[src] = { totalTokens: 0, calls: 0 };
  _cache.bySource[src].totalTokens += total;
  _cache.bySource[src].calls += 1;

  // Per-model
  if (model) {
    if (!_cache.byModel[model]) _cache.byModel[model] = _emptyBucket();
    const bm = _cache.byModel[model];
    bm.promptTokens += prompt;
    bm.completionTokens += completion;
    bm.totalTokens += total;
    bm.calls += 1;
  }

  _cache.lastUpdated = new Date().toISOString();
  _scheduleSave();
}

/** Deep copy of current stats. Safe to return to embed/JSON. */
function getStats() {
  _loadCache();
  return JSON.parse(JSON.stringify(_cache));
}

/** Zero all counters. Preserves startedAt. */
function resetStats() {
  _loadCache();
  const started = _cache.startedAt;
  _cache = DEFAULTS();
  _cache.startedAt = started;
  _cache.lastUpdated = new Date().toISOString();
  _scheduleSave();
  return getStats();
}

/**
 * Compute estimated cost in USD from current totals + configured rates.
 * Unknown models (not in costPerMillion) contribute $0.
 */
function getEstimatedCost() {
  _loadCache();
  let total = 0;
  // Per-model breakdown (more accurate if multiple models have different rates)
  for (const [model, bucket] of Object.entries(_cache.byModel || {})) {
    const rate = getCostPerMillion(model); // USD per 1M tokens
    if (rate > 0 && bucket.totalTokens > 0) {
      total += (bucket.totalTokens / 1_000_000) * rate;
    }
  }
  return Math.round(total * 100) / 100; // 2 decimal places
}

/** Sorted source breakdown for display. */
function getSourceBreakdown() {
  _loadCache();
  return Object.entries(_cache.bySource)
    .map(([source, b]) => ({ source, calls: b.calls, totalTokens: b.totalTokens }))
    .sort((a, b) => b.totalTokens - a.totalTokens);
}

/** Sorted provider breakdown for display. */
function getProviderBreakdown() {
  _loadCache();
  return Object.entries(_cache.byProvider)
    .map(([provider, b]) => ({
      provider,
      calls: b.calls,
      totalTokens: b.totalTokens,
      promptTokens: b.promptTokens,
      completionTokens: b.completionTokens,
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens);
}

/** Sorted model breakdown for display. */
function getModelBreakdown() {
  _loadCache();
  return Object.entries(_cache.byModel || {})
    .map(([model, b]) => ({
      model,
      calls: b.calls,
      totalTokens: b.totalTokens,
      promptTokens: b.promptTokens,
      completionTokens: b.completionTokens,
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens);
}

module.exports = {
  recordUsage,
  getStats,
  resetStats,
  getEstimatedCost,
  getSourceBreakdown,
  getProviderBreakdown,
  getModelBreakdown,
  PROVIDERS,
  SOURCES,
};

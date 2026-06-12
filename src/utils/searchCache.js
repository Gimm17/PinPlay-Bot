class SearchCache {
  constructor(maxSize = 200, ttlMs = 5 * 60 * 1000) {
    this._cache = new Map();
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  _normalizeKey(query) {
    return (query || "").toLowerCase().trim();
  }

  get(query) {
    const key = this._normalizeKey(query);
    const entry = this._cache.get(key);
    if (!entry) return null;
    
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this._cache.delete(key);
      return null;
    }
    
    // Move to end (most recently used)
    this._cache.delete(key);
    this._cache.set(key, entry);
    return entry.result;
  }

  set(query, result) {
    const key = this._normalizeKey(query);
    
    if (this._cache.has(key)) {
      this._cache.delete(key);
    } else if (this._cache.size >= this.maxSize) {
      // Evict oldest (first item in Map)
      const firstKey = this._cache.keys().next().value;
      this._cache.delete(firstKey);
    }
    
    this._cache.set(key, { result, timestamp: Date.now() });
  }

  clear() {
    this._cache.clear();
  }
}

module.exports = { SearchCache };

class RateLimiter {
  constructor(windowMs = 5000, maxHits = 3) {
    this.windowMs = windowMs;
    this.maxHits = maxHits;
    this.users = new Map();

    // Auto cleanup every 60s
    setInterval(() => this._cleanup(), 60000).unref();
  }

  check(userId) {
    const now = Date.now();
    const user = this.users.get(userId);

    if (!user) {
      this.users.set(userId, { hits: 1, resetAt: now + this.windowMs });
      return { limited: false, retryAfterMs: 0 };
    }

    if (now > user.resetAt) {
      user.hits = 1;
      user.resetAt = now + this.windowMs;
      return { limited: false, retryAfterMs: 0 };
    }

    user.hits += 1;
    if (user.hits > this.maxHits) {
      return { limited: true, retryAfterMs: user.resetAt - now };
    }

    return { limited: false, retryAfterMs: 0 };
  }

  _cleanup() {
    const now = Date.now();
    for (const [userId, data] of this.users.entries()) {
      if (now > data.resetAt) {
        this.users.delete(userId);
      }
    }
  }
}

// H6 (audit): interactionHandler and messageHandler each did `new RateLimiter()`,
// giving every user TWO independent 3-hits-per-5s budgets — one for slash, one
// for prefixes — that could be alternated (/skip, .s, /skip, .s) to push 6
// requests per 5s through the expensive paths including AI. Share one instance.
const shared = new RateLimiter();

module.exports = { RateLimiter, shared };

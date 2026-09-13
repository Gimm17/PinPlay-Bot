/**
 * dashboard/api.js - HTTP API for the PinPlay dashboard.
 *
 * DESIGN CONSTRAINTS (deliberate, do not relax without thinking):
 *
 *  1. READ-ONLY, EXCEPT FOR AN ENUMERATED WRITE SURFACE (amended 2026-09-13).
 *     This file used to say "there is no endpoint that mutates anything". That
 *     constraint was deliberately relaxed at the owner's explicit request, so
 *     this is the honest version of it rather than a silent violation:
 *
 *       - Exactly two write families: AI quota/settings (aiSettings.js /
 *         aiLimits.js) and music transport control (skip/stop/pause/resume/
 *         volume).
 *       - Still NO restart, NO shutdown, NO .env write, NO shell, NO file path
 *         taken from the request, and no path to Discord's REST API other than
 *         the Kazagumo player this process already owns.
 *       - Music writes additionally require the caller to name a Discord user
 *         id that is CURRENTLY IN THE SAME VOICE CHANNEL as the bot. THAT
 *         CHECK IS A SAFETY GUARD, NOT AN AUTH BOUNDARY: the id is
 *         self-asserted by the browser and the only credential is the shared
 *         DASHBOARD_TOKEN. It stops "I left the channel, this button should do
 *         nothing" — it does not stop anyone who already holds the token.
 *       - Every successful write emits an `[audit]` log line naming the route
 *         and the claimed user, so the dashboard's own log view shows what
 *         changed.
 *       - Writes have a separate, stricter rate limit than reads.
 *
 *     Anything outside those two families still belongs behind a separate,
 *     individually-audited design.
 *
 *  2. TOKEN-GATED, AND THE TOKEN NOW CARRIES WRITE AUTHORITY. Every route
 *     except /health requires a Bearer token compared with timingSafeEqual.
 *     The token lives in .env (DASHBOARD_TOKEN). Because it can now change
 *     state, treat it as a password: rotate it if it is ever pasted into a
 *     chat, a screenshot, or a browser URL. It is stored in the website's
 *     localStorage, which means an XSS on the website is equivalent to full
 *     control of this API — the site must never render untrusted HTML into
 *     the dashboard.
 *
 *  3. BOUND TO LOOPBACK BY DEFAULT. The process listens on 127.0.0.1 and an
 *     Nginx reverse proxy terminates TLS in front of it. That means Node never
 *     handles certificates and the API port is never directly reachable from
 *     the internet.
 *
 *  4. NO RAW LOG FILE. Logs come from the redacted in-memory ring buffer
 *     (logBuffer.js), never from PM2's log files, which contain secrets.
 *
 *  5. RATE LIMITED per IP, so a leaked token cannot be brute-forced and a
 *     stuck client cannot hammer the box.
 *
 * Endpoints:
 *   GET  /health                    -> { ok } (unauthenticated, for uptime probing)
 *   GET  /status                    -> bot + lavalink + host health
 *   GET  /guilds                    -> servers the bot is in
 *   GET  /users                     -> counts and per-guild member totals
 *   GET  /logs                      -> recent redacted log lines
 *   DELETE /logs                    -> clear current in-memory redacted log buffer
 *                                      (never PM2 or disk; audit marker follows clear)
 *   GET  /ai                        -> AI token/cost/limit statistics
 *   GET  /ai/users                  -> per-user AI quota/limits table
 *   GET  /players?user=<discordId>  -> live now-playing state, canControl per guild
 *   GET  /summary                   -> all of the above in one call (dashboard's first load)
 *
 *   POST   /ai/users/:id/reset      -> clear that user's quota window
 *   POST   /ai/users/reset-all      -> clear every quota window
 *   PUT    /ai/users/:id/limit      -> { value } absolute per-user limit override
 *   DELETE /ai/users/:id/limit      -> remove the override
 *   PUT    /ai/users/:id/bonus      -> { value } absolute bonus (may be negative)
 *   POST   /ai/users/:id/bonus      -> { delta } add to the current bonus
 *   DELETE /ai/users/:id/bonus      -> remove the bonus
 *   PUT    /ai/whitelist/:id        -> add to the /chat whitelist
 *   DELETE /ai/whitelist/:id        -> remove from the whitelist
 *   POST   /players/:guildId/action -> { userId, action, value? } music control
 */

const http = require("http");
const crypto = require("crypto");
const os = require("os");

const { config } = require("../config");
const { makeLogger } = require("../utils/logger");
const logBuffer = require("../utils/logBuffer");

// --- Rate limiting (per IP, sliding window) ---
const RL_WINDOW_MS = 60_000;
const RL_MAX = 120; // reads per minute per IP
const RL_WRITE_MAX = 30; // writes per minute per IP — mutations are expensive and audited
const _rl = new Map(); // ip -> { count, windowStart }
const _rlw = new Map(); // same shape, write budget

function rateLimited(ip) {
  const now = Date.now();
  const e = _rl.get(ip);
  if (!e || now - e.windowStart >= RL_WINDOW_MS) {
    _rl.set(ip, { count: 1, windowStart: now });
    return false;
  }
  e.count += 1;
  return e.count > RL_MAX;
}

function writeRateLimited(ip) {
  const now = Date.now();
  const e = _rlw.get(ip);
  if (!e || now - e.windowStart >= RL_WINDOW_MS) {
    _rlw.set(ip, { count: 1, windowStart: now });
    return false;
  }
  e.count += 1;
  return e.count > RL_WRITE_MAX;
}

function _cleanupRl() {
  const now = Date.now();
  for (const [ip, e] of _rl) if (now - e.windowStart >= RL_WINDOW_MS) _rl.delete(ip);
  for (const [ip, e] of _rlw) if (now - e.windowStart >= RL_WINDOW_MS) _rlw.delete(ip);
}

// --- Auth ---
function expectedToken() {
  return process.env.DASHBOARD_TOKEN || null;
}

function tokenOk(headerValue) {
  const expected = expectedToken();
  if (!expected) return false; // no token configured => API is closed
  if (typeof headerValue !== "string") return false;
  const m = headerValue.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  const a = Buffer.from(m[1]);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch, so compare lengths first —
  // that leak is acceptable (it reveals length, not content).
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// --- Payload helpers ---

/**
 * Browser origins allowed to call this API.
 *
 * Needed because the dashboard is served from Vercel while the API lives here —
 * different origins, so the browser enforces CORS. Note this is NOT a security
 * boundary: the bearer token is the actual gate. CORS only decides which
 * browser pages may read a response the token already authorised. A non-browser
 * client ignores it entirely, which is why the token must be strong.
 *
 * Comma-separated in .env, e.g.
 *   DASHBOARD_ALLOWED_ORIGINS=https://pin-play-website.vercel.app,http://localhost:5173
 * Defaults to the production site so a fresh deploy works without extra config.
 */
function allowedOrigins() {
  const raw =
    process.env.DASHBOARD_ALLOWED_ORIGINS ||
    "https://pin-play-website.vercel.app,http://localhost:5173,http://127.0.0.1:4177";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin) return {};
  // Allow the configured list plus any Vercel preview deployment of this
  // project (they get random subdomains, so exact matching is impractical).
  const ok =
    allowedOrigins().includes(origin) ||
    /^https:\/\/pin-play-website[a-z0-9-]*\.vercel\.app$/.test(origin);
  if (!ok) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

function json(res, code, body, extraHeaders = {}) {
  const data = JSON.stringify(body);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  res.end(data);
}

function fmtBytes(n) {
  if (!Number.isFinite(n)) return null;
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

function uptimeStr(sec) {
  sec = Math.max(0, Math.floor(sec));
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}

/**
 * Shoukaku's State is a TypeScript numeric enum:
 *   0 CONNECTING, 1 CONNECTED, 2 DISCONNECTING, 3 DISCONNECTED
 *
 * These numbers are transcribed from the enum in shoukaku's dist (the module
 * does NOT re-export `State`, so it cannot be read at runtime — verified). An
 * earlier version of this file used `=== 2` for "connected", i.e.
 * DISCONNECTING, so every live node was reported as disconnected.
 */
const SHOUKKU_STATE = {
  0: "connecting",
  1: "connected",
  2: "disconnecting",
  3: "disconnected",
};

function nodeStateName(node) {
  return SHOUKKU_STATE[node?.state] || "unknown";
}

/** Build the status payload. `client` and `kazagumo` are read-only here. */
function buildStatus(client) {
  const log = makeLogger(config.logLevel);
  const nodes = [];
  try {
    const sh = client.kazagumo?.shoukaku;
    if (sh?.nodes) {
      for (const [name, node] of sh.nodes) {
        nodes.push({
          name,
          state: nodeStateName(node),
          players: node.stats?.playingPlayers ?? null,
          memoryUsed: fmtBytes(node.stats?.memory?.used),
          cpuLavalink: node.stats?.cpu?.lavalinkLoad ?? null,
        });
      }
    }
  } catch (e) {
    // Do NOT swallow this silently: a bare `catch {}` here hid a ReferenceError
    // that made every node vanish from /status while looking like "no nodes".
    log.warn("Dashboard: failed to read Lavalink node stats:", e?.message || e);
  }

  const used = process.memoryUsage();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();

  return {
    bot: {
      online: Boolean(client.isReady?.()),
      tag: client.user?.tag || null,
      id: client.user?.id || null,
      // Not a secret, and it lets the dashboard pre-fill the control identity
      // (the voice guard compares against this) without manual data entry.
      ownerId: config.discord.ownerId || null,
      uptimeSec: Math.floor(process.uptime()),
      uptime: uptimeStr(process.uptime()),
      ping: client.ws?.ping ?? null,
      guildCount: client.guilds?.cache?.size ?? 0,
      commands: client.commands?.size ?? 0,
    },
    lavalink: {
      nodes,
      connected: nodes.some((n) => n.state === "connected"),
      host: `${config.lavalink.host}:${config.lavalink.port}`,
    },
    process: {
      nodeVersion: process.version,
      heapUsed: fmtBytes(used.heapUsed),
      rss: fmtBytes(used.rss),
      uptimeSec: Math.floor(process.uptime()),
    },
    host: {
      platform: `${os.type()} ${os.release()}`,
      cpuCount: os.cpus()?.length ?? null,
      loadAvg: os.loadavg().map((n) => Math.round(n * 100) / 100),
      memTotal: fmtBytes(totalMem),
      memFree: fmtBytes(freeMem),
      memUsedPct: Math.round(((totalMem - freeMem) / totalMem) * 100),
    },
    logCounts: logBuffer.counts(),
  };
}

function buildGuilds(client) {
  const out = [];
  try {
    for (const [id, g] of client.guilds.cache) {
      out.push({
        id,
        name: g.name,
        memberCount: g.memberCount ?? null,
        icon: g.iconURL?.({ size: 64 }) || null,
        ownerId: g.ownerId || null,
        joinedAt: g.joinedTimestamp ? new Date(g.joinedTimestamp).toISOString() : null,
        // Read-only hint: is the bot currently playing here?
        hasPlayer: Boolean(client.kazagumo?.players?.get(id)),
      });
    }
  } catch {
    /* cache may be partially unavailable during startup */
  }
  out.sort((a, b) => (b.memberCount || 0) - (a.memberCount || 0));
  return out;
}

function buildUsers(client) {
  const guilds = buildGuilds(client);
  // Sum of guild memberCounts is "member slots", not unique humans — a person
  // in two guilds is counted twice. Unique-user count is not available without
  // the GUILD_MEMBERS privileged intent, so both numbers are reported and
  // labelled rather than pretending they mean the same thing.
  const totalMemberSlots = guilds.reduce((n, g) => n + (g.memberCount || 0), 0);
  let cachedUsers = 0;
  try {
    cachedUsers = client.users?.cache?.size ?? 0;
  } catch {
    /* ignore */
  }
  return {
    guildCount: guilds.length,
    totalMemberSlots,
    cachedUsers,
    note:
      "totalMemberSlots summifies setiap guild, jadi satu orang di 2 server dihitung 2x. " +
      "cachedUsers hanya user yang kebetulan ada di cache bot, bukan total populasi.",
    guilds: guilds.map((g) => ({ id: g.id, name: g.name, memberCount: g.memberCount })),
  };
}

function buildAi() {
  try {
    const usage = require("../utils/aiTokenUsage");
    const limits = require("../utils/aiLimits");
    const settings = require("../utils/aiSettings");
    const ai = require("../utils/ai");
    const s = settings.getAISettings();
    return {
      provider: ai.getDefaultProviderName(),
      model: ai.getDefaultModel(ai.getDefaultProviderName()),
      fallbackEnabled: s?.fallbackEnabled !== false,
      memoryEnabled: s?.memoryEnabled !== false,
      userHourlyLimit: s?.userHourlyLimit ?? null,
      whitelistCount: Array.isArray(s?.whitelist) ? s.whitelist.length : 0,
      // Full id list + per-user quota table so the summary poll refreshes the
      // AI users card with no extra request. IDs are not secrets.
      whitelist: Array.isArray(s?.whitelist) ? s.whitelist : [],
      users: buildAiUsers(),
      tokens: usage.getStats(),
      estimatedCostUsd: usage.getEstimatedCost(),
      sources: usage.getSourceBreakdown(),
      providers: usage.getProviderBreakdown(),
      models: usage.getModelBreakdown(),
      activeUsers: limits.listAllLimits(),
      freeCommands: Array.from(limits.FREE_COMMANDS),
      windowMs: limits.WINDOW_MS,
    };
  } catch (e) {
    return { error: `stats unavailable: ${e?.message || e}` };
  }
}

// --- AI users table (quota per user) ---

/**
 * JSON.stringify(Infinity) is null BY ACCIDENT, and count/Infinity is NaN which
 * also serializes to null. Every number that can be Infinite goes through this
 * so `null` is a deliberate "unlimited" sentinel, never an accident.
 */
const finiteOrNull = (n) => (Number.isFinite(n) ? n : null);

/**
 * One row per user with any AI-quota relevance: whitelisted, limit-overridden,
 * bonus-overridden, or currently inside a quota window. Any single source alone
 * misses users (listAllLimits only sees live windows; the whitelist says nothing
 * about overrides), so this is a union of all three.
 */
function buildAiUsers() {
  const settings = require("../utils/aiSettings");
  const limits = require("../utils/aiLimits");
  const s = settings.getAISettings();
  const ids = new Set([
    ...(Array.isArray(s.whitelist) ? s.whitelist : []),
    ...limits.listLimitOverrides().map((o) => o.userId),
    ...limits.listAllLimits().map((l) => l.userId),
  ]);

  const rows = [];
  for (const userId of ids) {
    const st = limits.getUserLimitStatus(userId);
    const ov = limits.listLimitOverrides().find((o) => o.userId === userId) || {};
    rows.push({
      userId,
      whitelisted: Array.isArray(s.whitelist) && s.whitelist.includes(userId),
      overrideLimit: ov.limit ?? null,
      overrideBonus: ov.bonus ?? null,
      count: st.count ?? 0,
      limit: finiteOrNull(st.limit),
      remaining: finiteOrNull(st.remaining),
      effectiveLimit: finiteOrNull(st.effectiveLimit),
      // A ratio against Infinity is NaN — pin owners to 0 explicitly.
      percent: Number.isFinite(st.percent) ? Math.round(st.percent) : 0,
      resetAt: st.resetAt ?? null,
      minutesLeft: st.minutesLeft ?? null,
      status: st.status || "ok",
      isOwner: Boolean(st.isOwner),
    });
  }
  const rank = { "limit-exceeded": 0, "near-limit": 1, ok: 2, bypass: 2 };
  rows.sort(
    (a, b) =>
      (rank[a.status] ?? 3) - (rank[b.status] ?? 3) || (b.count || 0) - (a.count || 0)
  );
  return { base: s.userHourlyLimit ?? null, ownerId: config.discord.ownerId || null, users: rows };
}

// --- Live players ("what is playing where") ---

/**
 * Kazagumo's PlayerState is a DIFFERENT enum from Shoukaku's State above:
 *   0 CONNECTING 1 CONNECTED 2 DISCONNECTING 3 DISCONNECTED 4 DESTROYING 5 DESTROYED
 * (transcribed from node_modules/kazagumo/dist/Modules/Interfaces.js)
 */
const PLAYER_STATE = {
  0: "connecting",
  1: "connected",
  2: "disconnecting",
  3: "disconnected",
  4: "destroying",
  5: "destroyed",
};

/** Snowflake validation — same accepted shape as _resolveUser in ai-set.js. */
const ID_RE = /^\d{17,20}$/;
const validId = (v) => typeof v === "string" && ID_RE.test(v);

/**
 * SAFETY GUARD, NOT AN AUTH BOUNDARY. `userId` is asserted by the browser and
 * the only credential is the shared DASHBOARD_TOKEN. This exists so the
 * dashboard's buttons stop working when the owner is no longer listening in
 * that channel — it does not authenticate the caller as that Discord user.
 *
 * It also deliberately does NOT consult canControl()/controlMode from
 * permissions.js: the dashboard caller has no interaction.member, and enforcing
 * guild DJ policy would need a members.fetch() per request. The dashboard is
 * owner-only; the audit line's `user=` field is what makes that visible.
 */
function controlGuard(client, guildId, userId) {
  if (!validId(guildId)) return { code: 400, error: "invalid guild id" };
  if (!validId(userId)) return { code: 400, error: "userId required" };
  // One-line belt: a leaked token should not let a caller claim some OTHER
  // member's id and ride their voice membership.
  if (config.discord.ownerId && userId !== config.discord.ownerId) {
    return { code: 403, error: "not the bot owner" };
  }
  const player = client.kazagumo?.players?.get(guildId);
  if (!player) return { code: 404, error: "no active player in this guild" };
  const vs = client.guilds?.cache?.get(guildId)?.voiceStates?.cache?.get(userId);
  if (!vs || !player.voiceId || vs.channelId !== player.voiceId) {
    return { code: 403, error: "you are not in the bot's voice channel" };
  }
  return { ok: true, player };
}

function playerSnapshot(client, player, userId) {
  const guild = client.guilds?.cache?.get(player.guildId);
  const voice = player.voiceId
    ? client.channels?.cache?.get(player.voiceId)
    : null;
  const cur = player.queue?.current;
  const guard = userId
    ? controlGuard(client, player.guildId, userId)
    : { code: 400, error: "no user asserted" };
  return {
    guildId: player.guildId,
    guildName: guild?.name || null,
    voiceId: player.voiceId || null,
    voiceName: voice?.name || null,
    textId: player.textId || null,
    state: PLAYER_STATE[player.state] || "unknown",
    playing: Boolean(player.playing),
    paused: Boolean(player.paused),
    volume: player.volume ?? null,
    loop: player.loop || "none",
    positionMs: player.position ?? 0,
    node: player.node?.name || null,
    current: cur
      ? {
          title: cur.title || null,
          author: cur.author || null,
          uri: cur.uri || null,
          lengthMs: cur.length ?? null,
          sourceName: cur.sourceName || null,
          requesterId: cur.requester?.id || null,
        }
      : null,
    upcomingCount: player.queue?.size ?? 0,
    totalSize: player.queue?.totalSize ?? 0,
    previousCount: player.queue?.previous?.length ?? 0,
    canControl: Boolean(guard.ok),
    controlReason: guard.ok ? null : guard.error,
  };
}

function buildPlayers(client, userId) {
  const out = [];
  try {
    for (const player of client.kazagumo?.players?.values() || []) {
      out.push(playerSnapshot(client, player, userId));
    }
  } catch (e) {
    makeLogger(config.logLevel).warn("Dashboard: buildPlayers failed:", e?.message || e);
  }
  out.sort((a, b) => (b.current ? 1 : 0) - (a.current ? 1 : 0));
  return out;
}

// --- Write surface ---

/** Every payload here is a few dozen bytes; 8 KB is generous. */
const MAX_BODY_BYTES = 8 * 1024;

function readJsonBody(req) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        resolve({ error: "body too large", code: 413 });
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) return resolve({ value: {} });
      try {
        resolve({ value: JSON.parse(raw) });
      } catch {
        resolve({ error: "invalid JSON body", code: 400 });
      }
    });
    req.on("error", () => resolve({ error: "read failed", code: 400 }));
  });
}

/** Integer within [min, max], or null. setUserLimit enforces >=1 itself; the
 * API adds an upper bound so a typo cannot mint a six-figure quota. */
function intIn(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  return i >= min && i <= max ? i : null;
}

/** Audit trail for every successful mutation. Fixed prefix so
 * `grep '\[audit\]'` finds every mutation and nothing else. Detail keys must
 * never be token/secret/key/auth/cookie/password — the log redactor masks
 * key=value on those names. Logged only on success; failures already went
 * through 401/403/400 and logging them would let a token-less prober fill the
 * ring buffer. */
function audit(log, ip, method, path, detail) {
  log.info(`[audit] dashboard ${method} ${path} ${detail} ip=${ip}`);
}

function writeHandler(handler) {
  return async ({ req, res, cors, ip, client, log, match }) => {
    const body = await readJsonBody(req);
    if (body.error) return json(res, body.code, { error: body.error }, cors);
    return handler({ res, cors, ip, client, log, match, body: body.value || {} });
  };
}

const WRITE_ROUTES = [
  {
    // This affects ONLY logBuffer's current in-memory, already-redacted ring.
    // It never reads/writes PM2 log files or persistent data. Keep _seq
    // monotonic: old browser cursors must never replay lines after a clear.
    m: "DELETE",
    p: /^\/logs$/,
    h: writeHandler(({ res, cors, ip, log }) => {
      logBuffer.clear();
      // Audit AFTER clear so the action remains forensically visible. The UI
      // receives this final cursor and intentionally starts after the marker.
      audit(log, ip, "DELETE", "/logs", "cleared=true");
      return json(res, 200, { ok: true, lastSeq: logBuffer.lastSeq() }, cors);
    }),
  },
  {
    m: "POST",
    p: /^\/ai\/users\/(\d{17,20})\/reset$/,
    h: writeHandler(({ res, cors, ip, log, match }) => {
      const id = match[1];
      const cleared = require("../utils/aiLimits").resetForUser(id);
      audit(log, ip, "POST", "/ai/users/reset", `user=${id} cleared=${cleared}`);
      return json(res, 200, { ok: true, userId: id, cleared }, cors);
    }),
  },
  {
    m: "POST",
    p: /^\/ai\/users\/reset-all$/,
    h: writeHandler(({ res, cors, ip, log }) => {
      const cleared = require("../utils/aiLimits").resetAll();
      audit(log, ip, "POST", "/ai/users/reset-all", `cleared=${cleared}`);
      return json(res, 200, { ok: true, cleared }, cors);
    }),
  },
  {
    m: "PUT",
    p: /^\/ai\/users\/(\d{17,20})\/limit$/,
    h: writeHandler(({ res, cors, ip, log, match, body }) => {
      const v = intIn(body.value, 1, 100000);
      if (v === null) return json(res, 400, { error: "value must be an integer 1..100000" }, cors);
      const id = match[1];
      require("../utils/aiSettings").setUserLimit(id, v);
      audit(log, ip, "PUT", "/ai/users/limit", `user=${id} value=${v}`);
      return json(res, 200, { ok: true, userId: id, limit: v }, cors);
    }),
  },
  {
    m: "DELETE",
    p: /^\/ai\/users\/(\d{17,20})\/limit$/,
    h: writeHandler(({ res, cors, ip, log, match }) => {
      const id = match[1];
      require("../utils/aiSettings").removeUserLimit(id);
      audit(log, ip, "DELETE", "/ai/users/limit", `user=${id}`);
      return json(res, 200, { ok: true, userId: id, limit: null }, cors);
    }),
  },
  {
    m: "PUT",
    p: /^\/ai\/users\/(\d{17,20})\/bonus$/,
    h: writeHandler(({ res, cors, ip, log, match, body }) => {
      const v = intIn(body.value, -100000, 100000);
      if (v === null)
        return json(res, 400, { error: "value must be an integer -100000..100000" }, cors);
      const id = match[1];
      require("../utils/aiSettings").setUserBonus(id, v);
      audit(log, ip, "PUT", "/ai/users/bonus", `user=${id} value=${v}`);
      return json(res, 200, { ok: true, userId: id, bonus: v }, cors);
    }),
  },
  {
    m: "POST",
    p: /^\/ai\/users\/(\d{17,20})\/bonus$/,
    h: writeHandler(({ res, cors, ip, log, match, body }) => {
      const d = intIn(body.delta, -100000, 100000);
      if (d === null)
        return json(res, 400, { error: "delta must be an integer -100000..100000" }, cors);
      const id = match[1];
      const settings = require("../utils/aiSettings");
      const cur = settings.getAISettings().userBonuses?.[id] ?? 0;
      const next = cur + d;
      if (next < -100000 || next > 100000)
        return json(res, 400, { error: "resulting bonus out of range" }, cors);
      settings.setUserBonus(id, next);
      audit(log, ip, "POST", "/ai/users/bonus", `user=${id} delta=${d} bonus=${next}`);
      return json(res, 200, { ok: true, userId: id, bonus: next }, cors);
    }),
  },
  {
    m: "DELETE",
    p: /^\/ai\/users\/(\d{17,20})\/bonus$/,
    h: writeHandler(({ res, cors, ip, log, match }) => {
      const id = match[1];
      require("../utils/aiSettings").removeUserBonus(id);
      audit(log, ip, "DELETE", "/ai/users/bonus", `user=${id}`);
      return json(res, 200, { ok: true, userId: id, bonus: null }, cors);
    }),
  },
  {
    m: "PUT",
    p: /^\/ai\/whitelist\/(\d{17,20})$/,
    h: writeHandler(({ res, cors, ip, log, match }) => {
      const id = match[1];
      require("../utils/aiSettings").addToWhitelist(id);
      audit(log, ip, "PUT", "/ai/whitelist", `user=${id}`);
      return json(res, 200, { ok: true, whitelist: require("../utils/aiSettings").getAISettings().whitelist }, cors);
    }),
  },
  {
    m: "DELETE",
    p: /^\/ai\/whitelist\/(\d{17,20})$/,
    h: writeHandler(({ res, cors, ip, log, match }) => {
      const id = match[1];
      require("../utils/aiSettings").removeFromWhitelist(id);
      audit(log, ip, "DELETE", "/ai/whitelist", `user=${id}`);
      return json(res, 200, { ok: true, whitelist: require("../utils/aiSettings").getAISettings().whitelist }, cors);
    }),
  },
  {
    m: "POST",
    p: /^\/players\/(\d{17,20})\/action$/,
    h: writeHandler(async ({ res, cors, ip, client, log, match, body }) => {
      const guildId = match[1];
      const ACTIONS = ["skip", "stop", "pause", "resume", "volume"];
      if (!ACTIONS.includes(body.action))
        return json(res, 400, { error: `action must be one of ${ACTIONS.join(", ")}` }, cors);

      const guard = controlGuard(client, guildId, body.userId);
      if (!guard.ok) return json(res, guard.code, { error: guard.error }, cors);
      const player = guard.player;

      // Preconditions that would otherwise silently do nothing or throw.
      if ((body.action === "pause" || body.action === "resume") && (player.queue?.totalSize ?? 0) === 0)
        return json(res, 409, { error: "no track to pause/resume" }, cors);
      if (player.state >= 4)
        return json(res, 409, { error: "player is being destroyed" }, cors);

      // NOTE: stop mirrors the panel's stop (queue.clear + skip), NOT
      // player.destroy() — destroying would drop the bot from voice, a much
      // bigger action than the button implies, and would break 24/7.
      if (body.action === "skip") await player.skip();
      else if (body.action === "stop") {
        player.queue.clear();
        await player.skip();
      } else if (body.action === "pause") player.pause(true);
      else if (body.action === "resume") player.pause(false);
      else if (body.action === "volume") {
        const v = intIn(body.value, 0, 100);
        if (v === null) return json(res, 400, { error: "value must be 0..100" }, cors);
        await player.setVolume(v);
        // Persist like the panel does (panelInteractions.js), or a player
        // recreate resets it and the dashboard silently drifts from Discord.
        require("../utils/storage").setGuildSettings(guildId, { volume: v });
      }

      audit(log, ip, "POST", "/players/action", `guild=${guildId} action=${body.action} user=${body.userId}`);
      return json(res, 200, { ok: true, action: body.action, guildId, player: playerSnapshot(client, player, body.userId) }, cors);
    }),
  },
];

function allowedMethodsFor(path) {
  const methods = new Set(["GET", "HEAD"]);
  for (const r of WRITE_ROUTES) {
    if (r.p.test(path)) methods.add(r.m);
  }
  return [...methods].join(", ");
}

/**
 * NOTE on persistence: aiSettings/aiLimits persist via a 500ms DEBOUNCED write
 * and have no flushNow(). A dashboard write followed by a restart within that
 * window is lost. Accepted for now; the one-line upgrade is exporting flush()
 * from both modules and calling it from the SIGINT handler alongside
 * storage's flushNow().
 */
async function handleWrite({ req, res, path, cors, ip, client, log }) {
  if (writeRateLimited(ip)) return json(res, 429, { error: "too many requests" }, cors);

  for (const route of WRITE_ROUTES) {
    if (route.m !== req.method) continue;
    const match = path.match(route.p);
    if (!match) continue;
    try {
      return await route.h({ req, res, cors, ip, client, log, match });
    } catch (e) {
      log.error("Dashboard write error:", e?.message || e);
      return json(res, 500, { error: "internal error" }, cors);
    }
  }
  // Path may still be a valid read route hit with the wrong verb.
  return json(
    res,
    405,
    { error: "method not allowed", allow: allowedMethodsFor(path) },
    { ...cors, Allow: allowedMethodsFor(path) }
  );
}

// --- Server ---

/**
 * @param {import('discord.js').Client} client
 * @returns {http.Server|null}
 */
function startDashboardApi(client) {
  const log = makeLogger(config.logLevel);
  const port = Number(process.env.DASHBOARD_PORT || 3555);
  const host = process.env.DASHBOARD_HOST || "127.0.0.1";

  if (!expectedToken()) {
    log.warn(
      "Dashboard API not started: DASHBOARD_TOKEN is not set in .env. " +
        "Set a long random value there to enable the dashboard."
    );
    return null;
  }

  const server = http.createServer((req, res) => {
    const ip =
      (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
      req.socket.remoteAddress ||
      "unknown";

    if (rateLimited(ip)) {
      return json(res, 429, { error: "too many requests" });
    }

    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const cors = corsHeaders(req);

    // CORS preflight. The browser sends OPTIONS before a request that carries an
    // Authorization header, so this must be answered before the auth check —
    // otherwise the preflight gets a 401 with no CORS headers and the real
    // request is never attempted.
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        ...cors,
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
      });
      return res.end();
    }

    // Unauthenticated health probe (contains nothing sensitive).
    if (path === "/health" && (req.method === "GET" || req.method === "HEAD")) {
      return json(res, 200, { ok: true }, cors);
    }

    if (!tokenOk(req.headers.authorization)) {
      // Same response for "missing" and "wrong" so the API does not confirm
      // whether a token exists.
      return json(res, 401, { error: "unauthorized" }, cors);
    }

    // Every non-read verb goes through the write surface, which owns its own
    // method+path matching, validation, stricter rate limit and audit line.
    if (req.method !== "GET" && req.method !== "HEAD") {
      return handleWrite({ req, res, path, cors, ip, client, log });
    }

    try {
      switch (path) {
        case "/status":
          return json(res, 200, buildStatus(client), cors);
        case "/guilds":
          return json(res, 200, { guilds: buildGuilds(client) }, cors);
        case "/users":
          return json(res, 200, buildUsers(client), cors);
        case "/logs": {
          const limit = Number(url.searchParams.get("limit") || 200);
          const level = url.searchParams.get("level") || undefined;
          const since = url.searchParams.get("since");
          return json(
            res,
            200,
            {
              logs: logBuffer.read({
                limit,
                level,
                since: since !== null && since !== "" ? Number(since) : undefined,
              }),
              lastSeq: logBuffer.lastSeq(),
              counts: logBuffer.counts(),
            },
            cors
          );
        }
        case "/ai":
          return json(res, 200, buildAi(), cors);
        case "/ai/users":
          return json(res, 200, buildAiUsers(), cors);
        case "/players": {
          const user = url.searchParams.get("user");
          return json(res, 200, { players: buildPlayers(client, user) }, cors);
        }
        case "/summary":
          return json(
            res,
            200,
            {
              generatedAt: new Date().toISOString(),
              status: buildStatus(client),
              guilds: buildGuilds(client),
              users: buildUsers(client),
              ai: buildAi(),
              logs: logBuffer.read({ limit: 60 }),
            },
            cors
          );
        default:
          return json(res, 404, { error: "not found" }, cors);
      }
    } catch (e) {
      log.error("Dashboard API error:", e?.message || e);
      return json(res, 500, { error: "internal error" }, cors);
    }
  });

  server.on("clientError", (err, socket) => {
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  });

  server.listen(port, host, () => {
    log.info(`📊 Dashboard API listening on http://${host}:${port} (read-only)`);
  });
  server.on("error", (e) => {
    log.warn(`Dashboard API failed to listen: ${e?.message || e}`);
  });

  const cleanup = setInterval(_cleanupRl, 5 * 60 * 1000);
  cleanup.unref();

  return server;
}

module.exports = { startDashboardApi, redact: logBuffer.redact };

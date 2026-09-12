/**
 * dashboard/api.js - Read-only HTTP API for the PinPlay dashboard.
 *
 * DESIGN CONSTRAINTS (deliberate, do not relax without thinking):
 *
 *  1. READ-ONLY. There is no endpoint that mutates anything — no restart, no
 *     stop, no config writes. A dashboard is a low-value place to hold write
 *     authority, and an exposed write endpoint on a music bot is equivalent to
 *     remote control. If write actions are ever wanted, they belong behind a
 *     separate, individually-audited design.
 *
 *  2. TOKEN-GATED. Every route except /health requires a Bearer token compared
 *     with timingSafeEqual. The token lives in .env (DASHBOARD_TOKEN).
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
 *   GET /health          -> { ok } (unauthenticated, for uptime probing)
 *   GET /status          -> bot + lavalink + host health
 *   GET /guilds          -> servers the bot is in
 *   GET /users           -> counts and per-guild member totals
 *   GET /logs            -> recent redacted log lines
 *   GET /ai              -> AI token/cost/limit statistics
 *   GET /summary         -> all of the above in one call (dashboard's first load)
 */

const http = require("http");
const crypto = require("crypto");
const os = require("os");

const { config } = require("../config");
const { makeLogger } = require("../utils/logger");
const logBuffer = require("../utils/logBuffer");

// --- Rate limiting (per IP, sliding window) ---
const RL_WINDOW_MS = 60_000;
const RL_MAX = 120; // requests per minute per IP
const _rl = new Map(); // ip -> { count, windowStart }

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

function _cleanupRl() {
  const now = Date.now();
  for (const [ip, e] of _rl) if (now - e.windowStart >= RL_WINDOW_MS) _rl.delete(ip);
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
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
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

    // Only GET/HEAD — nothing here mutates, and rejecting the rest keeps the
    // surface honest.
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD", ...cors });
      return res.end();
    }

    // Unauthenticated health probe (contains nothing sensitive).
    if (path === "/health") return json(res, 200, { ok: true }, cors);

    if (!tokenOk(req.headers.authorization)) {
      // Same response for "missing" and "wrong" so the API does not confirm
      // whether a token exists.
      return json(res, 401, { error: "unauthorized" }, cors);
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

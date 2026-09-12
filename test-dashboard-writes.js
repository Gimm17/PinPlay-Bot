// test-dashboard-writes.js - smoke test for the dashboard write surface.
// Run: node test-dashboard-writes.js
// Requires: repo .env present (config.js validates DISCORD_TOKEN etc. at load).
//
// Pins the two pieces of non-trivial logic in the dashboard upgrade:
//   1. the voice-membership guard (403 vs 200)
//   2. Infinity -> null mapping in the AI users table
// plus the method/verb contract (401/405/400/404).

require("dotenv").config();

// Set BEFORE requiring api.js — the module reads these at start time.
process.env.DASHBOARD_TOKEN = process.env.DASHBOARD_TOKEN || "test-token-abc123";
const TEST_PORT = 3777;

const assert = require("assert");
const http = require("http");
const { config } = require("./src/config");
const { startDashboardApi } = require("./src/dashboard/api");

// The guard compares against the REAL configured owner, so the test identity
// must be that owner. STRANGER must differ from it.
const OWNER = config.discord.ownerId || "123456789012345678";
const STRANGER = OWNER === "999999999999999999" ? "888888888888888888" : "999999999999999999";
const GUILD = "111111111111111111";
const VOICE = "222222222222222222";

function fakePlayer() {
  return {
    guildId: GUILD,
    voiceId: VOICE,
    textId: "333333333333333333",
    state: 1,
    playing: true,
    paused: false,
    volume: 80,
    loop: "none",
    position: 1000,
    node: { name: "local" },
    queue: {
      current: { title: "Test Song", author: "Tester", uri: null, length: 100000, sourceName: "soundcloud", requester: { id: OWNER } },
      size: 0,
      totalSize: 1,
      previous: [],
      clear() {},
    },
    skip() {
      this.skipped = (this.skipped || 0) + 1;
      return this;
    },
    pause() {},
    async setVolume(v) {
      this.volume = v;
    },
  };
}

function fakeClient({ withPlayer = true, ownerInVoice = true } = {}) {
  const player = withPlayer ? fakePlayer() : null;
  const voiceStates = new Map();
  if (withPlayer && ownerInVoice) voiceStates.set(OWNER, { channelId: VOICE });
  if (withPlayer && !ownerInVoice) voiceStates.set(OWNER, { channelId: "444444444444444444" });
  return {
    isReady: () => true,
    user: { tag: "Test#0" },
    ws: { ping: 1 },
    guilds: { cache: new Map([[GUILD, { name: "G", voiceStates: { cache: voiceStates } }]]) },
    channels: { cache: new Map([[VOICE, { name: "vc" }]]) },
    kazagumo: {
      players: new Map(player ? [[GUILD, player]] : []),
      shoukaku: { nodes: new Map() },
    },
    commands: new Map(),
  };
}

function req(method, path, body, port = TEST_PORT) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          Authorization: "Bearer test-token-abc123",
          "Content-Type": "application/json",
          ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          let json = null;
          try {
            json = JSON.parse(buf);
          } catch {}
          resolve({ status: res.statusCode, allow: res.headers.allow, json });
        });
      }
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

let passed = 0;
function check(name, cond, extra) {
  if (cond) {
    passed++;
    console.log(`  ok: ${name}`);
  } else {
    console.error(`  FAIL: ${name}${extra ? " :: " + JSON.stringify(extra).slice(0, 200) : ""}`);
    process.exitCode = 1;
  }
}

async function main() {
  console.log("=== Dashboard writes smoke test ===\n");

  const client = fakeClient({ withPlayer: true, ownerInVoice: true });
  const server = startDashboardApi(client);
  if (!server) throw new Error("server did not start (DASHBOARD_TOKEN unset?)");
  await new Promise((r) => server.listen(TEST_PORT, "127.0.0.1", r));

  // --- verb contract ---
  let r;
  {
    const noAuth = await new Promise((resolve, reject) => {
      const q = http.request({ host: "127.0.0.1", port: TEST_PORT, path: "/ai/users/reset-all", method: "POST" }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      });
      q.on("error", reject);
      q.end();
    });
    check("auth: missing token -> 401", noAuth === 401, { noAuth });
  }

  r = await req("PATCH", "/status");
  check("PATCH /status -> 405 with Allow", r.status === 405 && /GET/.test(r.allow), r);

  r = await req("PUT", "/ai/users/123/limit", { value: 5 });
  check("malformed id -> 405/404 (route does not match)", r.status === 405 || r.status === 404, r);

  r = await req("PUT", `/ai/users/${OWNER}/limit`, { value: 0 });
  check("limit value=0 -> 400", r.status === 400, r);

  // --- reads ---
  r = await req("GET", "/ai/users");
  check("GET /ai/users -> 200 with users array", r.status === 200 && Array.isArray(r.json?.users), r);
  check("AI users: no Infinity leaks", !JSON.stringify(r.json).includes("Infinity"), r);

  r = await req("GET", `/players?user=${OWNER}`);
  check("GET /players -> 200 array", r.status === 200 && Array.isArray(r.json?.players), r);
  check("players: canControl true when owner in voice", r.json?.players?.[0]?.canControl === true, r);

  // --- guard ---
  {
    const outClient = fakeClient({ withPlayer: true, ownerInVoice: false });
    // swap server's client is not possible post-start; instead assert via a
    // second server on another port.
    const s2 = startDashboardApi(outClient);
    await new Promise((r2) => s2.listen(TEST_PORT + 1, "127.0.0.1", r2));
    const r2 = await req("POST", `/players/${GUILD}/action`, { userId: OWNER, action: "skip" }, TEST_PORT + 1);
    check("guard: owner NOT in bot's voice -> 403", r2.status === 403, r2);
    const p2 = await req("GET", `/players?user=${OWNER}`, null, TEST_PORT + 1);
    check("players: canControl false when out of voice", p2.json?.players?.[0]?.canControl === false, p2);
    check(
      "players: controlReason explains",
      typeof p2.json?.players?.[0]?.controlReason === "string",
      p2
    );
    const stranger = await req("POST", `/players/${GUILD}/action`, { userId: STRANGER, action: "skip" }, TEST_PORT + 1);
    check("guard: non-owner id -> 403 not the bot owner", stranger.status === 403 && /owner/.test(stranger.json?.error || ""), stranger);
    s2.close();
  }

  {
    const noPlayer = fakeClient({ withPlayer: false, ownerInVoice: false });
    const s3 = startDashboardApi(noPlayer);
    await new Promise((r3) => s3.listen(TEST_PORT + 2, "127.0.0.1", r3));
    const r3 = await req("POST", `/players/${GUILD}/action`, { userId: OWNER, action: "skip" }, TEST_PORT + 2);
    check("guard: no player -> 404", r3.status === 404, r3);
    s3.close();
  }

  // --- actions ---
  const player = client.kazagumo.players.get(GUILD);
  r = await req("POST", `/players/${GUILD}/action`, { userId: OWNER, action: "volume", value: 50 });
  check("volume action -> 200", r.status === 200, r);
  check("volume applied to player", player.volume === 50, { volume: player.volume });
  check("volume persisted to guildSettings", require("./src/utils/storage").getGuildSettings(GUILD).volume === 50);

  r = await req("POST", `/players/${GUILD}/action`, { userId: OWNER, action: "skip" });
  check("skip action -> 200 and skipped", r.status === 200 && player.skipped >= 1, r);

  r = await req("POST", `/players/${GUILD}/action`, { userId: OWNER, action: "explode" });
  check("unknown action -> 400", r.status === 400, r);

  // --- AI writes ---
  r = await req("PUT", `/ai/users/${OWNER}/limit`, { value: 20 });
  check("set limit -> 200", r.status === 200 && r.json?.limit === 20, r);
  check("limit persisted", require("./src/utils/aiSettings").getAISettings().userLimits[OWNER] === 20);

  r = await req("POST", `/ai/users/${OWNER}/bonus`, { delta: 5 });
  check("add bonus +5", r.status === 200 && r.json?.bonus === 5, r);

  r = await req("PUT", `/ai/users/${OWNER}/bonus`, { value: -3 });
  check("set bonus -3 (absolute)", r.status === 200 && r.json?.bonus === -3, r);

  r = await req("DELETE", `/ai/users/${OWNER}/bonus`);
  check("remove bonus", r.status === 200, r);

  r = await req("DELETE", `/ai/users/${OWNER}/limit`);
  check("remove limit", r.status === 200 && r.json?.limit === null, r);

  r = await req("PUT", `/ai/whitelist/${OWNER}`);
  check("whitelist add", r.status === 200 && Array.isArray(r.json?.whitelist), r);
  r = await req("DELETE", `/ai/whitelist/${OWNER}`);
  check("whitelist remove", r.status === 200, r);

  server.close();
  console.log(`\n${passed} checks passed${process.exitCode ? " (with failures)" : ""}`);
}

main().catch((e) => {
  console.error("TEST ERROR:", e);
  process.exit(1);
});

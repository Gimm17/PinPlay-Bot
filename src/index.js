const { Client, GatewayIntentBits, Partials, ActivityType, Options } = require("discord.js");
const { config } = require("./config");

const { loadCommands } = require("./handlers/commandLoader");
const { attachInteractionHandler } = require("./handlers/interactionHandler");
const { attachMessageHandler } = require("./handlers/messageHandler");

const { createKazagumo } = require("./music/kazagumo");
const { attachMusicEvents } = require("./music/events");
const { readAll, getGuildSettings, flushNow } = require("./utils/storage");
const { makeLogger } = require("./utils/logger");

const log = makeLogger(config.logLevel);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],

  // H1 (audit): never let bot output resolve a mention. AI output is fed
  // attacker-controlled text (song titles flow straight into the /roast prompt
  // at temperature 0.9), so without this a track named "@everyone lol" can make
  // the bot ping the whole server. `parse: []` blocks all @everyone/@here/role
  // pings; `users: []` still honours an explicit <@id> for the roast requester.
  allowedMentions: { parse: [], users: [], repliedUser: true },

  // M1 (audit): the bot only ever reacts to live messages and fetches the panel
  // by id, so it never reads historical messages from cache — 200 full Message
  // objects per channel were pure waste and the single largest memory consumer
  // on a small VPS.
  makeCache: Options.cacheWithLimits({
    ...Options.DefaultMakeCacheSettings,
    MessageManager: 50,
    GuildMemberManager: 200,
    UserManager: 200,
  }),
  // `lifetime` is only valid for invites/messages/threads (see SweeperDefinitions)
  // — a `lifetime` on `users` would be ignored. Bound the cache by size instead.
  sweepers: {
    ...Options.DefaultSweeperSettings,
    messages: { interval: 3600, lifetime: 1800 },
  },
});

const { SearchCache } = require("./utils/searchCache");

client.commands = loadCommands();
client.searchCache = new SearchCache();

// Lavalink client
client.kazagumo = createKazagumo(client);
attachMusicEvents(client);

// Interactions (slash + buttons + modals)
attachInteractionHandler(client);

// Prefix commands (text-based commands like .p, .s, .q)
attachMessageHandler(client);

client.once("clientReady", async () => {
  log.info(`✅ Logged in as ${client.user.tag}`);

  // Read-only dashboard API. Bound to loopback; TLS is terminated by Nginx in
  // front of it. No-op unless DASHBOARD_TOKEN is set. See src/dashboard/api.js.
  try {
    const { startDashboardApi } = require("./dashboard/api");
    startDashboardApi(client);
  } catch (e) {
    log.warn("Dashboard API failed to start:", e?.message || e);
  }

  client.user.setPresence({
    activities: [{ name: "music | /play", type: ActivityType.Listening }],
    status: "online",
  });

  // Wait for Lavalink's port, THEN register the node (which is what makes
  // Shoukaku dial). The node list starts empty for exactly this reason: if
  // Shoukaku owned the node at this point it would dial on its own `clientReady`
  // hook and race Lavalink's boot, and a lost race costs it every retry —
  // leaving the node permanently DISCONNECTED while PM2 still shows "online".
  //
  // On a normal boot Lavalink is already up, so this resolves in milliseconds.
  try {
    const { waitForLavalinkPort, connectLavalink } = require("./music/kazagumo");
    const ready = await waitForLavalinkPort(
      config.lavalink.host,
      config.lavalink.port,
      60_000
    );
    if (ready) {
      log.info(`🔌 Lavalink port ${config.lavalink.port} is open`);
    } else {
      log.warn(
        `⚠️ Lavalink port ${config.lavalink.port} still closed after 60s — connecting anyway (it may come up later)`
      );
    }
    if (connectLavalink(client.kazagumo)) {
      log.info(`🔗 Lavalink node "${config.lavalink.name}" registered`);
    }
  } catch (e) {
    log.warn("Lavalink connect failed:", e?.message || e);
  }

  // Watchdog for a mid-run Lavalink death.
  //
  // The boot-time wait above only covers Lavalink being slow to START. If
  // Lavalink goes down while the bot is already running, Shoukaku exhausts its
  // finite retries and gives up for good — the bot keeps serving Discord but
  // every /play fails with "No node found" until someone restarts it manually.
  //
  // IMPORTANT: only re-add the node when it is GONE from the Map (state was
  // fully removed — i.e. Shoukaku gave up reconnecting). Do NOT remove+re-add
  // just because `node.state !== CONNECTED` — that races Shoukaku's own
  // reconnect, closes the WebSocket mid-session (destroying the Lavalink
  // player → "track shows but no sound"), and re-opens zombie connections that
  // pile up on the Lavalink side. Observed in production: a node still in
  // DISCONNECTED/CONNECTING state got force-cycled every 30s, killing every
  // playback while the bot stayed "online".
  //
  // So: if the node object exists at all, leave it alone (Shoukaku is either
  // connected or mid-reconnect — both correct states). Only re-register when the
  // Map no longer has the node AND the port is back up.
  const { waitForLavalinkPort, connectLavalink } = require("./music/kazagumo");
  const WATCHDOG_MS = 30_000;
  const watchdog = setInterval(async () => {
    try {
      const sh = client.kazagumo?.shoukaku;
      const node = sh?.nodes?.get(config.lavalink.name);
      // Node object still tracked → Shoukaku owns it (connected or
      // reconnecting). Touching it here destroys the audio session.
      if (node) return;

      // Node is gone (Shoukaku gave up). Only re-add once the port is back, so
      // we don't dial a dead server.
      const up = await waitForLavalinkPort(
        config.lavalink.host,
        config.lavalink.port,
        5_000
      );
      if (!up) return; // still down; try again next tick

      log.warn("⚠️ Lavalink node gone but port is back up — re-registering.");
      if (connectLavalink(client.kazagumo)) {
        log.info(`🔗 Lavalink node "${config.lavalink.name}" re-registered`);
      }
    } catch (e) {
      log.warn("Lavalink watchdog error:", e?.message || e);
    }
  }, WATCHDOG_MS);
  watchdog.unref(); // must not hold the process open

  // Pre-warm AI provider clients (faster first /chat, /roast, /aiplaylist)
  try {
    const { prewarmAll } = require("./utils/ai");
    await prewarmAll();
  } catch (e) {
    log.warn("AI prewarm failed:", e?.message || e);
  }
});

// --- Lavalink node events (debug)
client.kazagumo.shoukaku.on("ready", async (name) => {
  log.info(`✅ Lavalink node ready: ${name}`);

  // Restore 24/7 players (best effort) — setelah node ready biar tidak "No node found"
  try {
    const all = readAll();
    for (const [guildId, s] of Object.entries(all)) {
      if (!s?.stay247 || !s.voiceChannelId || !s.textChannelId) continue;

      const guild = client.guilds.cache.get(guildId);
      if (!guild) continue;

      const voiceChannel = guild.channels.cache.get(s.voiceChannelId);
      // BUG-6 fix: validate that the saved channel is actually a voice channel
      if (!voiceChannel || !voiceChannel.isVoiceBased()) {
        log.warn(`⚠️ 24/7 restore skipped for guild ${guildId}: saved voiceChannelId (${s.voiceChannelId}) is not a voice channel.`);
        continue;
      }

      await client.kazagumo.createPlayer({
        guildId,
        voiceId: s.voiceChannelId,
        textId: s.textChannelId,
        volume: s.volume ?? config.defaults.volume,
        deaf: true,
        loadBalancer: true, // pick the healthiest node (local vs public)
      });

      log.info(`🔁 Restored 24/7 in guild ${guildId}`);
    }
  } catch (e) {
    log.warn("Restore 24/7 failed:", e);
  }
});

client.kazagumo.shoukaku.on("error", (name, error) => {
  log.error(`❌ Lavalink node error: ${name}`, error);
});
client.kazagumo.shoukaku.on("close", (name, code, reason) => {
  log.warn(`⚠️ Lavalink node closed: ${name} (${code}) ${reason ?? ""}`);
});
client.kazagumo.shoukaku.on("disconnect", (name) => {
  log.warn(`⚠️ Lavalink node disconnected: ${name}`);
});

// ─── Process error boundary ───────────────────────────────────────────────
// Node >=18 defaults to --unhandled-rejections=throw. Without these handlers a
// single unawaited rejection (e.g. player.play() while Lavalink is down, or an
// AI provider 5xx during a chat reply) kills the whole bot with no log.
// PM2 would restart it, but a fast crash-loop becomes restart spam and hides
// the real cause — so we log first, always.
process.on("unhandledRejection", (reason) => {
  log.error("unhandledRejection:", reason);
});

process.on("uncaughtException", (reason) => {
  log.error("uncaughtException:", reason);
  // State is unknown after an uncaught exception — flush settings and let PM2
  // bring up a clean process rather than continuing in a half-broken state.
  flushNow();
  process.exit(1);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    log.info(`Received ${sig}, shutting down...`);
    // Flush the debounced guildSettings write BEFORE exiting, otherwise an
    // `.access mode` change made <500ms ago is silently dropped.
    flushNow();
    client.destroy();
    process.exit(0);
  });
}

// Login — catch so a bad/missing token produces a clear one-line error
// instead of a raw unhandled-rejection stack trace.
client.login(config.discord.token).catch((e) => {
  log.error("Login failed:", e?.message || e);
  process.exit(1);
});

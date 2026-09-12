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
  client.user.setPresence({
    activities: [{ name: "music | /play", type: ActivityType.Listening }],
    status: "online",
  });

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

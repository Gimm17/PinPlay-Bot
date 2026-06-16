const { Client, GatewayIntentBits, Partials, ActivityType } = require("discord.js");
const { config } = require("./config");

const { loadCommands } = require("./handlers/commandLoader");
const { attachInteractionHandler } = require("./handlers/interactionHandler");
const { attachMessageHandler } = require("./handlers/messageHandler");

const { createKazagumo } = require("./music/kazagumo");
const { attachMusicEvents } = require("./music/events");
const { readAll, getGuildSettings } = require("./utils/storage");
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

// Login
client.login(config.discord.token);

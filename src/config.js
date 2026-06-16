const dotenv = require("dotenv");
dotenv.config();

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

const config = {
  discord: {
    token: process.env.DISCORD_TOKEN || null,
    clientId: process.env.CLIENT_ID || null,
    guildId: process.env.GUILD_ID || null,
    ownerId: process.env.OWNER_ID || null
  },
  lavalink: {
    name: process.env.LAVALINK_NAME || "local",
    host: required("LAVALINK_HOST"),
    port: Number(required("LAVALINK_PORT")),
    password: required("LAVALINK_PASSWORD"),
    secure: String(process.env.LAVALINK_SECURE || "false").toLowerCase() === "true"
  },
  defaults: {
    volume: Number(process.env.DEFAULT_VOLUME || 60),
    leaveTimeoutSec: Number(process.env.LEAVE_TIMEOUT_SEC || 120)
  },
  spotify: {
    clientId: process.env.SPOTIFY_CLIENT_ID || null,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET || null,
    spDc: process.env.SPOTIFY_SP_DC || null
  },
  nvidia: {
    apiKey: process.env.NVIDIA_API_KEY || null
  },
  tokenrouter: {
    apiKey: process.env.TOKENROUTER_API_KEY || null
  },
  ai: {
    defaultProvider: process.env.AI_DEFAULT_PROVIDER || "nvidia",
    defaultModel: process.env.AI_DEFAULT_MODEL || null
  },
  logLevel: (process.env.LOG_LEVEL || "info").toLowerCase(),
  prefix: process.env.PREFIX || ".",
};

module.exports = { config };

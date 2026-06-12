const { Kazagumo, Plugins } = require("kazagumo");
const { Connectors } = require("shoukaku");

const { config } = require("../config");
const { makeLogger } = require("../utils/logger");

function createKazagumo(client) {
  const log = makeLogger(config.logLevel);

  const nodes = [
    {
      name: config.lavalink.name,
      url: `${config.lavalink.host}:${config.lavalink.port}`,
      auth: config.lavalink.password,
      secure: config.lavalink.secure,
    },
  ];

  const kazagumo = new Kazagumo(
    {
      defaultSearchEngine: "youtube",
      plugins: [
        // Optional plugins for better platform parsing/features.
        new Plugins.PlayerMoved(client),
      ],
      send: (guildId, payload) => {
        const guild = client.guilds.cache.get(guildId);
        if (guild) guild.shard.send(payload);
      },
    },
    new Connectors.DiscordJS(client),
    nodes
  );

  // NOTE: Lavalink/Shoukaku events (ready, error, close, disconnect)
  // are registered in index.js to avoid duplicate listeners.

  return kazagumo;
}

module.exports = { createKazagumo };

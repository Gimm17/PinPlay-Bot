const { Kazagumo, Plugins } = require("kazagumo");
const { Connectors } = require("shoukaku");
const net = require("net");

const { config } = require("../config");
const { makeLogger } = require("../utils/logger");

/**
 * Wait until Lavalink's TCP port accepts connections.
 *
 * Why this exists: Shoukaku retries a FIXED number of times and then stops for
 * good — the node stays DISCONNECTED while PM2 still reports the bot "online".
 * Measured on this VPS: after Lavalink was down for ~2 minutes, the bot had
 * exhausted its retries and never recovered on its own; only a bot restart
 * fixed it. Raising the retry count just moves the deadline.
 *
 * So instead of racing Lavalink at boot, we wait for the port first. Returns
 * true as soon as it connects, false if the deadline passes (in which case we
 * proceed anyway — Shoukaku still gets its normal retries, and the bot should
 * come up even if Lavalink is permanently down).
 */
function waitForLavalinkPort(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const attempt = () => {
      const sock = net.connect({ host, port });
      const done = (ok) => {
        sock.removeAllListeners();
        sock.destroy();
        if (ok) return resolve(true);
        if (Date.now() >= deadline) return resolve(false);
        setTimeout(attempt, 1000);
      };
      sock.setTimeout(2000, () => done(false));
      sock.once("connect", () => done(true));
      sock.once("error", () => done(false));
    };
    attempt();
  });
}

/**
 * Register the Lavalink node(s) once the port is reachable.
 * Call this AFTER waitForLavalinkPort resolves — adding a node is what triggers
 * Shoukaku to dial, so timing this correctly is the whole point.
 * Returns true if nodes were added.
 */
function connectLavalink(kazagumo) {
  const nodes = kazagumo._pendingNodes || [];
  if (nodes.length === 0) return false;
  if (kazagumo.shoukaku.nodes && kazagumo.shoukaku.nodes.size > 0) return false;
  for (const node of nodes) kazagumo.shoukaku.addNode(node);
  return true;
}

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
    // START WITH NO NODES. Shoukaku's Connector registers its own
    // `client.once("clientReady", () => this.ready(nodes))` — i.e. it dials the
    // node the moment Discord is ready, which races Lavalink's boot. Its retry
    // budget is finite, so losing that race leaves the node permanently
    // DISCONNECTED while PM2 still reports the bot "online".
    //
    // So we keep the node list empty and add the node ourselves once the port is
    // actually open (see connectLavalink below / index.js).
    [],
    {
      // Safety net for a Lavalink that accepts TCP but is slow to finish the
      // WebSocket handshake. NOTE reconnectInterval is in SECONDS — Shoukaku
      // multiplies it by 1000 internally, so 10_000 would mean ~2.8h per retry.
      reconnectTries: 12,
      reconnectInterval: 5,
    }
  );

  // Keep the node definition around so the caller can register it after waiting.
  kazagumo._pendingNodes = nodes;

  // NOTE: Lavalink/Shoukaku events (ready, error, close, disconnect)
  // are registered in index.js to avoid duplicate listeners.

  return kazagumo;
}

module.exports = { createKazagumo, connectLavalink, waitForLavalinkPort };

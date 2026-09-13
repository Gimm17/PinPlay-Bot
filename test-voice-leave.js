// test-voice-leave.js - forced-disconnect teardown regression test.
// Run: node test-voice-leave.js
//
// Bug this pins: right-clicking the bot in Discord > Disconnect emits
// playerMoved(LEFT) but nothing destroys the Kazagumo player, so the old queue
// and queue.current survive. The next /play then restarts the previous user's
// track (or queues silently while `playing` is still true).
//
// The fix has two halves:
//   1. music/events.js listens to the bot's own voiceStateUpdate and tears the
//      player down when the bot is no longer in voice (except 24/7).
//   2. play.js / play-yt.js refuse to reuse a player whose voice connection is
//      already gone, checked against Discord's LIVE state rather than the stale
//      player.voiceId.
//
// Part 1 is exercised here; part 2 is asserted on the source of the stale guard.

require("dotenv").config();

const assert = require("assert");
const path = require("path");
const fs = require("fs");

// --- stub the modules that would otherwise hit disk / Discord REST ---
const storagePath = require.resolve("./src/utils/storage");
require.cache[storagePath] = {
  id: storagePath,
  filename: storagePath,
  loaded: true,
  exports: {},
};
const panelPath = require.resolve("./src/music/panel");
require.cache[panelPath] = {
  id: panelPath,
  filename: panelPath,
  loaded: true,
  exports: { updatePanel: async () => {}, schedulePanelUpdate: () => {} },
};
const historyPath = require.resolve("./src/commands/history");
require.cache[historyPath] = {
  id: historyPath,
  filename: historyPath,
  loaded: true,
  exports: { recordTrack: () => {}, getHistory: () => [] },
};

// storage is also reached indirectly (autoplay -> storage); keep one shared state.
let stay247 = false;
require.cache[storagePath].exports = {
  getGuildSettings: () => ({ stay247, volume: 60 }),
  setGuildSettings: () => ({}),
  readAll: () => ({}),
  flushNow: () => {},
};

const { attachMusicEvents } = require("./src/music/events");

const BOT_ID = "999999999999999999";
const GUILD_ID = "723885708527403121";
const VOICE_ID = "723885709223788648";

function makeFakeClient({ withPlayer }) {
  const handlers = new Map();
  const destroyed = [];
  const player = {
    guildId: GUILD_ID,
    voiceId: VOICE_ID,
    queue: { size: 3, current: { title: "stale song" } },
    destroy: async () => {
      destroyed.push(GUILD_ID);
    },
  };
  const players = new Map(withPlayer ? [[GUILD_ID, player]] : []);
  const client = {
    user: { id: BOT_ID },
    on: (event, fn) => handlers.set(event, fn),
    kazagumo: {
      on: () => {},
      players,
    },
  };
  return { client, handlers, destroyed, player };
}

let passed = 0;
function check(name, cond, extra) {
  if (cond) {
    passed++;
    console.log(`  ok: ${name}`);
  } else {
    console.error(`  FAIL: ${name}${extra ? " :: " + JSON.stringify(extra) : ""}`);
    process.exitCode = 1;
  }
}

function fireLeave(handlers, { newChannelId = null, oldChannelId = VOICE_ID, userId = BOT_ID } = {}) {
  const fn = handlers.get("voiceStateUpdate");
  if (!fn) throw new Error("no voiceStateUpdate handler registered");
  return fn(
    { id: userId, channelId: oldChannelId, guild: { id: GUILD_ID } },
    { id: userId, channelId: newChannelId, guild: { id: GUILD_ID } }
  );
}

async function main() {
  console.log("=== Forced disconnect teardown test ===\n");

  // 1. Bot leaves voice with a live player -> player destroyed.
  {
    stay247 = false;
    const { client, handlers, destroyed } = makeFakeClient({ withPlayer: true });
    attachMusicEvents(client);
    check("registers a voiceStateUpdate handler", handlers.has("voiceStateUpdate"));
    fireLeave(handlers);
    await new Promise((r) => setImmediate(r));
    check("bot leaving voice destroys the stale player", destroyed.length === 1, { destroyed });
  }

  // 2. 24/7 on -> player must SURVIVE a manual disconnect (that is the point of 24/7).
  {
    stay247 = true;
    const { client, handlers, destroyed } = makeFakeClient({ withPlayer: true });
    attachMusicEvents(client);
    fireLeave(handlers);
    await new Promise((r) => setImmediate(r));
    check("24/7 keeps the player across a manual disconnect", destroyed.length === 0, { destroyed });
  }

  // 3. Someone else leaves voice -> bot must not tear down.
  {
    stay247 = false;
    const { client, handlers, destroyed } = makeFakeClient({ withPlayer: true });
    attachMusicEvents(client);
    fireLeave(handlers, { userId: "123456789012345678" });
    await new Promise((r) => setImmediate(r));
    check("another user leaving voice does not touch the player", destroyed.length === 0, { destroyed });
  }

  // 4. Bot MOVES between channels -> not a leave, player stays.
  {
    stay247 = false;
    const { client, handlers, destroyed } = makeFakeClient({ withPlayer: true });
    attachMusicEvents(client);
    fireLeave(handlers, { newChannelId: "111111111111111111" });
    await new Promise((r) => setImmediate(r));
    check("moving channels does not destroy the player", destroyed.length === 0, { destroyed });
  }

  // 5. No player -> handler must be a no-op, not a crash.
  {
    stay247 = false;
    const { client, handlers, destroyed } = makeFakeClient({ withPlayer: false });
    attachMusicEvents(client);
    fireLeave(handlers);
    await new Promise((r) => setImmediate(r));
    check("no player present -> nothing to destroy", destroyed.length === 0, { destroyed });
  }

  // 6. play.js / play-yt.js must NOT trust the stale player.voiceId — they have to
  //    consult Discord's live voice state before reusing the player.
  for (const file of ["src/commands/play.js", "src/commands/play-yt.js"]) {
    const src = fs.readFileSync(path.join(__dirname, file), "utf8");
    check(
      `${file} guards reuse against live voice state`,
      /members\.me\?\.voice\?\.channelId/.test(src) && /stale player/.test(src)
    );
    check(
      `${file} destroys the stale player before reuse`,
      /if \(player && !liveVoiceId\)/.test(src)
    );
  }

  console.log(`\n${passed} checks passed${process.exitCode ? " (with failures)" : ""}`);
}

main().catch((e) => {
  console.error("TEST ERROR:", e);
  process.exit(1);
});

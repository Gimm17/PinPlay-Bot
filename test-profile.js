// test-profile.js - smoke test for the per-user music profile.
// Run: node test-profile.js
//
// Pins the behaviour that is easy to get wrong:
//   1. aggregation is per USER, not per guild (increments, ordering, caps)
//   2. "friends" is a Jaccard ranking, not a co-listening log
//   3. the profile survives a load/save round-trip with titles intact
//      (the first design kept titles in a memory-only map, so every restart
//      rendered raw URIs — this test would have caught that)
//   4. the command module loads and registers, with no dependency on the
//      GuildMembers intent.

require("dotenv").config();

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const dataFile = path.join(process.cwd(), "data", "userPlayHistory.json");
const backup = fs.existsSync(dataFile) ? fs.readFileSync(dataFile, "utf8") : null;

const up = require("./src/utils/userPlayHistory");

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

const A = "100000000000000001";
const B = "100000000000000002";
const C = "100000000000000003";
const t = (uri, title, author) => ({ uri, title, author });

async function main() {
  console.log("=== Profile smoke test ===\n");

  // Start clean so counts are deterministic.
  for (const id of [A, B, C]) up.resetUser(id);
  up.flushNow();

  // --- aggregation ---
  up.recordPlay({ userId: A, guildId: "g1", track: t("u1", "Song One", "Artist X") });
  up.recordPlay({ userId: A, guildId: "g1", track: t("u2", "Song Two", "Artist Y") });
  up.recordPlay({ userId: A, guildId: "g1", track: t("u2", "Song Two", "Artist Y") });
  up.recordPlay({ userId: A, guildId: "g2", track: t("u3", "Song Three", "Artist Z") });

  let p = up.getUserProfile(A);
  check("totalPlays counts every play", p.totalPlays === 4, p);
  check("top track is the most-played one", p.tracks[0].title === "Song Two", p.tracks);
  check("top track count reflects repeats", p.tracks[0].count === 2, p.tracks[0]);
  check("guild counts aggregate per guild",
    p.guilds.find((g) => g.guildId === "g1")?.count === 3, p.guilds);
  check("no friends yet (only one user has history)", p.friends.length === 0, p.friends);

  // --- per-user isolation ---
  up.recordPlay({ userId: B, guildId: "g1", track: t("u9", "Only B Song", "Artist Q") });
  const pb = up.getUserProfile(B);
  check("other user's data is separate", pb.tracks.length === 1 && pb.tracks[0].title === "Only B Song", pb.tracks);
  check("user A unaffected by user B", up.getUserProfile(A).tracks.length === 3, up.getUserProfile(A).tracks);

  // --- friends = Jaccard over played tracks ---
  // A = {u1, u2, u3}, C = {u2, u7, u8}: |∩| = 1, |∪| = 5 -> 1/5 = 0.2
  up.recordPlay({ userId: C, guildId: "g1", track: t("u2", "Song Two", "Artist Y") });
  up.recordPlay({ userId: C, guildId: "g1", track: t("u7", "C Song", "Artist Q") });
  up.recordPlay({ userId: C, guildId: "g1", track: t("u8", "C Song 2", "Artist Q") });

  p = up.getUserProfile(A);
  check("friend ranking finds the overlapping user",
    p.friends.length === 1 && p.friends[0].userId === C, p.friends);
  check("jaccard score = shared / union (1/5)",
    Math.abs(p.friends[0].score - 0.2) < 1e-9, p.friends[0]);
  check("shared track count reported", p.friends[0].sharedTracks === 1, p.friends[0]);
  check("a user below the minimum-track floor is not ranked",
    up.getUserProfile(B).friends.length === 0, up.getUserProfile(B).friends);

  // --- persistence round-trip (titles must survive) ---
  up.flushNow();
  const onDisk = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  check("file written with the user bucket", Boolean(onDisk.users?.[A]), Object.keys(onDisk.users || {}));
  check("track titles persisted, not just uris",
    onDisk.users[A].tracks.u2?.title === "Song Two", onDisk.users[A].tracks.u2);

  // Simulate a restart: drop the cached module and read the file back.
  delete require.cache[require.resolve("./src/utils/userPlayHistory")];
  const up2 = require("./src/utils/userPlayHistory");
  const afterRestart = up2.getUserProfile(A);
  check("profile survives a restart with real titles",
    afterRestart.tracks.some((x) => x.title === "Song Two"), afterRestart.tracks);
  check("counts survive a restart", afterRestart.totalPlays === 4, afterRestart.totalPlays);

  // --- reset ---
  check("reset removes the user", up2.resetUser(A) === true);
  check("reset is a no-op for an unknown user", up2.resetUser("000000000000000000") === false);
  check("empty profile for a cleared user",
    up2.getUserProfile(A).totalPlays === 0, up2.getUserProfile(A));

  // --- command module ---
  const cmd = require("./src/commands/profile.js");
  check("profile command exports data + execute",
    Boolean(cmd.data && typeof cmd.execute === "function"));
  const json = cmd.data.toJSON();
  check("profile has view + reset subcommands",
    json.options.map((o) => o.name).join(",") === "view,reset", json.options.map((o) => o.name));
  check("view takes an optional user option",
    json.options[0].options?.[0]?.name === "user" && !json.options[0].options[0].required);
  // The feature must not quietly depend on the privileged GuildMembers intent:
  // the target user comes from the interaction payload, and resolving a cached
  // id to a name goes through the user cache or a REST fetch.
  {
    const src = fs.readFileSync(path.join("src", "commands", "profile.js"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    check("profile.js does not reference a GuildMembers intent", !/GatewayIntentBits/.test(code));
    check("profile.js does not call members.fetch", !/members\.fetch/.test(code));
    check("profile.js names users via users.fetch (no intent needed)",
      /users\.fetch/.test(code) || /users\?\.cache/.test(code));
  }

  // --- cleanup: restore whatever was there before the test ---
  for (const id of [A, B, C]) up2.resetUser(id);
  up2.flushNow();
  if (backup !== null) fs.writeFileSync(dataFile, backup, "utf8");

  console.log(`\n${passed} checks passed${process.exitCode ? " (with failures)" : ""}`);
}

main().catch((e) => {
  console.error("TEST ERROR:", e);
  if (backup !== null) {
    try {
      fs.writeFileSync(dataFile, backup, "utf8");
    } catch {
      /* best effort */
    }
  }
  process.exit(1);
});

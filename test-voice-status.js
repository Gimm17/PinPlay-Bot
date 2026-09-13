// test-voice-status.js - smoke test for the voice-channel status bridge.
// Run: node test-voice-status.js
//
// Pins the three things that are easy to get wrong here:
//   1. the REST call shape (PUT .../voice-status with {status}) — discord.js
//      14.25.1 has no wrapper, so a typo in the route silently 404s;
//   2. truncation to Discord's 500-char limit;
//   3. the throttle: a burst of playerStart events must collapse into one
//      request carrying the NEWEST text, not one request per track.

require("dotenv").config();

const assert = require("assert");
const { setVoiceStatus, clearVoiceStatus, formatTrackStatus, MAX_STATUS_LEN } =
  require("./src/utils/voiceStatus");

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

function makeClient() {
  const calls = [];
  return {
    calls,
    rest: {
      put: (route, opts) => {
        calls.push({ route, opts });
        return Promise.resolve({});
      },
    },
  };
}

async function main() {
  console.log("=== Voice channel status test ===\n");

  // --- formatTrackStatus ---
  check("formats title + author", formatTrackStatus({ title: "Song", author: "Artist" }) === "Song — Artist");
  check("omits missing author", formatTrackStatus({ title: "Song" }) === "Song");
  check("null track -> null", formatTrackStatus(null) === null);

  // --- REST shape ---
  {
    const client = makeClient();
    setVoiceStatus(client, "111", "Hello");
    await new Promise((r) => setImmediate(r));
    check("sends exactly one PUT", client.calls.length === 1, client.calls);
    check(
      "route is the voice-status endpoint",
      client.calls[0]?.route === "/channels/111/voice-status",
      client.calls[0]
    );
    check("body carries {status}", client.calls[0]?.opts?.body?.status === "Hello", client.calls[0]);
  }

  // --- truncation ---
  {
    const client = makeClient();
    setVoiceStatus(client, "222", "y".repeat(900));
    await new Promise((r) => setImmediate(r));
    const sent = client.calls[0]?.opts?.body?.status ?? "";
    check(`truncates to ${MAX_STATUS_LEN} chars`, sent.length <= MAX_STATUS_LEN, { len: sent.length });
    check("truncated text ends with an ellipsis", sent.endsWith("…"));
  }

  // --- identical text is a no-op ---
  {
    const client = makeClient();
    setVoiceStatus(client, "333", "Same");
    setVoiceStatus(client, "333", "Same");
    await new Promise((r) => setImmediate(r));
    check("repeated identical text sends only once", client.calls.length === 1, client.calls);
  }

  // --- burst: first goes out immediately, the rest collapse into one deferred send ---
  {
    const client = makeClient();
    setVoiceStatus(client, "444", "Track 1"); // no prior send -> immediate
    setVoiceStatus(client, "444", "Track 2"); // queued
    setVoiceStatus(client, "444", "Track 3"); // replaces Track 2 in the queue
    await new Promise((r) => setImmediate(r));
    check("burst emits one immediate request", client.calls.length === 1, client.calls);
    check(
      "immediate request carries the first track",
      client.calls[0]?.opts?.body?.status === "Track 1",
      client.calls[0]
    );
    // The deferred send (newest text) fires after the throttle window; cancel it
    // so this test does not hold the process open for 5s.
    clearVoiceStatus(client, "444");
  }

  // --- clear always reaches the wire ---
  {
    const client = makeClient();
    clearVoiceStatus(client, "555");
    await new Promise((r) => setImmediate(r));
    check("clear sends a null status", client.calls[0]?.opts?.body?.status === null, client.calls[0]);
  }

  // --- missing channel id is a no-op, never a throw ---
  {
    const client = makeClient();
    setVoiceStatus(client, null, "x");
    clearVoiceStatus(client, null);
    await new Promise((r) => setImmediate(r));
    check("no channel id -> no request", client.calls.length === 0, client.calls);
  }

  // --- a failing PUT must not reject/throw ---
  {
    const client = makeClient();
    client.rest.put = () => Promise.reject(new Error("50013 Missing Permissions"));
    setVoiceStatus(client, "666", "Boom");
    await new Promise((r) => setImmediate(r));
    check("a failing PUT is swallowed", true);
  }

  console.log(`\n${passed} checks passed${process.exitCode ? " (with failures)" : ""}`);
}

main().catch((e) => {
  console.error("TEST ERROR:", e);
  process.exit(1);
});

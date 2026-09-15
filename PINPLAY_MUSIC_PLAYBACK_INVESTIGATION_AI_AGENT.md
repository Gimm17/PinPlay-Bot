# PINPLAY BOT — Music Playback Investigation & Open-Source Reference Guide

> **Project:** PinPlay Discord Music Bot  
> **Repository:** https://github.com/Gimm17/PinPlay-Bot  
> **Purpose:** Technical investigation guide for an AI coding agent to diagnose and repair silent Discord music playback, Lavalink compatibility, Spotify resolution, and source fallback behavior.  
> **Research snapshot:** 2026-09-13  
> **Primary rule:** Preserve all existing features, commands, UI/UX, permissions, queue behavior, AI features, and business logic unless a change is strictly required to repair playback.

---

# 1. Objective

PinPlay currently has a critical playback issue:

- Bot can join a Discord voice channel.
- A track may be found/resolved.
- Playback may appear to start.
- However, **no audio is heard**.
- Spotify playback/resolution is also unreliable or failing.
- Lavalink is suspected, but the problem must be isolated instead of assumed.

The AI agent's task is to:

1. Read and understand the complete PinPlay codebase.
2. Reproduce the problem.
3. Trace the full audio pipeline.
4. Determine whether the failure is caused by:
   - Discord voice/DAVE compatibility.
   - Lavalink server version.
   - Lavalink client/wrapper compatibility.
   - Kazagumo.
   - Shoukaku.
   - Voice state forwarding.
   - Spotify/LavaSrc.
   - YouTube source/plugin.
   - Search/resolution logic.
   - Track queue/player state.
   - Network/firewall/UDP.
   - Incorrect Lavalink configuration.
5. Study open-source Discord music bots listed in this document.
6. Compare their implementation with PinPlay.
7. Implement the **smallest maintainable fix**.
8. Add diagnostics/fallbacks so the same class of failure is easier to identify later.

Do **not** rewrite PinPlay from scratch.

---

# 2. PinPlay Repository

Main repository:

https://github.com/Gimm17/PinPlay-Bot

At the time of research the repository advertises:

- Discord.js v14-era architecture.
- Lavalink v4.
- Multi-platform audio.
- Spotify support.
- YouTube support.
- SoundCloud support.
- `/play`
- `/play-yt`
- `/search`
- Queue controls.
- 24/7 mode.
- Auto reconnect.
- Audio filters.
- Interactive music panel.
- AI playlist features.

Important existing feature:

`/play-yt`

This command is described as a **YouTube-only bypass** for Spotify/API rate-limit problems.

The AI agent MUST use `/play-yt` during diagnosis because it can help separate:

```text
Spotify problem
```

from:

```text
voice / Lavalink / Discord transport problem
```

---

# 3. Most Important Current Finding: Discord DAVE / E2EE

## 3.1 Lavalink 4.2.0

Official Lavalink release history states that:

**Lavalink 4.2.0 is the first Lavalink release with DAVE / E2EE voice support.**

Official sources:

https://github.com/lavalink-devs/Lavalink/releases

https://github.com/lavalink-devs/Lavalink/blob/master/CHANGELOG.md

Relevant upstream note:

> Lavalink 4.2.0 is the first release with DAVE support.  
> A compatible client library is also required.  
> Voice state now includes a required `channelId` field for Discord voice connections.

Therefore:

### P0 CHECK

The AI agent MUST determine the **actual running Lavalink JAR version**.

Do not trust only:

- README text.
- package.json.
- documentation.
- folder names.
- Docker tag text.
- comments.

Check the actual process / JAR / container / startup logs.

If PinPlay runs:

```text
Lavalink 4.0.x
Lavalink 4.1.x
```

that is a major red flag for current Discord voice operation.

Minimum DAVE-capable Lavalink family:

```text
>= Lavalink 4.2.0
```

However, do **not** blindly upgrade only Lavalink.

The JavaScript Lavalink client/wrapper must also support the new voice/DAVE behavior.

---

# 4. Primary Hypothesis

The symptom:

```text
Bot joins voice
Track resolves
Track appears to start
No sound
```

is different from:

```text
Spotify URL cannot be resolved
```

These must be treated as two independent failure domains.

Potential pipeline:

```text
User
  |
  v
/play
  |
  v
Query Parser
  |
  +-------------------+
  |                   |
  v                   v
Spotify URL         Text / YouTube URL
  |                   |
  v                   |
Spotify Metadata       |
LavaSrc/API             |
  |                   |
  v                   |
Playable Source Resolver
  |
  v
Lavalink loadTracks
  |
  v
Encoded Track
  |
  v
Kazagumo
  |
  v
Shoukaku
  |
  v
Lavalink
  |
  v
Discord Voice Gateway
  |
  v
DAVE / E2EE
  |
  v
RTP / UDP Audio
  |
  v
Discord Voice Channel
```

A failure anywhere after track resolution can produce a UI that looks like playback started while the user hears nothing.

---

# 5. Spotify: Correct Mental Model

Do not assume Spotify is an audio streaming source for the Discord bot.

The safer architecture is:

```text
Spotify URL
    |
    v
Spotify metadata
    |
    +--> title
    +--> artist
    +--> album
    +--> ISRC when available
    |
    v
Resolver
    |
    +--> YouTube Music
    +--> YouTube
    +--> SoundCloud
    +--> another playable source
    |
    v
Actual playable audio track
```

In other words:

> Spotify should normally be treated as a metadata/catalog/resolution source, not as the final audio transport.

This pattern is used by several open-source music bots.

---

# 6. Ten Open-Source Repositories to Study

The agent must inspect these repositories selectively.

Do **not** copy code blindly.

Study architecture, error handling, resolver strategy, event flow, voice integration, and fallback design.

---

## 6.1 Bongo Lavamusic

Repository:

https://github.com/bongo-devs/lavamusic

Why study it:

- Large open-source Discord music bot.
- Discord.js v14 ecosystem.
- Lavalink based.
- Multi-platform search.
- YouTube.
- Spotify.
- SoundCloud.
- Direct URLs.
- Queue and filters.
- Useful reference for a modern Lavalink architecture.

Investigate:

- Lavalink client initialization.
- Node connection lifecycle.
- Player creation.
- Voice update handling.
- Track loading.
- Search source identifiers.
- Reconnection/resume behavior.
- Track exception handling.
- Track stuck handling.
- Node failure handling.
- Autoplay/fallback behavior.

Priority:

**HIGH**

---

## 6.2 Aurox

Repository:

https://github.com/adh319/Aurox

Why study it:

Aurox is especially important because its documented stack is very close to PinPlay:

```text
Discord.js v14
Kazagumo
Shoukaku
Lavalink
```

Investigate carefully:

- Kazagumo initialization.
- Shoukaku initialization.
- Discord.js connector.
- `send` / gateway packet forwarding.
- Voice state updates.
- Voice server updates.
- Player creation.
- Search implementation.
- Node options.
- Resume/reconnect configuration.
- Event listeners.
- Track start/end/error handling.

Compare file-by-file with PinPlay where architecture is equivalent.

Priority:

**VERY HIGH**

---

## 6.3 thiagobrucezzi/Discord-Music-Bot

Repository:

https://github.com/thiagobrucezzi/Discord-Music-Bot

Why study it:

Another implementation explicitly using:

```text
Kazagumo
Shoukaku
Lavalink
```

Useful as a second comparison so the investigation does not overfit Aurox.

Investigate:

- Player manager construction.
- Discord connector.
- Node definitions.
- Search engine selection.
- Queue transitions.
- Voice connection.
- Lavalink configuration under its `lavalink/` directory.

Priority:

**HIGH**

---

## 6.4 zienshang/music-bot

Repository:

https://github.com/zienshang/music-bot

Documented stack:

```text
Python
Wavelink 3.x
Lavalink 4.x
YouTube
Spotify
SoundCloud
```

Why study it:

It provides a different client implementation while using the same Lavalink concept.

Its documented Lavalink config is useful because it shows:

- YouTube source disabled in core Lavalink.
- Separate Lavalink YouTube plugin.
- LavaSrc plugin.
- Multiple YouTube clients.
- YouTube OAuth configuration.

Investigate:

- `Lavalink server/application.yml`
- Wavelink node connection.
- Spotify resolution.
- Search behavior.
- YouTube plugin configuration.
- OAuth behavior.

Priority:

**MEDIUM-HIGH**

---

## 6.5 BeatDock

Repository:

https://github.com/albertgmz/BeatDock

Why study it:

BeatDock explicitly documents:

```text
Spotify support:
search and resolve via YouTube
```

It also has Lavalink fallback behavior.

This is an important conceptual reference for improving PinPlay's resolver abstraction.

Investigate:

- Spotify parsing.
- Metadata extraction.
- Spotify -> YouTube resolver.
- Search matching.
- Error handling.
- Public Lavalink fallback architecture.
- Node availability detection.

Do not automatically copy its public Lavalink strategy into production.

Public Lavalink nodes can introduce:

- privacy concerns,
- instability,
- rate limiting,
- version mismatches,
- plugin differences,
- abuse limits.

Priority:

**VERY HIGH for resolver strategy**

---

## 6.6 Glaxier0/discord-music-bot

Repository:

https://github.com/Glaxier0/discord-music-bot

Documented stack:

```text
Java
JDA
Lavalink
Lavalink Client
Spotify API
```

Why study it:

Different language, but useful for understanding clean separation of concerns between:

```text
Discord
Lavalink
Spotify API
```

Investigate:

- Spotify service abstraction.
- Lavalink service abstraction.
- Search conversion.
- Error handling.
- Configuration separation.
- Player state.

Priority:

**MEDIUM**

---

## 6.7 Muse

Repository:

https://github.com/museofficial/muse

Repository:

https://github.com/museofficial/muse

Why study it:

Muse is useful as an architectural alternative.

Focus on:

- Spotify URL handling.
- Track conversion/resolution.
- Playable source discovery.
- Cache strategy.
- Queue/player design.
- Error recovery.

Do not assume its exact audio stack is directly compatible with PinPlay.

Use it to learn patterns rather than copy implementation.

Priority:

**HIGH for source resolution concepts**

---

## 6.8 Just-Some-Bots/MusicBot

Repository:

https://github.com/Just-Some-Bots/MusicBot

Why study it:

This is important because it provides a **non-Lavalink comparison**.

Typical pipeline:

```text
yt-dlp
  |
  v
media information / stream URL
  |
  v
FFmpeg
  |
  v
Discord VoiceClient
```

Investigate:

- yt-dlp source extraction.
- FFmpeg playback.
- Stream retry logic.
- HTTP/proxy support.
- YouTube authentication/OAuth behavior.
- Spotify -> playable source conversion if present.
- Player error handling.

This can be used to understand how a fallback architecture could work.

Do NOT add yt-dlp/FFmpeg fallback to PinPlay before the root problem is known.

Priority:

**HIGH as architectural comparison**

---

## 6.9 zz-xx/discord-music-bot

Repository:

https://github.com/zz-xx/discord-music-bot

Documented stack:

```text
Python
Lavalink
Wavelink
Spotify API
```

Why study it:

Simpler implementation.

A smaller codebase can make the Spotify/Lavalink interaction easier to understand than a large production bot.

Investigate:

- Spotify integration.
- Track search.
- Playlist behavior.
- Lavalink node setup.
- Player lifecycle.

Priority:

**MEDIUM**

---

## 6.10 Tomato6966 — discord-js-lavalink-Music-Bot-erela-js

Repository:

https://github.com/Tomato6966/discord-js-lavalink-Music-Bot-erela-js

Why study it:

Historical reference for:

- queue architecture,
- Lavalink flow,
- command behavior,
- autoplay,
- node handling.

WARNING:

This repository uses older technologies such as Erela.js and must **not** be considered a current implementation template.

Do not copy:

- old Discord.js patterns,
- old Lavalink config,
- deprecated APIs,
- old voice logic.

Use only for architectural ideas.

Priority:

**LOW / HISTORICAL**

---

# 7. Upstream Projects the Agent MUST Also Read

These are more important than random Discord bot repositories.

## Lavalink

https://github.com/lavalink-devs/Lavalink

Releases:

https://github.com/lavalink-devs/Lavalink/releases

Changelog:

https://github.com/lavalink-devs/Lavalink/blob/master/CHANGELOG.md

---

## Shoukaku

Find and inspect the current official repository/package used by PinPlay.

The agent must determine:

- Exact installed version.
- Exact resolved version from lock file.
- DAVE compatibility.
- Lavalink 4.2.x compatibility.
- Voice state requirements.
- Open issues related to silent playback.
- Recent releases.

Do not assume compatibility based solely on semver.

---

## Kazagumo

Find and inspect the current official repository/package used by PinPlay.

Determine:

- Exact installed version.
- Compatibility with current Shoukaku.
- Compatibility with Lavalink >= 4.2.0.
- Whether active maintenance is sufficient.
- Voice/player behavior changes.
- Open issues.

---

## LavaSrc

Study the exact LavaSrc plugin used by PinPlay.

Determine:

- Exact plugin version.
- Compatible Lavalink range.
- Spotify behavior.
- Required Spotify credentials.
- Whether Spotify is resolved to another source.
- ISRC behavior.
- Search fallback.
- Apple Music/Deezer behavior if enabled.

---

## Lavalink YouTube Plugin

Determine:

- Exact version used.
- Lavalink compatibility.
- Supported YouTube clients.
- OAuth requirements.
- Whether current YouTube restrictions affect playback.
- Whether source managers are configured correctly.

---

# 8. Mandatory Investigation Workflow for the AI Agent

The following order is mandatory.

Do not start by rewriting Spotify.

---

## Phase 0 — Safety & Baseline

Before changing code:

1. Read `AGENTS.md`.
2. Read `README.md`.
3. Read `package.json`.
4. Read `package-lock.json`.
5. Read `.env.example`.
6. Inspect `src/`.
7. Inspect `lavalink/`.
8. Inspect launcher scripts.
9. Inspect deployment scripts.
10. Inspect existing diagnostics/tests.

Create an internal system map.

Identify:

```text
entrypoint
Discord client
Kazagumo manager
Shoukaku connector
Lavalink nodes
music commands
search/resolver
queue
player events
voice state forwarding
24/7 reconnect
Spotify logic
YouTube logic
LavaSrc config
```

Do not change code during initial reading.

---

# 9. Establish Exact Runtime Versions

Produce a table:

| Component | package/config claims | lockfile | actual runtime | compatible? |
|---|---:|---:|---:|---|
| Node.js | | | | |
| discord.js | | | | |
| Kazagumo | | | | |
| Shoukaku | | | | |
| Java | | | | |
| Lavalink | | | | |
| LavaSrc | | | | |
| YouTube plugin | | | | |

Important:

The running Lavalink version is more important than a README statement.

Capture Lavalink startup output.

---

# 10. Check Discord DAVE Compatibility First

P0 questions:

```text
Is Lavalink >= 4.2.0?
```

```text
Does the current Lavalink client support DAVE?
```

```text
Does the client's voice state include channelId where required?
```

```text
Are VOICE_STATE_UPDATE and VOICE_SERVER_UPDATE reaching the Lavalink client correctly?
```

```text
Does the bot receive a valid sessionId?
```

```text
Does Lavalink establish the voice connection successfully?
```

```text
Does Lavalink emit any DAVE/voice errors?
```

If any of these fail, fix the voice transport layer before touching Spotify.

---

# 11. Isolation Tests

Run each test independently.

Record:

```text
input
resolved source
load result
encoded track
player state
track event
Lavalink log
Discord voice state
audible result
```

---

## Test A — Direct playable URL

Use a legally accessible direct audio test source controlled by the developer if available.

Goal:

Bypass Spotify and YouTube resolution.

Interpretation:

```text
Direct audio also silent
=> likely voice / Lavalink / transport / player problem
```

---

## Test B — SoundCloud

Use a normal supported SoundCloud track.

Interpretation:

```text
SoundCloud resolves + starts + silent
=> Spotify is NOT the primary root cause
```

---

## Test C — YouTube via `/play-yt`

PinPlay already has `/play-yt`.

Test:

```text
/play-yt <normal song title>
```

and, where supported:

```text
/play-yt <Spotify URL>
```

Record whether:

- Spotify is contacted.
- YouTube result is found.
- Lavalink returns an encoded track.
- trackStart fires.
- Discord receives audio.

Interpretation:

```text
/play-yt also silent
=> investigate voice/DAVE/Lavalink stack first
```

---

## Test D — Normal YouTube `/play`

Compare with `/play-yt`.

Look for differences in:

- source identifier,
- search engine,
- load type,
- resolver,
- LavaSrc path.

---

## Test E — Spotify track

Only after the voice pipeline works.

Test a single Spotify track.

Capture:

- Spotify HTTP status.
- LavaSrc logs.
- metadata.
- ISRC.
- fallback query.
- resolved playable source.
- result quality.

---

## Test F — Spotify playlist

Test separately from a single track.

Do not assume playlist failures have the same cause as track failures.

Check:

- pagination.
- API limits.
- playlist metadata.
- per-track resolution.
- queue insertion.
- partial failure behavior.

---

# 12. Required Logging / Instrumentation

If PinPlay currently lacks enough logging, add temporary structured diagnostics.

Never log secrets.

Do NOT log:

- Discord token.
- Spotify client secret.
- Lavalink password.
- API keys.
- OAuth tokens.
- cookies.

Useful events:

```text
nodeConnect
nodeDisconnect
nodeError
nodeReconnect
playerCreate
playerDestroy
playerMove
trackStart
trackEnd
trackException
trackStuck
WebSocket close
voice server update
voice state update
```

For each playback attempt log:

```json
{
  "guildId": "...",
  "voiceChannelId": "...",
  "queryType": "spotify|youtube|soundcloud|text|direct",
  "requestedSource": "...",
  "resolvedSource": "...",
  "loadType": "...",
  "trackIdentifier": "...",
  "encodedTrackPresent": true,
  "playerState": "...",
  "node": "...",
  "exception": null
}
```

Avoid storing personally identifying user information unless needed.

---

# 13. Spotify Resolver Strategy Recommended for PinPlay

Target architecture:

```text
                    Input
                      |
          +-----------+-----------+
          |                       |
          v                       v
     Spotify URL              Other input
          |                       |
          v                       |
  Spotify metadata                |
          |                       |
          +--> title              |
          +--> artist             |
          +--> ISRC               |
          |                       |
          v                       |
    Resolution Engine             |
          |                       |
          +-----------------------+
          |
          v
  Playable source candidates
          |
          +--> YouTube Music
          +--> YouTube
          +--> SoundCloud
          |
          v
   Candidate ranking
          |
          v
      Lavalink track
```

---

# 14. Candidate Matching

When resolving Spotify metadata against another source, do not match only by title.

Suggested scoring dimensions:

```text
ISRC exact match                strongest
normalized artist
normalized title
duration difference
explicit/remaster/live markers
official channel / topic status
album metadata
```

Example conceptual score:

```text
ISRC match                    +100
artist exact                  +30
title exact                   +30
duration difference <= 2s     +20
duration difference <= 5s     +10
official/topic source         +10
live mismatch                 -30
remix mismatch                -25
nightcore mismatch            -40
cover mismatch                -30
```

Exact weights are not mandatory.

The point is to avoid resolving:

```text
original song
```

to:

```text
cover
nightcore
slowed
sped up
live
karaoke
remix
```

when the original is available.

---

# 15. Source Fallback Strategy

Only implement this after basic playback is fixed.

Recommended source priority can be configurable.

Example:

```text
Spotify metadata
      |
      v
ISRC resolver
      |
      +--> ytsearch / ytmsearch
      |
      +--> SoundCloud search
      |
      +--> other configured source
```

Do not create a complex fallback chain inside the `/play` command itself.

Create a resolver/service abstraction.

Example conceptual interface:

```ts
interface TrackResolver {
  resolve(input: string, context: ResolveContext): Promise<ResolveResult>;
}
```

Potential modules:

```text
src/music/resolvers/
    InputResolver
    SpotifyResolver
    YouTubeResolver
    SoundCloudResolver
    CandidateMatcher
```

Only refactor if it improves maintainability without changing behavior.

---

# 16. Do Not Conflate Spotify API with Spotify Audio

The AI agent must explicitly answer:

```text
What exactly is Spotify API used for in PinPlay?
```

Possible answers:

- track metadata,
- playlist metadata,
- album metadata,
- artist metadata,
- ISRC lookup,
- search.

Then answer separately:

```text
Which service provides the actual audio?
```

This distinction must be documented in the final diagnosis.

---

# 17. Lavalink Configuration Audit

Inspect:

```text
lavalink/application.yml
```

or the actual config used at runtime.

Verify:

## Server

```text
port
bind address
password
WebSocket endpoint
REST endpoint
```

## Sources

```text
youtube
soundcloud
bandcamp
twitch
vimeo
http
local
```

## Plugins

```text
YouTube plugin
LavaSrc
```

Check plugin compatibility with the installed Lavalink version.

Check duplicate source managers.

Example concern:

```text
core YouTube source enabled
+
YouTube plugin enabled
```

when the plugin documentation expects the built-in source to be disabled.

Do not change this without verifying current plugin documentation.

---

# 18. YouTube Plugin Audit

Check:

```text
client list
OAuth
refresh tokens
poToken if relevant
visitor data if relevant
rate limiting
IP blocking
429 errors
403 errors
signature errors
```

Compare PinPlay with:

https://github.com/zienshang/music-bot

but verify versions against current upstream documentation before copying configuration.

Never copy OAuth tokens or cookies from public examples.

---

# 19. Network / VPS Checks

A correct application can still be silent if voice networking is broken.

Check:

```text
TCP connectivity Bot -> Lavalink
WebSocket connectivity Bot -> Lavalink
DNS
IPv4/IPv6 behavior
UDP egress
firewall
provider firewall/security group
Docker networking if used
NAT
proxy
```

Important distinction:

```text
Bot <-> Lavalink
```

working does NOT prove:

```text
Lavalink <-> Discord voice
```

is working.

Track lookup uses HTTP/WebSocket.

Audio transport requires the Discord voice pipeline.

---

# 20. Player State Checks

When a track allegedly starts, capture:

```text
current track
position
ping
connected
paused
volume
filters
voice channel ID
guild ID
node identifier
```

Observe position twice:

```text
t = 0
t = +5 sec
```

If position advances but no audio:

focus strongly on:

```text
voice transport
DAVE
Discord connection
mute/deaf state
UDP/network
```

If position does not advance:

focus on:

```text
track playback
Lavalink source
player state
track exception
```

---

# 21. Discord Permissions / Voice State

Verify:

```text
CONNECT
SPEAK
VIEW_CHANNEL
```

Check bot state:

```text
server mute
self mute
suppressed in Stage channel
Stage speaker permission
```

For normal voice channels ensure the bot is not unexpectedly server-muted.

---

# 22. Compare PinPlay with Aurox

This is one of the most important tasks.

Create a comparison table:

| Concern | PinPlay | Aurox | Difference | Risk |
|---|---|---|---|---|
| discord.js connector | | | | |
| gateway send function | | | | |
| Kazagumo init | | | | |
| Shoukaku init | | | | |
| node options | | | | |
| voice update | | | | |
| player creation | | | | |
| search | | | | |
| reconnect | | | | |
| track events | | | | |

Do not declare Aurox "correct" merely because it is open source.

Use it as a reference.

---

# 23. Compare PinPlay with Bongo Lavamusic

Focus on:

```text
modern Lavalink client lifecycle
voice integration
node events
player recovery
multi-platform resolver
queue transitions
error reporting
```

Create a second comparison table.

---

# 24. Compare PinPlay with BeatDock

Focus specifically on:

```text
Spotify metadata
        |
        v
YouTube resolution
```

Answer:

1. How does BeatDock parse Spotify?
2. How does it obtain track metadata?
3. How does it build the YouTube query?
4. How does it select a result?
5. What happens when no result exists?
6. What happens when the Lavalink node fails?

Extract ideas, not copied code.

---

# 25. Study MusicBot as Non-Lavalink Reference

Repository:

https://github.com/Just-Some-Bots/MusicBot

Understand:

```text
yt-dlp -> FFmpeg -> Discord voice
```

Purpose:

If direct voice playback works in a minimal non-Lavalink proof-of-concept but Lavalink remains silent, that is strong diagnostic evidence.

Do not automatically migrate PinPlay away from Lavalink.

---

# 26. Root Cause Classification

At the end of investigation assign every finding to:

```text
P0 BLOCKER
P1 HIGH
P2 MEDIUM
P3 LOW
```

Example:

## P0

- Lavalink < 4.2.0 in current Discord voice environment.
- Lavalink client lacks required DAVE support.
- Voice packet forwarding broken.
- UDP completely blocked.

## P1

- Spotify resolver has no fallback.
- YouTube plugin incompatible with Lavalink.
- LavaSrc version mismatch.

## P2

- weak result matching.
- insufficient logs.
- reconnect race conditions.

## P3

- code organization.
- duplicate utility code.
- UX messages.

---

# 27. Implementation Rules

The AI agent MUST follow these rules.

## Rule 1 — Preserve Existing Features

Do not remove or change behavior of:

```text
/play
/play-yt
/search
queue
playlist
autoplay
24/7
filters
panel
access control
DJ role
AI playlist
roast
history
lyrics
```

unless the user explicitly approves it.

---

## Rule 2 — No Rewrite

Do not replace the entire music subsystem because one component is broken.

Prefer:

```text
diagnose
-> isolate
-> patch
-> validate
```

---

## Rule 3 — Do Not Blindly Upgrade Everything

Dependency upgrades can introduce unrelated regressions.

For every upgraded dependency document:

```text
old version
new version
reason
breaking changes
files affected
validation
```

---

## Rule 4 — No Secret Leakage

Never print or commit:

```text
DISCORD_TOKEN
SPOTIFY_CLIENT_SECRET
LAVALINK_PASSWORD
NVIDIA_API_KEY
OAuth token
cookies
refresh token
```

---

## Rule 5 — Keep Environment Compatibility

Do not assume Docker is available.

PinPlay must remain operable using its intended deployment environment.

If Docker is suggested, keep it optional unless the project already requires it.

---

## Rule 6 — Test Before Refactoring

A passing minimal playback test is required before large resolver refactoring.

---

# 28. Suggested Repair Order

Use this order.

```text
1. Audit actual runtime versions
        |
        v
2. Confirm Lavalink >= 4.2.0
        |
        v
3. Confirm client/wrapper DAVE compatibility
        |
        v
4. Confirm voice state forwarding
        |
        v
5. Test direct/SoundCloud/YouTube playback
        |
        v
6. Fix voice transport if silent
        |
        v
7. Test /play-yt
        |
        v
8. Audit YouTube plugin
        |
        v
9. Audit LavaSrc
        |
        v
10. Audit Spotify metadata/resolver
        |
        v
11. Add source fallback
        |
        v
12. Improve monitoring/logging
```

---

# 29. Required Final Deliverables from the AI Agent

The agent should produce:

## A. `PINPLAY_PLAYBACK_DIAGNOSIS.md`

Containing:

```text
symptom
reproduction steps
environment
actual dependency versions
logs
root cause
evidence
why it caused silence
```

---

## B. `PINPLAY_FIX_PLAN.md`

Containing:

```text
files to change
change per file
dependency changes
configuration changes
risk
rollback
validation
```

---

## C. Code Patch

Smallest viable repair.

---

## D. Test Matrix

Example:

| Source | Query type | Resolve | TrackStart | Position moves | Audible | Result |
|---|---|---:|---:|---:|---:|---|
| Direct | URL | | | | | |
| SoundCloud | URL | | | | | |
| YouTube | URL | | | | | |
| YouTube | search | | | | | |
| `/play-yt` | text | | | | | |
| Spotify | track | | | | | |
| Spotify | playlist | | | | | |

---

## E. Before / After Evidence

Show:

```text
Before
- exact error/log
- silent behavior

After
- node connects
- voice connects
- track starts
- playback position advances
- user hears audio
```

Do not claim audible playback unless it was actually verified by a human/test environment capable of hearing the channel.

---

# 30. Agent Prompt

Copy the section below directly into the coding agent if needed.

---

## MASTER INSTRUCTION FOR AI CODING AGENT

You are investigating and repairing the Discord music playback system in:

https://github.com/Gimm17/PinPlay-Bot

Your highest priority is to find the real root cause of the current symptom:

```text
The bot can join a Discord voice channel and tracks can appear to play,
but no audio is heard. Spotify playback/resolution is also problematic.
```

Do NOT assume Spotify is the root cause.

Do NOT rewrite the application.

Do NOT remove existing features.

Before modifying anything:

1. Read `AGENTS.md`.
2. Read all project documentation.
3. Read `package.json` and lockfile.
4. Map the entire music subsystem.
5. Inspect the Lavalink configuration.
6. Determine the ACTUAL runtime versions of Lavalink, Kazagumo, Shoukaku, discord.js, LavaSrc, and the YouTube plugin.
7. Reproduce the failure and capture logs.

A critical upstream fact must be checked first:

```text
Lavalink 4.2.0 is the first Lavalink release with Discord DAVE/E2EE support.
A compatible client library is also required.
The newer voice state requires channelId.
```

Official references:

https://github.com/lavalink-devs/Lavalink/releases

https://github.com/lavalink-devs/Lavalink/blob/master/CHANGELOG.md

Therefore, first verify whether the ACTUAL Lavalink server and the JavaScript Lavalink client stack used by PinPlay support the current Discord DAVE voice protocol.

Trace:

```text
Discord gateway
-> VOICE_STATE_UPDATE
-> VOICE_SERVER_UPDATE
-> Shoukaku/client connector
-> Lavalink
-> Discord voice/DAVE
-> audio
```

Then run isolated playback tests:

```text
1. direct playable test URL
2. SoundCloud
3. YouTube
4. PinPlay /play-yt
5. Spotify track
6. Spotify playlist
```

Do not investigate Spotify deeply until normal YouTube/SoundCloud/direct playback is proven audible.

Use these repositories as references:

https://github.com/bongo-devs/lavamusic

https://github.com/adh319/Aurox

https://github.com/thiagobrucezzi/Discord-Music-Bot

https://github.com/zienshang/music-bot

https://github.com/albertgmz/BeatDock

https://github.com/Glaxier0/discord-music-bot

https://github.com/museofficial/muse

https://github.com/Just-Some-Bots/MusicBot

https://github.com/zz-xx/discord-music-bot

https://github.com/Tomato6966/discord-js-lavalink-Music-Bot-erela-js

PRIORITIZE:

```text
Aurox
```

for Kazagumo + Shoukaku + Lavalink comparison.

PRIORITIZE:

```text
Bongo Lavamusic
```

for a modern large Lavalink music-bot implementation.

PRIORITIZE:

```text
BeatDock
```

for Spotify metadata -> YouTube playable-source resolution.

PRIORITIZE:

```text
Just-Some-Bots/MusicBot
```

for understanding a non-Lavalink yt-dlp/FFmpeg audio pipeline.

For every reference project:

- Do not blindly copy code.
- Verify its dependencies and maintenance state.
- Verify whether the relevant code still applies to current Discord/Lavalink.
- Extract patterns and compare them with PinPlay.

Spotify must be treated as a metadata/resolution source unless the currently installed Lavalink/LavaSrc stack documents otherwise.

Preferred conceptual path:

```text
Spotify URL
-> metadata
-> title + artist + ISRC
-> playable source resolver
-> YouTube Music / YouTube / SoundCloud
-> Lavalink track
-> Discord voice
```

The existing `/play-yt` command is especially important as a diagnostic control path. If `/play-yt` resolves a track but is also silent, Spotify API is unlikely to be the primary cause.

Inspect player events:

```text
nodeConnect
nodeDisconnect
nodeError
trackStart
trackEnd
trackException
trackStuck
player state
voice state
```

When a track starts, sample player position multiple times.

If:

```text
position advances
+
no audio
```

prioritize:

```text
DAVE
voice connection
UDP
network/firewall
Discord mute/suppression
client/Lavalink compatibility
```

If:

```text
position does not advance
```

prioritize:

```text
track source
Lavalink playback
player state
track exception
```

Also inspect VPS/network conditions:

```text
TCP
WebSocket
UDP egress
firewall
NAT
IPv4/IPv6
```

Do not expose credentials in logs.

Before editing, create:

```text
PINPLAY_PLAYBACK_DIAGNOSIS.md
```

with the evidence and likely root cause.

Then create:

```text
PINPLAY_FIX_PLAN.md
```

with exact files and changes.

Only after diagnosis is sufficiently supported should you modify code/configuration.

When making changes:

- Make the smallest maintainable patch.
- Preserve all commands and features.
- Avoid unrelated refactoring.
- Avoid UI/UX changes.
- Add useful error handling and structured diagnostics.
- Keep Spotify and YouTube responsibilities separated.
- Keep resolver logic out of Discord interaction handlers where practical.
- Document any dependency upgrade.

Finally test:

```text
YouTube URL
YouTube search
/play-yt
SoundCloud
Spotify track
Spotify playlist
pause/resume
skip
seek
queue
loop
volume
filters
24/7 reconnect
```

Output a final report containing:

```text
ROOT CAUSE
EVIDENCE
FILES CHANGED
DEPENDENCIES CHANGED
CONFIG CHANGED
TESTS EXECUTED
TEST RESULTS
KNOWN LIMITATIONS
ROLLBACK STEPS
```

Never claim a test passed unless it was actually executed.

Never claim that Discord audio was audible unless that was actually verified.

---

# 31. Research Links

## PinPlay

https://github.com/Gimm17/PinPlay-Bot

## Lavalink Official

https://github.com/lavalink-devs/Lavalink

https://github.com/lavalink-devs/Lavalink/releases

https://github.com/lavalink-devs/Lavalink/blob/master/CHANGELOG.md

## Reference Bots

1. https://github.com/bongo-devs/lavamusic
2. https://github.com/adh319/Aurox
3. https://github.com/thiagobrucezzi/Discord-Music-Bot
4. https://github.com/zienshang/music-bot
5. https://github.com/albertgmz/BeatDock
6. https://github.com/Glaxier0/discord-music-bot
7. https://github.com/museofficial/muse
8. https://github.com/Just-Some-Bots/MusicBot
9. https://github.com/zz-xx/discord-music-bot
10. https://github.com/Tomato6966/discord-js-lavalink-Music-Bot-erela-js

---

# 32. Current Working Conclusion

Do not yet state that Spotify is broken beyond repair.

Do not yet state that Lavalink itself is definitely broken.

The strongest investigation order is:

```text
DAVE compatibility
        ->
voice state / Lavalink client compatibility
        ->
Lavalink runtime
        ->
network/UDP
        ->
YouTube/SoundCloud playback
        ->
LavaSrc
        ->
Spotify metadata/resolution
```

The reason is simple:

```text
If YouTube, SoundCloud, direct audio, and Spotify all resolve
but every source is silent,
then fixing the Spotify API will not restore sound.
```

First prove that the voice transport can actually deliver audio.

Then repair source resolution.

---

# 33. Success Criteria

The issue is considered fixed only when:

- Lavalink node is connected and stable.
- Discord voice connection is established.
- A non-Spotify source is audibly playable.
- `/play-yt` works.
- Normal YouTube search works.
- SoundCloud works if enabled.
- Spotify track metadata resolves.
- Spotify track resolves to a playable audio source.
- Spotify playlist inserts playable tracks.
- Track exceptions are surfaced clearly.
- Node disconnects are handled.
- Existing queue/control commands remain functional.
- Existing PinPlay UI/UX remains intact.
- No secrets are leaked.
- The final implementation is documented.

---

**End of investigation guide.**

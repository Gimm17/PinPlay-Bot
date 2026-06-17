# Autoplay Integration Test Checklist

**Branch:** `feat/autoplay`
**Date:** 2026-06-18
**Tester:** (lo)

This checklist verifies the autoplay feature works end-to-end in a real Discord server.

## Pre-requisites
- [ ] `.env` has DISCORD_TOKEN, CLIENT_ID, GUILD_ID, SPOTIFY_CLIENT_ID/SECRET, LAVALINK_*
- [ ] Lavalink running (`java -jar Lavalink.jar` in separate terminal)
- [ ] Bot invited to test guild with permissions

## Setup

### Step 1: Deploy slash command
```bash
npm run deploy:guild
```
Expected: prints success message, `/autoplay` appears in guild command list within ~5 min (Discord propagation).

### Step 2: Start bot
```bash
npm start
```
Expected: bot logs `Logged in as ...`, no autoplay-related errors on startup.

## Test Cases

### Test A: Happy path (Spotify)
1. Join voice channel
2. Run `/autoplay on` → expect ephemeral "✅ Autoplay enabled"
3. Run `/play <spotify track url>` (e.g., a popular song like https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh)
4. Wait for track to finish
5. **Observe terminal logs:**
   - `[autoplay] fetch from spotify for "..."`
   - `[autoplay] added to queue: "..." (source=spotify)`
6. **Observe channel:**
   - One-time message: `🎵 **Autoplay started** — adding related tracks based on "..."`
7. **Verify:** New track auto-plays after current finishes
8. **Verify:** Panel footer shows `🎵 Autoplay (spotify)`

### Test B: Fallback to YouTube
1. Edit `.env`: empty SPOTIFY_CLIENT_ID (or comment out)
2. Restart bot: Ctrl+C, then `npm start`
3. Join voice + `/autoplay on` + `/play <youtube url>` (e.g., https://www.youtube.com/watch?v=dQw4w9WgXcQ)
4. Wait for track to finish
5. **Observe logs:**
   - `[autoplay] fetch from spotify for "..."`
   - `[autoplay] spotify fetch failed: ..., trying youtube`
   - `[autoplay] fetch from youtube for "..."`
   - `[autoplay] added to queue: "..." (source=youtube)`
6. **Verify:** Track still auto-adds (no Spotify required)

### Test C: Both fail + cooldown
1. Edit `.env`: set LAVALINK_HOST to invalid (e.g., `192.0.2.1`) AND empty Spotify creds
2. Restart bot
3. `/autoplay on` + `/play <some query>` (will fail to even start because Lavalink is down)
4. Or: keep Lavalink working but use a track that returns no results
5. **Observe logs:** `[autoplay] both sources failed, retry in 30s`
6. Try `/play` again immediately → log shows `[autoplay] cooldown active, skipping fetch`
7. Wait 30s, `/play` again → see retry attempt

### Test D: /autoplay off
1. `/autoplay off` → expect ephemeral "❌ Autoplay disabled"
2. Let current track finish
3. **Verify:** NO new track auto-added (queue empty, bot leaves after 120s default timeout)
4. `/autoplay status` → expect "Autoplay is **OFF** for this server"

### Test E: Prefix command
1. Type `.autoplay on` → expect reply "✅ Autoplay enabled — adding related tracks when queue ends"
2. Type `.autoplay status` → expect "Autoplay is **ON** for this server"
3. Type `.autoplay off` → expect "❌ Autoplay disabled"
4. Type `.autoplay invalid` → expect error "Invalid action. Must be one of: on, off, status"

### Test F: Persistence
1. `/autoplay on`
2. Restart bot (Ctrl+C, npm start)
3. `/autoplay status` → should show "ON" (state persisted in `data/guildSettings.json`)

## Log Reference (Expected Outputs)

| Event | Log Line |
|-------|----------|
| Toggle on | `[autoplay] enabled for guild {id}` |
| Toggle off | `[autoplay] disabled for guild {id}` |
| Spotify fetch | `[autoplay] fetch from spotify for "{title}"` |
| Spotify fail | `[autoplay] spotify fetch failed: {err}, trying youtube` |
| YouTube fetch | `[autoplay] fetch from youtube for "{title}"` |
| YouTube fail | `[autoplay] youtube fetch failed: {err}` |
| Both fail | `[autoplay] both sources failed, retry in 30s (guild={id})` |
| Cooldown skip | `[autoplay] cooldown active, skipping fetch (guild={id}, remaining={sec}s)` |
| Success | `[autoplay] added to queue: "{title}" (source={source})` |
| Notify fail | `[autoplay] failed to send notify: {err}` |

## Failure Triage

| Issue | Likely Cause | Fix |
|-------|--------------|-----|
| Command not found in Discord | Not deployed or cache not refreshed | `npm run deploy:guild`, wait 5 min |
| No log on playerStart | Autoplay not enabled | `/autoplay on` |
| `no kazagumo instance` warning | Player not fully initialized | Should be rare; check kazagumo is started in index.js |
| `both sources failed` repeatedly | Lavalink down OR no results | Check Lavalink logs, try `/play` manually first |
| State not persisting | `data/guildSettings.json` not writable | Check file permissions |
| Prefix command doesn't work | MessageContent intent disabled | Enable in Discord Developer Portal |

## Report

If all tests pass, proceed to Task 12 (CHANGELOG). If any test fails, note the failure mode and fix before completing.

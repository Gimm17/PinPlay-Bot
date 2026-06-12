# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PinPlay is a high-performance Discord music bot built with Discord.js v14, Kazagumo (Lavalink v4 client), and supporting 25+ slash commands. It features an interactive music panel, multi-platform support (YouTube, Spotify, Apple Music, SoundCloud), smart search, lyrics, queue management, 24/7 mode, audio filters, and access control system.

## Development Commands

### Setup & Installation
```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Fill .env with required values (DISCORD_TOKEN, CLIENT_ID, LAVALINK_*)
```

### Running the Bot
```bash
# Start Lavalink server (separate terminal)
java -jar Lavalink.jar

# Run the bot
npm start

# Deploy slash commands (guild-specific for development)
npm run deploy:guild

# Deploy slash commands (global for production)
npm run deploy:global
```

## Architecture Overview

### Core Structure
```
src/
├── index.js                 # Main entry point - client initialization
├── config.js               # Environment variable loader
├── commands/               # Individual slash command files (25+)
├── handlers/               # Interaction and event handlers
│   ├── commandLoader.js    # Loads all commands into a Map
│   └── interactionHandler.js # Processes slash commands, buttons, modals
├── music/                  # Music core logic
│   ├── kazagumo.js         # Lavalink client initialization
│   ├── events.js           # Music player events (playerStart, playerEnd, etc.)
│   ├── panel.js            # Music panel embed and component builders
│   └── panelInteractions.js # Handles panel button clicks
└── utils/                  # Utility modules
    ├── storage.js          # Guild settings persistence (JSON + in-memory cache)
    ├── player.js           # Player/queue helper functions
    ├── logger.js           # Custom logger with levels
    ├── permissions.js      # Access control system
    └── format.js           # Time formatting, progress bars, thumbnails
```

### Key Components

#### 1. Command System
- Each command is a separate file in `src/commands/` with `data` (SlashCommandBuilder) and `execute` method
- Commands are loaded dynamically via `commandLoader.js`
- Interaction handler processes slash commands, buttons, and modals

#### 2. Music Player (Kazagumo)
- Uses Kazagumo (Lavalink v4 client) for audio streaming
- Player state is managed through Kazagumo's player system
- Supports multiple audio sources via Lavalink plugins (YouTube, Spotify, SoundCloud, etc.)

#### 3. Interactive Music Panel
- 10-button control interface with visual feedback
- Auto-updates when music state changes
- Supports play/pause, skip, volume, loop, shuffle, queue, and more

#### 4. Access Control System
- Two modes: `all` (default) or `restricted`
- Restricted mode allows only admins, DJ role, or explicitly allowed users/roles
- `/access` commands manage permissions and request channel restrictions

#### 5. Data Persistence
- Guild settings stored in `data/guildSettings.json`
- In-memory cache with debounced writes to prevent race conditions
- Persists panel settings, 24/7 mode, DJ roles, volume, etc.

### Important Notes

#### Lavalink Dependency
- Bot requires Lavalink v4 server running separately
- Lavalink must be started before the bot (see GUIDE.md for setup)
- Configuration in `.env` must match Lavalink `application.yml`

#### Command Response Time
- Discord enforces 3-second response limit for interactions
- Commands use `deferReply()` immediately to avoid timeouts
- Long operations (search, lyrics) use `editReply()` for progress updates

#### Error Handling
- Rate limiter prevents abuse (non-admin users)
- Missing permissions or voice channel errors are handled gracefully
- Lavalink connection errors are logged but don't crash the bot

#### Panel System
- Panel creates an embed with 3 rows of buttons
- Auto-updates when music state changes
- Can be created/removed via `/panel` command
- Persists across bot restarts when 24/7 mode is enabled

## Development Guidelines

### Adding New Commands
1. Create a new file in `src/commands/` with the command logic
2. Export `data` (SlashCommandBuilder) and `execute` function
3. The command will be automatically loaded by `commandLoader.js`

### Modifying Music Panel
- Update `buildPanelEmbed()` and `buildPanelComponents()` in `src/music/panel.js`
- Button interactions are handled in `src/music/panelInteractions.js`
- Use `updatePanel()` to refresh existing panels

### Access Control Changes
- Modify `src/utils/permissions.js` for permission checks
- Update `src/utils/storage.js` for new settings persistence
- Test with both `all` and `restricted` modes

### Testing
- Use `npm run deploy:guild` for instant command updates during development
- Test 24/7 mode by enabling it and restarting the bot
- Verify Lavalink connection before testing music features

## Environment Variables

Required:
- `DISCORD_TOKEN`: Bot token from Discord Developer Portal
- `CLIENT_ID`: Application ID from Discord Developer Portal  
- `LAVALINK_HOST`: Lavalink server host
- `LAVALINK_PORT`: Lavalink server port
- `LAVALINK_PASSWORD`: Lavalink server password

Optional:
- `GUILD_ID`: For guild-specific command deployment
- `SPOTIFY_CLIENT_ID/SECRET`: For Spotify integration
- `DEFAULT_VOLUME`: Default volume (60)
- `LEAVE_TIMEOUT_SEC`: Voice channel leave timeout (120)
- `LOG_LEVEL`: Logging verbosity (info/warn/error)

## Prefix Commands

In addition to slash commands (`/play`, `/skip`, etc.), the bot supports text-based prefix commands. The default prefix is `.`, so you can use commands like:

| Alias | Command | Example |
|-------|---------|---------|
| `.p` | play | `.p never gonna give you up` |
| `.s` | skip | `.s` |
| `.st` | stop | `.st` |
| `.q` | queue | `.q 2` |
| `.pause` | pause | `.pause` |
| `.re` | resume | `.re` |
| `.sh` | shuffle | `.sh` |
| `.cl` | clear | `.cl` |
| `.v` | volume | `.v 60` |
| `.lp` | loop | `.lp track` |
| `.np` | nowplaying | `.np` |
| `.sk` | seek | `.sk 90` |
| `.f` | filter | `.f bassboost` |
| `.l` | leave | `.l` |
| `.sc` | search | `.sc blinding lights` |
| `.ly` | lyrics | `.ly` |
| `.hist` | history | `.hist` |
| `.rm` | remove | `.rm 3` |
| `.mv` | move | `.mv 5 1` |
| `.stt` | skipto | `.stt 4` |
| `.panel` | panel | `.panel create` |
| `.h` | help | `.h all` |
| `.247` | 247 | `.247 on` |
| `.dj` | djrole | `.dj set @DJ` |
| `.access` | access | `.access mode restricted` |

**Note:** To use prefix commands, you must enable `MessageContent` intent in Discord Developer Portal:
1. Go to https://discord.com/developers/applications
2. Select your application → Bot → Privileged Gateway Intents
3. Enable **Message Content Intent**
4. Restart your bot

The prefix is configurable via `.env`:
```
PREFIX=.
```

All commands support the same permissions and access control as their slash command equivalents.
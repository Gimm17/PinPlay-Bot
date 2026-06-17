/**
 * chat.js - AI Chat command (ChatGPT/Claude/Gemini-style) — Phase C upgrade
 *
 * /chat prompt:<text> [personality:<name>]
 * .chat <text>
 *
 * Access: owner + whitelisted users only.
 * - Default 5 requests/hour per user (shared across /chat, /aiplaylist, /roast)
 * - Owner bypasses the limit. Per-user limit override + bonus supported.
 * - Personality auto-detected by AI classifier (13 personalities).
 *   Owner can override via `personality:` option; non-owner users always auto.
 *   Owner can also change personality mid-conversation via the dropdown menu
 *   attached to every bot response.
 * - Reply to bot's chat message to continue the conversation (10 min idle TTL).
 * - Streaming UX: bot sends "💭 mikir..." placeholder + typing indicator,
 *   then edits with final response. For long responses, also show a
 *   mid-progress chunk.
 * - Memory: bot's system prompt is injected with per-user memory + global
 *   notes (if memory enabled). Background fact-extraction runs after each
 *   chat completion.
 *
 * Sessions are stored on `client._chatSessions` (Map<userId, session>).
 * Bot message -> session mapping is on `client._chatBotsLastReply` (Map).
 *
 * Personality picker customId: "chat:setpersonality:<userId>"
 *   Owner-only. Updates session.personality and acknowledges via ephemeral.
 */

const {
  SlashCommandBuilder,
  EmbedBuilder,
} = require("discord.js");
const { config } = require("../config");
const { Colors } = require("../utils/colors");
const { callAIWithFallback } = require("../utils/aiProviderFallback");
const { isAIAvailable } = require("../utils/ai");
const aiLimits = require("../utils/aiLimits");
const aiSettings = require("../utils/aiSettings");
const aiMemory = require("../utils/aiMemory");
const {
  detectPersonality,
  getPersonality,
  getPersonalitySystemPrompt,
  PERSONALITIES,
  VALID,
} = require("../utils/personalities");
const { successEmbed, errorEmbed, warningEmbed, infoEmbed } = require("../utils/embeds");
const { makeLogger } = require("../utils/logger");

const log = makeLogger(config.logLevel);

const SESSION_TTL_MS = 10 * 60 * 1000;
const MAX_HISTORY = 20; // keep last N user/assistant PAIRS (i.e. 40 messages)

// Streaming chunks: if response > CHUNK_THRESHOLD chars, edit once at half
const CHUNK_THRESHOLD = 1500;

// === Access control ===

function _isAllowed(userId) {
  if (!userId) return false;
  if (userId === config.discord.ownerId) return true;
  const s = aiSettings.getAISettings();
  const list = Array.isArray(s.whitelist) ? s.whitelist : [];
  return list.includes(userId);
}

// === Session management ===

function _getSession(client, userId) {
  if (!client._chatSessions) client._chatSessions = new Map();
  const now = Date.now();
  const existing = client._chatSessions.get(userId);
  if (existing && now - existing.lastActive < SESSION_TTL_MS) return existing;
  // Expired or new — start fresh
  const fresh = { messages: [], lastActive: now, personality: null };
  client._chatSessions.set(userId, fresh);
  return fresh;
}

function _rememberBotReply(client, userId, botMessage, session) {
  if (!client._chatBotsLastReply) client._chatBotsLastReply = new Map();
  client._chatBotsLastReply.set(botMessage.id, { userId, session });
  // Schedule cleanup past TTL
  setTimeout(() => {
    client._chatBotsLastReply?.delete(botMessage.id);
  }, SESSION_TTL_MS + 60_000).unref();
}

function _buildChatEmbed(personality, content) {
  const p = getPersonality(personality);
  const embed = new EmbedBuilder()
    .setColor(Colors.CHAT)
    .setTitle(`${p.emoji} AI Chat — ${p.displayName}`)
    .setDescription(content.slice(0, 4000))
    .setFooter({ text: "Reply pesan ini untuk lanjut chat (10 menit)." });
  return embed;
}

function _pushHistory(session, userText, assistantText) {
  session.messages.push({ role: "user", content: userText });
  session.messages.push({ role: "assistant", content: assistantText });
  if (session.messages.length > MAX_HISTORY * 2) {
    session.messages = session.messages.slice(-MAX_HISTORY * 2);
  }
  session.lastActive = Date.now();
}

// === Build system prompt with memory injection ===

function _buildSystemPrompt(personality, userId) {
  const base = getPersonalitySystemPrompt(personality);
  const userMem = aiMemory.formatUserForPrompt(userId);
  const globalMem = aiMemory.formatGlobalForPrompt();
  if (!userMem && !globalMem) return base;
  const memoryBlock =
    `\n\n--- MEMORI TENTANG USER (pake ini buat personalisasi, jangan sebut eksplisit) ---\n` +
    (userMem ? userMem : "") +
    (globalMem ? `\n--- GLOBAL NOTES ---\n` + globalMem : "");
  return base + memoryBlock;
}

// === Core chat logic (shared by slash + reply) ===

async function _runChat({
  userId,
  prompt,
  forcedPersonality, // string | null
  isOwner,
  session,
  send, // async (payload) => sentMessage
  sendTyping, // async () => void (typing indicator loop helper)
  source = "slash", // for logging
}) {
  // Determine personality
  let personality;
  if (forcedPersonality) {
    personality = forcedPersonality;
  } else if (session.personality && session.messages.length > 0) {
    // Continuation — reuse session's personality
    personality = session.personality;
  } else {
    // Show "thinking" while classifying
    sendTyping?.();
    personality = await detectPersonality(prompt);
  }
  session.personality = personality;

  // Build messages
  const messages = [
    { role: "system", content: _buildSystemPrompt(personality, userId) },
    ...session.messages,
    { role: "user", content: prompt },
  ];

  // Send streaming "thinking" indicator
  sendTyping?.();

  // Call AI (with provider fallback)
  let reply;
  try {
    reply = await callAIWithFallback({ messages, temperature: 0.7, maxTokens: 1024, _source: "chat" });
  } catch (err) {
    log.error(`Chat error [${source}] [user=${userId}]:`, err?.message || err);
    const embed = errorEmbed(`❌ ${err.message}`);
    await send({ embeds: [embed] }).catch(() => null);
    return;
  }

  // Save to history
  _pushHistory(session, prompt, reply);

  // Build final embed (clean — no dropdown, no status footer)
  const embed = _buildChatEmbed(personality, reply);

  // Send embed
  const sent = await send({ embeds: [embed] }).catch(() => null);
  if (sent) {
    _rememberBotReply(session._client || null, userId, sent, session);
  }

  // Background: extract facts (non-blocking, errors logged inside)
  if (aiMemory.isMemoryEnabled()) {
    aiMemory.extractFactsFromMessage(userId, prompt, reply).catch(() => null);
    aiMemory.touchUserSeen(userId);
  }
}

// === Typing indicator loop helper ===

function _startTypingLoop(channel) {
  let stopped = false;
  const tick = async () => {
    if (stopped || !channel?.sendTyping) return;
    try {
      await channel.sendTyping();
    } catch { /* ignore */ }
  };
  // Fire first tick immediately, then every 5s (Discord typing lasts 10s)
  tick();
  const interval = setInterval(tick, 5000);
  return () => {
    stopped = true;
    clearInterval(interval);
  };
}

// === Slash command ===

module.exports = {
  data: new SlashCommandBuilder()
    .setName("chat")
    .setDescription("Ngobrol sama AI (auto-detect personality). Reply pesan bot untuk lanjut.")
    .addStringOption((o) =>
      o
        .setName("prompt")
        .setDescription("Pesan kamu ke AI")
        .setRequired(true)
    )
    .addStringOption((o) =>
      o
        .setName("personality")
        .setDescription("[Owner] Pilih personality manual (default: auto-detect)")
        .setRequired(false)
        .addChoices(...VALID.map((v) => ({ name: `${PERSONALITIES[v].emoji} ${PERSONALITIES[v].displayName}`, value: v })))
    ),

  async execute(interaction, clientArg) {
    const client = clientArg || interaction.client;
    const userId = interaction.user.id;
    const isOwner = userId === config.discord.ownerId;

    // === Access control ===
    if (!_isAllowed(userId)) {
      return interaction.reply({
        embeds: [errorEmbed("⛔ Fitur ini restricted. Hubungi owner bot kalau mau akses.")],
        flags: 64,
      });
    }

    // === AI available ===
    if (!isAIAvailable()) {
      return interaction.reply({
        embeds: [errorEmbed("❌ Belum ada provider AI yang aktif. Set API key di .env dulu.")],
        flags: 64,
      });
    }

    // === Parse prompt + --personality ===
    // Slash command: uses options.prompt + options.personality
    // Prefix command: prompt contains "bla bla bla --puisi" (must extract suffix)
    let prompt = "";
    let prefixForcedPersonality = null;
    const isPrefix = typeof interaction.isChatInputCommand !== "function";

    if (isPrefix) {
      const raw = (interaction.options.getString("prompt") || "").trim();
      // Match: " <prompt text> --<personality>" at end of string
      // Personality names use dashes (e.g. coding-helper, roast-galau) — match whole word after --
      const match = raw.match(/^(.*?)\s+--([a-z0-9-]+)\s*$/i);
      if (match) {
        prompt = match[1].trim();
        const candidate = match[2].toLowerCase();
        if (VALID.includes(candidate)) {
          if (isOwner) {
            prefixForcedPersonality = candidate;
          }
          // Non-owner: silently ignore (same as slash behavior)
        } else {
          // Invalid personality name → treat as part of prompt (don't error, just keep raw)
          prompt = raw;
        }
      } else {
        prompt = raw;
      }
    } else {
      prompt = (interaction.options.getString("prompt") || "").trim();
    }

    if (!prompt) {
      return interaction.reply({ embeds: [errorEmbed("❌ Prompt kosong.")], flags: 64 });
    }

    // Owner can force personality; non-owners can pass it but it's ignored
    let forcedPersonality = null;
    if (isOwner) {
      // Slash command option
      const p = interaction.options.getString("personality");
      if (p && VALID.includes(p)) forcedPersonality = p;
      // Prefix --personality suffix (overrides slash if both somehow)
      if (prefixForcedPersonality) forcedPersonality = prefixForcedPersonality;
    }

    // === Rate limit ===
    const rl = aiLimits.checkAndIncrement(userId);
    if (!rl.allowed) {
      const mins = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 60000));
      return interaction.reply({
        embeds: [warningEmbed(`⏱️ **Limit AI tercapai.**\nKamu sudah pakai maksimal request dalam 1 jam terakhir.\nCoba lagi dalam **${mins} menit**.`)],
        flags: 64,
      });
    }

    // Defer reply and show "thinking" placeholder
    try {
      await interaction.deferReply();
    } catch {
      return;
    }

    // Show thinking placeholder
    const placeholderEmbed = new EmbedBuilder()
      .setColor(Colors.CHAT)
      .setDescription("💭 Lagi mikir...");
    await interaction.editReply({ embeds: [placeholderEmbed] }).catch(() => null);

    const session = _getSession(client, userId);
    session._client = client;

    const stopTyping = _startTypingLoop(interaction.channel);

    try {
      await _runChat({
        userId,
        prompt,
        forcedPersonality,
        isOwner,
        session,
        source: "slash",
        send: async (payload) => interaction.editReply(payload),
        sendTyping: () => stopTyping, // no-op (already started)
      });
    } finally {
      stopTyping();
    }
  },
};

// === Reply-to-continue handler (called from messageHandler) ===

async function handleChatReply(message, client, session) {
  const userId = message.author.id;

  if (!isAIAvailable()) {
    return message
      .reply({ embeds: [errorEmbed("❌ Belum ada provider AI yang aktif.")] })
      .catch(() => null);
  }

  // Whitelist re-check: owner who removed user from whitelist should
  // block mid-conversation replies. 10-min grace period is implicit
  // (session TTL); once removed, no new replies allowed.
  if (!_isAllowed(userId)) {
    return message
      .reply({ embeds: [errorEmbed("⛔ Akses kamu sudah dicabut. Hubungi owner bot kalau mau akses lagi.")] })
      .catch(() => null);
  }

  const prompt = (message.content || "").trim();
  if (!prompt) return;

  // Rate limit (reply also counts as a request)
  const rl = aiLimits.checkAndIncrement(userId);
  if (!rl.allowed) {
    const mins = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 60000));
    return message
      .reply({
        embeds: [warningEmbed(`⏱️ Limit AI tercapai. Coba lagi dalam **${mins} menit**.`)],
      })
      .catch(() => null);
  }

  // Send "thinking" placeholder
  const placeholder = await message
    .reply({ embeds: [new EmbedBuilder().setColor(Colors.CHAT).setDescription("💭 Lagi mikir...")] })
    .catch(() => null);

  const stopTyping = _startTypingLoop(message.channel);

  try {
    session._client = client;
    await _runChat({
      userId,
      prompt,
      forcedPersonality: null, // reply always uses session personality
      isOwner: userId === config.discord.ownerId,
      session,
      source: "reply",
      // Edit the placeholder message (so conversation thread stays clean)
      send: async (payload) => {
        if (!placeholder) return message.channel.send(payload).catch(() => null);
        return placeholder.edit(payload).catch(() => null);
      },
      sendTyping: () => stopTyping,
    });
  } finally {
    stopTyping();
  }
}

module.exports.handleChatReply = handleChatReply;

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
 * Sessions are stored in a module-level Map (userId -> session), swept on a
 * 5-minute timer so an abandoned session cannot linger (M8).
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
  getPersonalityChoice,
  PERSONALITIES,
  VALID,
} = require("../utils/personalities");
const { successEmbed, errorEmbed, warningEmbed, infoEmbed } = require("../utils/embeds");
const { makeLogger } = require("../utils/logger");

const log = makeLogger(config.logLevel);

const SESSION_TTL_MS = 10 * 60 * 1000;

// M8 (audit): session map lives at module scope so it can be swept on a timer.
// Previously the TTL was only enforced lazily inside _getSession — i.e. only
// when that same user chatted again — so a user who chatted once and left kept
// their history (up to 40 messages) for the whole process lifetime.
const _chatSessions = new Map(); // userId -> session

setInterval(() => {
  const now = Date.now();
  for (const [uid, s] of _chatSessions) {
    if (now - s.lastActive >= SESSION_TTL_MS) _chatSessions.delete(uid);
  }
}, 5 * 60 * 1000).unref(); // unref: must not hold the process open
const MAX_HISTORY = 20; // keep last N user/assistant PAIRS (i.e. 40 messages)
const MAX_HISTORY_CHARS = 12_000; // ~3k tokens of history, regardless of message count (H3)

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
  const now = Date.now();
  const existing = _chatSessions.get(userId);
  if (existing && now - existing.lastActive < SESSION_TTL_MS) return existing;
  // Expired or new — start fresh. (client kept in the signature so callers and
  // the session-sweeper contract stay unchanged.)
  const fresh = { messages: [], lastActive: now, personality: null };
  _chatSessions.set(userId, fresh);
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
  // getPersonalityLabel handles `general`, which intentionally has no character
  // name — without it the title would read "🤖 AI Chat — null".
  const title = p.displayName
    ? `${p.emoji} AI Chat — ${p.displayName}`
    : `${p.emoji} AI Chat`;
  const embed = new EmbedBuilder()
    .setColor(Colors.CHAT)
    .setTitle(title)
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

  // H3 (audit): MAX_HISTORY caps message COUNT, not tokens. Every assistant turn
  // is generated with maxTokens: 1024, so a full 40-message window is roughly
  // 20 x 1024 tokens of history resent on EVERY call - and every turn is only a
  // 10-minute reply away, so the window stays full indefinitely. Cost grew ~20x
  // from the first turn to the twentieth while the user saw "one message = one
  // request". Character count is a good enough token proxy (no tokenizer needed).
  // Drops oldest PAIRS so a user turn is never orphaned from its reply.
  let chars = session.messages.reduce((n, m) => n + (m.content?.length || 0), 0);
  while (chars > MAX_HISTORY_CHARS && session.messages.length > 2) {
    const [a, b] = session.messages.splice(0, 2);
    chars -= (a.content?.length || 0) + (b.content?.length || 0);
  }

  session.lastActive = Date.now();
}

// === Build system prompt with memory injection ===

const CHAT_CORE_RULES =
  `\n\n--- ATURAN RESPON DISCORD PINPLAY (WAJIB DIPATUHI) ---\n` +
  `1. LANGSUNG SATU JAWABAN TERBAIK (DILARANG BIKIN OPSI BERGANDA):\n` +
  `   - Kalau user minta buatin kata-kata, pujian, gombalan, pesan, ucapan, caption, puisi, atau konten apa pun, LANGSUNG PILIH SATU HASIL TERBAIK dan berikan langsung teks jadinya.\n` +
  `   - JANGAN PERNAH membuat daftar pilihan/versi (DILARANG seperti "Versi Puitis:", "Versi Lucu:", "Versi 1, Versi 2", "Tinggal pilih sesuai selera:").\n` +
  `   - JANGAN suruh user memilih. User bukan mau disuruh milih, user mau langsung lihat satu jawaban jadi yang siap pakai.\n` +
  `   - HANYA buatkan beberapa versi/opsi jika user SECARA EKSPLISIT meminta (misal: "kasih 3 opsi", "buatkan beberapa pilihan"). Kalau tidak diminta, WAJIB HANYA 1 HASIL LANGSUNG.\n` +
  `   - Hindari basa-basi pengantar klise ("Tentu, ini dia...", "Siap, ini kata-katanya...") dan penutup basa-basi. Langsung berikan teks jadinya.\n\n` +
  `2. PENANGANAN MENTION / NGETAG USER DISCORD:\n` +
  `   - Kalau user minta buatin kata-kata/pesan untuk seseorang dan menyebut username atau mention Discord (seperti @username atau <@id>):\n` +
  `     * HASIL GENERATE WAJIB MENYEBUT NAMA DAN MENGETAG target tersebut.\n` +
  `     * PERTAHANKAN FORMAT TAG ASLINYA: Jika ada tag <@id>, gunakan persis <@id> agar di Discord benar-benar ngetag orangnya. Jangan diubah jadi teks biasa atau tanda petik.\n` +
  `     * DILARANG TEMPLATE STATIS/KAKU: Jangan kaku selalu menaruh tag di awal kalimat ("Halo @user, ...") atau selalu di akhir ("...ya @user").\n` +
  `     * LETAKKAN TAG SECARA DINAMIS DAN LUWES: Selipkan tag di dalam alur kalimat/paragraf secara alami sesuai konteks dan ritme kalimat (misal di tengah kalimat pujian, sebagai subjek yang diagungkan, atau seruan puitis).\n`;

function _userExplicitlyAskedMulti(text) {
  if (!text || typeof text !== "string") return false;
  return (
    /\b(?:\d+|beberapa|banyak)\s*(?:versi|opsi|pilihan|contoh|alternatif)\b/i.test(text) ||
    /\b(?:kasih|buatkan|berikan|minta)\s+(?:\d+|beberapa)\b/i.test(text)
  );
}

function _cleanSingleResponse(text, prompt) {
  if (!text || typeof text !== "string") return text;
  if (_userExplicitlyAskedMulti(prompt)) return text.trim();

  // Pattern matching headings like: "Versi Puitis-Klasik:", "1. Versi Lucu:", "**Versi 1:**"
  const versionSplitRegex = /(?:^|\n+)(?:\*{0,2}(?:Versi|\d+\.\s*Versi)\s+[^:\n]+:\*{0,2})\s*\n*/i;
  if (versionSplitRegex.test(text)) {
    const parts = text.split(versionSplitRegex).map((p) => p.trim()).filter(Boolean);
    if (parts.length > 1 && /beberapa\s+versi|pilih\s+sesuai|berikut\s+(?:adalah\s+)?pilihan/i.test(parts[0])) {
      return parts[1];
    }
    if (parts.length > 0) return parts[0];
  }

  let cleaned = text.replace(
    /^(?:Siap,?\s*)?(?:ini\s+)?(?:beberapa\s+versi|ada\s+beberapa\s+pilihan)[^.\n]*[.:]\s*(?:Tinggal\s+pilih\s+sesuai\s+selera:?)?\s*\n*/i,
    ""
  );
  return cleaned.trim();
}

function _ensureMentionInReply(reply, targetUsers) {
  if (!reply || !targetUsers || targetUsers.length === 0) return reply;
  let result = reply;
  for (const user of targetUsers) {
    if (!user.tag) continue;
    if (result.includes(user.tag)) continue;

    // 1. Replace quoted name like "melobi" or 'melobi' with tag
    const quoteRegex = new RegExp(`["']${user.name}["']`, "i");
    if (quoteRegex.test(result)) {
      result = result.replace(quoteRegex, `${user.tag}`);
      continue;
    }

    // 2. Replace plain whole word name with tag
    const nameRegex = new RegExp(`\\b${user.name}\\b`, "i");
    if (nameRegex.test(result)) {
      result = result.replace(nameRegex, `${user.tag}`);
      continue;
    }

    // 3. Weave into opening royal/formal/casual greeting if present
    const greetingMatch = result.match(
      /^(Wahai|Duhai|Ya|Salam|Hai|Halo|Kepada|Untuk|Teruntuk)\s+([^,\n.!?]+)([,.!?\n])/i
    );
    if (greetingMatch) {
      result = result.replace(
        greetingMatch[0],
        `${greetingMatch[1]} ${greetingMatch[2]} ${user.tag}${greetingMatch[3]}`
      );
      continue;
    }

    // 4. Natural fallback
    result = `${user.tag}, ${result}`;
  }
  return result;
}

function _detectTargetMentions(prompt, guild) {
  if (!prompt || typeof prompt !== "string") {
    return { targetHints: "", targetUsers: [], mentionedUserIds: [] };
  }

  const mentionedUserIds = new Set();
  const targetUsers = [];

  // 1. Check for Discord user mentions: <@123456789> or <@!123456789>
  const userMentionRegex = /<@!?(\d+)>/g;
  let match;
  while ((match = userMentionRegex.exec(prompt)) !== null) {
    const id = match[1];
    mentionedUserIds.add(id);
    let displayName = null;
    if (guild?.members?.cache) {
      const member = guild.members.cache.get(id);
      if (member) {
        displayName = member.displayName || member.user?.username;
      }
    }
    targetUsers.push({
      name: displayName || "User Discord",
      tag: `<@${id}>`,
      id,
    });
  }

  // 2. Check for @username (not already in <@...>)
  const plainMentionRegex = /(?:^|\s)@([a-zA-Z0-9_.]{2,32})\b/g;
  while ((match = plainMentionRegex.exec(prompt)) !== null) {
    const username = match[1];
    if (username.toLowerCase() === "everyone" || username.toLowerCase() === "here") {
      continue;
    }

    let foundMember = null;
    if (guild?.members?.cache) {
      foundMember = guild.members.cache.find(
        (m) =>
          m.user?.username?.toLowerCase() === username.toLowerCase() ||
          m.displayName?.toLowerCase() === username.toLowerCase()
      );
    }

    if (foundMember) {
      mentionedUserIds.add(foundMember.id);
      targetUsers.push({
        name: foundMember.displayName || foundMember.user?.username || username,
        tag: `<@${foundMember.id}>`,
        id: foundMember.id,
      });
    } else {
      targetUsers.push({
        name: username,
        tag: `@${username}`,
        id: null,
      });
    }
  }

  if (targetUsers.length === 0) {
    return { targetHints: "", targetUsers: [], mentionedUserIds: Array.from(mentionedUserIds) };
  }

  const targetLines = targetUsers
    .map(
      (t) =>
        `- Target: "${t.name}" -> Gunakan tag ${t.tag}. (PENTING: Ini adalah NAMA TARGET PENGGUNA DISCORD, BUKAN kata kerja).`
    )
    .join("\n");

  const targetHints =
    `\n\n--- KONTEKS TARGET MENTION DISCORD ---\n` +
    `Prompt user merujuk ke target pengguna Discord berikut:\n${targetLines}\n` +
    `ATURAN WAJIB:\n` +
    `1. Hasil generate HARUS menyebutkan nama dan MENGETAG target menggunakan format ${targetUsers.map((t) => t.tag).join(" / ")}.\n` +
    `2. DILARANG menggunakan template statis/kaku (jangan kaku selalu di paling depan atau belakang). Tempatkan tag secara luwes, variatif, dan mengalir alami di dalam kalimat/paragraf.\n`;

  return { targetHints, targetUsers, mentionedUserIds: Array.from(mentionedUserIds) };
}

function _buildSystemPrompt(personality, userId, targetHints = "") {
  const base = getPersonalitySystemPrompt(personality);
  const userMem = aiMemory.formatUserForPrompt(userId);
  const globalMem = aiMemory.formatGlobalForPrompt();
  let prompt = base + CHAT_CORE_RULES;
  if (targetHints) {
    prompt += targetHints;
  }
  if (userMem || globalMem) {
    prompt +=
      `\n\n--- MEMORI TENTANG USER (pake ini buat personalisasi, jangan sebut eksplisit) ---\n` +
      (userMem ? userMem : "") +
      (globalMem ? `\n--- GLOBAL NOTES ---\n` + globalMem : "");
  }
  return prompt;
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
  guild = null,
}) {
  // Detect target mentions in prompt
  const { targetHints, targetUsers, mentionedUserIds } = _detectTargetMentions(prompt, guild);

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
    { role: "system", content: _buildSystemPrompt(personality, userId, targetHints) },
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

  // Post-process: clean multi-version if not asked & ensure mention is weaved in
  const cleanedReply = _cleanSingleResponse(reply, prompt);
  const finalReply = _ensureMentionInReply(cleanedReply, targetUsers);

  // Save to history (clean version)
  _pushHistory(session, prompt, finalReply);

  // Build final embed (clean — no dropdown, no status footer)
  const embed = _buildChatEmbed(personality, finalReply);

  // Send embed with allowedMentions
  const sent = await send({
    embeds: [embed],
    allowedMentions: {
      parse: [],
      users: mentionedUserIds,
      repliedUser: true,
    },
  }).catch(() => null);
  if (sent) {
    _rememberBotReply(session._client || null, userId, sent, session);
  }

  // Background: extract facts (non-blocking, errors logged inside)
  if (aiMemory.isMemoryEnabled()) {
    aiMemory.extractFactsFromMessage(userId, prompt, finalReply).catch(() => null);
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
        .addChoices(...VALID.map((v) => ({ name: getPersonalityChoice(v), value: v })))
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
        guild: interaction.guild,
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
      guild: message.guild,
    });
  } finally {
    stopTyping();
  }
}

module.exports.handleChatReply = handleChatReply;

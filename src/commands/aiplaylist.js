const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const { randomUUID } = require("crypto");
const { config } = require("../config");
const { getGuildSettings, setGuildSettings } = require("../utils/storage");
const { getPlayer } = require("../utils/player");
const { Colors } = require("../utils/colors");
const { callAI, isAIAvailable } = require("../utils/ai");
const { callAIWithFallback } = require("../utils/aiProviderFallback");
const aiLimits = require("../utils/aiLimits");
const { errorEmbed, infoEmbed, warningEmbed } = require("../utils/embeds");
const { makeLogger } = require("../utils/logger");

const log = makeLogger(config.logLevel);

const CACHE_TTL_MS = 120_000;
const SEARCH_CONCURRENCY = 8;

const PLAYLIST_SYSTEM_PROMPT = `Kamu adalah AI music curator yang jago banget soal musik Indonesia maupun internasional. User bakal minta playlist berdasarkan mood, tema, genre, atau situasi tertentu.

TUGAS: Generate 10-15 lagu yang paling cocok sama request user.

FORMAT WAJIB — respons HARUS berupa JSON array MURNI, tanpa teks pembuka/penutup, tanpa markdown:
[
  {"title": "Judul Lagu", "artist": "Nama Artis"},
  {"title": "Judul Lagu", "artist": "Nama Artis"}
]

ATURAN:
- Campur lagu Indonesia dan internasional sesuai tema (kalau temanya "indo", fokus lagu Indonesia).
- Prioritaskan lagu yang populer & gampang ditemukan di Spotify/YouTube.
- Variasikan artis — jangan semua lagu dari satu artis.
- Sesuaikan sama konteks request (galau, nongkrong, workout, throwback, dll).
- Jangan duplikat lagu.
- HANYA balas JSON array. Tidak ada kalimat lain.`;

/**
 * Ekstrak JSON array dari respons AI.
 * AI kadang bungkus pakai ```json ... ``` atau kasih teks tambahan.
 */
function _extractJSON(text) {
  if (!text) return null;

  // 1. Coba parse langsung
  try {
    const direct = JSON.parse(text);
    if (Array.isArray(direct)) return direct;
  } catch { /* lanjut */ }

  // 2. Buang fenced code block ```json ... ```
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      const parsed = JSON.parse(fenced[1].trim());
      if (Array.isArray(parsed)) return parsed;
    } catch { /* lanjut */ }
  }

  // 3. Regex ambil array pertama [ ... ]
  const arrMatch = text.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try {
      const parsed = JSON.parse(arrMatch[0]);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* lanjut */ }
  }

  return null;
}

/** Validasi & normalisasi hasil parse jadi array {title, artist} */
function _normalizeSongs(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const title = String(item.title || item.judul || "").trim();
      const artist = String(item.artist || item.artis || "").trim();
      if (!title) return null;
      return { title, artist };
    })
    .filter(Boolean)
    .slice(0, 15);
}

/** Search satu batch lagu secara paralel */
async function _searchBatch(client, songs, requester) {
  return Promise.all(
    songs.map(async (song) => {
      const q = `${song.title} ${song.artist}`.trim();
      try {
        const res = await client.kazagumo.search(q, { requester });
        const track = res?.tracks?.[0] || null;
        return { aiTitle: song.title, aiArtist: song.artist, track };
      } catch {
        return { aiTitle: song.title, aiArtist: song.artist, track: null };
      }
    })
  );
}

/** Resolve semua lagu AI → track playable (chunked concurrency) */
async function _resolveTracks(client, songs, requester) {
  const resolved = [];
  for (let i = 0; i < songs.length; i += SEARCH_CONCURRENCY) {
    const batch = songs.slice(i, i + SEARCH_CONCURRENCY);
    const results = await _searchBatch(client, batch, requester);
    resolved.push(...results);
  }
  return resolved;
}

function _buildPlaylistEmbed(query, resolved) {
  const lines = resolved.map((r, idx) => {
    const num = String(idx + 1).padStart(2, " ");
    const name = `${r.aiTitle}${r.aiArtist ? ` - ${r.aiArtist}` : ""}`;
    const mark = r.track ? "✅" : "❌";
    const suffix = r.track ? "" : " *(gak ketemu)*";
    return `\`${num}.\` ${mark} ${name}${suffix}`;
  });

  const foundCount = resolved.filter((r) => r.track).length;

  let desc = lines.join("\n");
  if (desc.length > 4000) desc = desc.slice(0, 4000) + "\n*...*";

  return new EmbedBuilder()
    .setColor(Colors.AI)
    .setTitle(`🎧 AI Playlist: ${query.slice(0, 230)}`)
    .setDescription(desc)
    .setFooter({
      text: `${foundCount}/${resolved.length} lagu siap diputar • Klik ✅ Tambah Semua untuk masuk queue`,
    });
}

function _buildButtons(cacheKey, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`aiplaylist:approve:${cacheKey}`)
      .setLabel("Tambah Semua")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`aiplaylist:cancel:${cacheKey}`)
      .setLabel("Batal")
      .setEmoji("❌")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled)
  );
}

/**
 * Inti: generate playlist → search → tampilkan embed + tombol.
 * Dipanggil dari execute() (langsung) atau dari message collector.
 * `interaction` sudah dalam state deferred/replied yang bisa di-editReply.
 */
async function _generateAndShow(interaction, client, query, user, vc) {
  await interaction.editReply("🤖 AI lagi nyusun playlist buat kamu...").catch(() => null);

  // 1. Panggil AI (with provider fallback)
  let aiText;
  try {
    aiText = await callAIWithFallback({
      messages: [
        { role: "system", content: PLAYLIST_SYSTEM_PROMPT },
        { role: "user", content: `Buatkan playlist: ${query}. Kasih 10-15 lagu.` },
      ],
      temperature: 0.7,
      maxTokens: 2048,
      _source: "aiplaylist",
    });
  } catch (err) {
    return interaction.editReply(`❌ ${err?.message || "AI gagal merespons."}`).catch(() => null);
  }

  // 2. Parse JSON
  const parsed = _extractJSON(aiText);
  const songs = _normalizeSongs(parsed);

  if (songs.length === 0) {
    return interaction
      .editReply(
        "❌ Gagal memproses respons AI. Coba tema yang lebih jelas, contoh: `lagu galau indo` atau `playlist workout energik`."
      )
      .catch(() => null);
  }

  // 3. Resolve ke track playable
  await interaction
    .editReply(`🔎 Nyari ${songs.length} lagu di Spotify/YouTube...`)
    .catch(() => null);

  const resolved = await _resolveTracks(client, songs, user);
  const foundCount = resolved.filter((r) => r.track).length;

  if (foundCount === 0) {
    return interaction
      .editReply(
        "❌ Gak ada satupun lagu yang ketemu di Spotify/YouTube. Coba tema lain ya."
      )
      .catch(() => null);
  }

  // 4. Cache hasil — use randomUUID to avoid any theoretical ID clash
  const cacheKey = randomUUID();
  if (!client._aiPlaylistCache) client._aiPlaylistCache = new Map();

  client._aiPlaylistCache.set(cacheKey, {
    userId: user.id,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    voiceId: vc.id,
    query,
    resolved,
    timestamp: Date.now(),
  });

  setTimeout(() => {
    client._aiPlaylistCache?.delete(cacheKey);
  }, CACHE_TTL_MS);

  // 5. Tampilkan embed + tombol
  const embed = _buildPlaylistEmbed(query, resolved);
  const row = _buildButtons(cacheKey);

  return interaction.editReply({ content: "", embeds: [embed], components: [row] }).catch(() => null);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("aiplaylist")
    .setDescription("Buat playlist otomatis pake AI berdasarkan mood/tema")
    .addStringOption((opt) =>
      opt
        .setName("query")
        .setDescription("Tema/mood playlist (contoh: 'lagu galau indo viral')")
        .setRequired(false)
    ),

  async execute(interaction, clientArg) {
    const client = clientArg || interaction.client;

    if (!isAIAvailable()) {
      return interaction.reply({
        embeds: [errorEmbed("❌ Fitur AI belum diaktifkan. Admin perlu set `NVIDIA_API_KEY` di `.env`.")],
        flags: 64,
      });
    }

    const user = interaction.user;
    const query = interaction.options.getString("query");

    // Deteksi prefix command: PrefixContext gak punya isChatInputCommand
    const isPrefix = typeof interaction.isChatInputCommand !== "function";

    // === Rate limit check (shared across all AI features) ===
    // `/aiplaylist` is in the FREE_COMMANDS set — unlimited, doesn't consume a slot.
    // Ephemeral reply (flags:64) since this is a self-service check —
    // doesn't need to be visible to other channel members.
    const rl = aiLimits.checkAndIncrement(interaction.user.id, "aiplaylist");
    if (!rl.allowed) {
      const mins = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 60000));
      return interaction.reply({
        embeds: [warningEmbed(`⏱️ **Limit AI tercapai.**\nKamu sudah pakai maksimal request dalam 1 jam terakhir.\nCoba lagi dalam **${mins} menit**.`)],
        flags: 64,
      });
    }

    // Voice check (ephemeral: only relevant to the requesting user)
    const vc = interaction.member?.voice?.channel;
    if (!vc) {
      return interaction.reply({
        embeds: [errorEmbed("❌ Kamu harus **join voice channel** dulu buat bikin playlist.")],
        flags: 64,
      });
    }

    // === Ada query → defer reply lalu generate ===
    if (query && query.trim()) {
      try {
        await interaction.deferReply();
      } catch {
        return;
      }
      return _generateAndShow(interaction, client, query.trim(), user, vc);
    }

    // === Tidak ada query ===
    // Slash command: minta user ulang dengan query (gak bisa collector dengan mudah).
    // Ephemeral since this is a hint to the caller.
    if (!isPrefix) {
      return interaction.reply({
        embeds: [infoEmbed("🎧 Mau playlist apa gezz? Jalankan lagi dengan tema, contoh:\n`/aiplaylist query: lagu galau indo viral`")],
        flags: 64,
      });
    }

    // Prefix command: tanya, lalu tunggu jawaban via message collector
    return interaction.reply(
      "🎧 **Pengen playlist apa gezz?**\nKetik tema/mood yang kamu mau (contoh: `lagu galau indo viral`). Kamu punya 60 detik..."
    ).then(() => {
      const channel = interaction.channel;
      if (!channel || typeof channel.createMessageCollector !== "function") return;
      const collector = channel.createMessageCollector({
        filter: (m) => m.author.id === user.id,
        max: 1,
        time: 60_000,
      });
      collector.on("collect", async (msg) => {
        const theme = (msg.content || "").trim();
        if (!theme) {
          return interaction.followUp("❌ Tema kosong. Coba lagi `.ap <tema>`.").catch(() => null);
        }
        const vcNow = msg.member?.voice?.channel || vc;
        const placeholder = await channel.send("🤖 AI lagi nyusun playlist buat kamu...").catch(() => null);
        const ctx = {
          guildId: interaction.guildId,
          channelId: interaction.channelId,
          id: msg.id,
          editReply: (payload) => {
            if (!placeholder) return Promise.resolve(null);
            const p = typeof payload === "string" ? { content: payload } : payload;
            return placeholder.edit(p).catch(() => null);
          },
        };
        return _generateAndShow(ctx, client, theme, user, vcNow);
      });
      collector.on("end", (collected) => {
        if (collected.size === 0) {
          interaction.followUp("⏰ Waktu habis. Coba lagi `.ap <tema>` ya.").catch(() => null);
        }
      });
    }).catch(() => null);
  },
};

/**
 * Handler tombol AI Playlist (approve / cancel).
 * Dipanggil dari interactionHandler.js untuk customId "aiplaylist:*".
 */
async function handleAIPlaylistButton(interaction, client) {
  const parts = (interaction.customId || "").split(":");
  const action = parts[1];
  const cacheKey = parts.slice(2).join(":");

  const cache = client._aiPlaylistCache?.get(cacheKey);

  if (!cache) {
    return interaction
      .reply({ embeds: [errorEmbed("❌ Playlist udah kadaluarsa. Coba `/aiplaylist` lagi ya.")], flags: 64 })
      .catch(() => null);
  }

  // Verifikasi user
  if (interaction.user.id !== cache.userId) {
    return interaction
      .reply({ embeds: [errorEmbed("❌ Ini bukan playlist kamu!")], flags: 64 })
      .catch(() => null);
  }

  // === Cancel ===
  if (action === "cancel") {
    client._aiPlaylistCache.delete(cacheKey);
    const embed = EmbedBuilder.from(interaction.message.embeds[0] || {})
      .setColor(Colors.IDLE)
      .setFooter({ text: "Dibatalkan." });
    return interaction
      .update({ embeds: [embed], components: [_buildButtons(cacheKey, true)] })
      .catch(() => null);
  }

  // === Approve ===
  if (action === "approve") {
    await interaction.deferUpdate().catch(() => null);

    const tracks = cache.resolved.filter((r) => r.track).map((r) => r.track);
    if (tracks.length === 0) {
      return interaction
        .followUp({ embeds: [errorEmbed("❌ Gak ada lagu yang bisa ditambah.")], flags: 64 })
        .catch(() => null);
    }

    const settings = getGuildSettings(cache.guildId);
    let player = getPlayer(client, cache.guildId);

    if (!player) {
      // Pastikan user masih di VC
      const member = interaction.member;
      const voiceId = member?.voice?.channel?.id || cache.voiceId;
      try {
        player = await client.kazagumo.createPlayer({
          guildId: cache.guildId,
          voiceId,
          textId: cache.channelId,
          volume: settings.volume ?? config.defaults.volume,
          deaf: true,
        });
      } catch (err) {
        log.error("AI playlist create player error:", err?.message || err);
        return interaction
          .followUp({
            embeds: [errorEmbed("❌ Gagal join voice channel. Pastikan kamu masih di VC.")],
            flags: 64,
          })
          .catch(() => null);
      }
    }

    player.queue.add(tracks);
    if (!player.playing && !player.paused) player.play();

    setGuildSettings(cache.guildId, { textChannelId: cache.channelId });
    client._aiPlaylistCache.delete(cacheKey);

    // Update panel
    try {
      const { updatePanel } = require("../music/panel");
      await updatePanel(client, cache.guildId);
    } catch { /* ignore */ }

    // Update embed: disable tombol + konfirmasi
    const baseEmbed = interaction.message.embeds[0]
      ? EmbedBuilder.from(interaction.message.embeds[0])
      : new EmbedBuilder();
    baseEmbed
      .setColor(Colors.SUCCESS)
      .setFooter({ text: `✅ ${tracks.length} lagu ditambahkan ke queue!` });

    return interaction
      .editReply({ embeds: [baseEmbed], components: [_buildButtons(cacheKey, true)] })
      .catch(() => null);
  }

  return null;
}

module.exports.handleAIPlaylistButton = handleAIPlaylistButton;

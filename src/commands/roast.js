const { SlashCommandBuilder } = require("discord.js");
const { getPlayer, getCurrentTrack } = require("../utils/player");
const { isAIAvailable } = require("../utils/ai");
const { callAIWithFallback } = require("../utils/aiProviderFallback");
const aiLimits = require("../utils/aiLimits");
const aiPromptCache = require("../utils/aiPromptCache");
const aiMemory = require("../utils/aiMemory");
const { warningEmbed } = require("../utils/embeds");
const { config } = require("../config");
const { makeLogger } = require("../utils/logger");

const log = makeLogger(config.logLevel);

const ROAST_SYSTEM_PROMPT = `Lo roaster paling savage di grup WA. Gaya bahasa lo gaul banget, kayak anak Twitter/TikTok Indonesia (bucin, red flag, halu, insecure, healing, circle, ambis, dll).

TUGAS: Roast orang yang request lagu yang lagi diputar. Sambungin tema/lirik lagunya ke kondisi mental dia secara savage tapi lucu.

CARA NULIS (PENTING):
- CUMA SATU PARAGRAF. Pendek, padat, nampol. Maksimal 3-4 kalimat.
- WAJIB sebut judul lagunya dalam roast-nya (biar nyambung lagunya apa).
- Langsung serang, jangan basa-basi "kamu lagi request lagu X ya?". Tapi tetep selipin judul lagunya secara natural di tengah roast.
- Sebut nama orangnya 1x aja, ga usah diulang-ulang.
- Gaya ngobrol santai kayak nge-roast temen, BUKAN gaya AI/formal. Jangan kasih saran/nasihat ("coba move on", "tetaplah jadi diri sendiri") — itu cupu. Murni roast.
- Emoji di akhir HARUS: 😹 (kucing jahat). Ganti 🤣 -> 😹

ATURAN:
- WAJIB Bahasa Indonesia gaul, santai.
- Boleh nyinggung taste musik, galau, percintaan — JANGAN SARA, fisik, atau hal sensitif beneran.
- Lucu & nampol, bukan ceramah. Langsung tulis roast-nya, tanpa judul/pembuka/penutup.`;

const NO_SONG_SYSTEM_PROMPT = `Lo roaster savage gaul Indonesia. User manggil roast tapi GAADA lagu yang diputar.

Roast dia karena nyuruh roast pas bot nganggur gaada musik. CUMA 1-2 kalimat, santai kayak ngobrol, sebut namanya sekali. Boleh 1 emoji. Langsung roast, tanpa pembuka.`;

function cleanTitle(title) {
  return (title || "")
    .replace(/\(.*?\)/g, "")
    .replace(/\[.*?\]/g, "")
    .replace(/official|video|audio|lyrics|hd|hq|mv/gi, "")
    .trim();
}

async function fetchLyrics(artist, title) {
  try {
    const query = `${artist || ""} ${cleanTitle(title)}`.trim();
    const encoded = encodeURIComponent(query);
    const res = await fetch(`https://lrclib.net/api/search?q=${encoded}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.length === 0) return null;
    const best = data[0];
    return best.plainLyrics || best.syncedLyrics || null;
  } catch {
    return null;
  }
}

function getRequesterName(requester) {
  if (!requester) return "seseorang";
  return (
    requester.displayName ||
    requester.globalName ||
    requester.username ||
    requester.tag ||
    "seseorang"
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("roast")
    .setDescription("AI roast lagu yang lagi diputar (atau roast kamu kalau gaada lagu)"),

  async execute(interaction, clientArg) {
    const client = clientArg || interaction.client;

    if (!isAIAvailable()) {
      return interaction.reply({
        content: "❌ Fitur AI belum diaktifkan. Admin perlu set `NVIDIA_API_KEY` di `.env`.",
        flags: 64,
      });
    }

    // === Rate limit check (shared across all AI features) ===
    // `/roast` is in the FREE_COMMANDS set — unlimited, doesn't consume a slot.
    const rl = aiLimits.checkAndIncrement(interaction.user.id, "roast");
    if (!rl.allowed) {
      const mins = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 60000));
      return interaction.reply({
        embeds: [warningEmbed(`⏱️ **Limit AI tercapai.**\nKamu sudah pakai maksimal request dalam 1 jam terakhir.\nCoba lagi dalam **${mins} menit**.`)],
        flags: 64,
      });
    }

    try {
      await interaction.deferReply();
    } catch {
      return;
    }

    // Pre-fetch current track info in parallel with the placeholder update
    const player = getPlayer(client, interaction.guildId);
    const current = getCurrentTrack(player);

    try {
      // === No song playing → roast the user ===
      if (!current) {
        const userName = getRequesterName(interaction.member || interaction.user);

        // Cache key for no-song roast
        const cacheKey = aiPromptCache._hashKey(`no-song:${userName}`, "roast", "no-song");
        const cached = aiPromptCache.get(interaction.user.id, cacheKey);
        if (cached) {
          // Cache hit: just send it directly, no extra AI call (still counts toward rate limit)
          await interaction.editReply("Roast...");
          await interaction.followUp(`<@${interaction.user.id}> ${cached}`.trim().slice(0, 1950));
          if (interaction.deleteReply) await interaction.deleteReply();
          return;
        }

        // Update placeholder jadi "Roast..." (1 status aja)
        await interaction.editReply("Roast...");

        const roast = await callAIWithFallback({
          messages: [
            { role: "system", content: NO_SONG_SYSTEM_PROMPT },
            {
              role: "user",
              content: `User bernama "${userName}" nyuruh roast tapi gaada lagu yang lagi diputar. Roast dia!`,
            },
          ],
          temperature: 0.9,
          maxTokens: 512,
          _source: "roast",
        });

        // Cache for 1h
        aiPromptCache.set(interaction.user.id, cacheKey, roast);

        // Kirim roast di chat baru, lalu hapus status "Roast..."
        await interaction.followUp(roast.slice(0, 1900));
        if (interaction.deleteReply) await interaction.deleteReply();
        return;
      }

      // === Song playing → roast the song + requester ===
      const title = current.title || "Unknown";
      const artist = current.author || "Unknown";
      const requester = current.requester;
      const requesterName = getRequesterName(requester);

      // Cache key: per-(user, track) to allow different users to roast same track
      const userMemCtx = aiMemory.isMemoryEnabled()
        ? aiMemory.formatUserForPrompt(interaction.user.id)
        : "";
      const cacheKey = aiPromptCache._hashKey(
        `${title}::${artist}::${requesterName}`,
        "roast",
        userMemCtx
      );
      const cached = aiPromptCache.get(interaction.user.id, cacheKey);
      if (cached) {
        // Cache hit
        await interaction.editReply("Roast...");
        const mention = requester?.id ? `<@${requester.id}> ` : "";
        const text = `${mention}${cached}`.trim();
        await interaction.followUp(text.slice(0, 1950));
        if (interaction.deleteReply) await interaction.deleteReply();
        return;
      }

      // Update placeholder jadi "Roast..." (1 status aja)
      await interaction.editReply("Roast...");

      // Jalanin lyrics fetch & AI call SECARA PARALEL biar lebih cepat
      const lyricsPromise = fetchLyrics(artist, title);

      const baseUserContent =
        `Lagu yang lagi diputar:\n` +
        `Judul: ${title}\n` +
        `Artis: ${artist}\n` +
        `Yang request: ${requesterName}` +
        (userMemCtx ? `\n\n--- KONTEKS USER (untuk personalize) ---\n${userMemCtx}` : "");

      // Mulai AI call dengan info dasar (tanpa lyrics dulu)
      const roastPromise = callAIWithFallback({
        messages: [
          { role: "system", content: ROAST_SYSTEM_PROMPT },
          { role: "user", content: baseUserContent },
        ],
        temperature: 0.9,
        maxTokens: 300,
        _source: "roast",
      });

      // Tunggu keduanya selesai
      const [lyrics, roast] = await Promise.all([
        lyricsPromise.catch(() => null),
        roastPromise,
      ]);

      // Cache for 1h
      aiPromptCache.set(interaction.user.id, cacheKey, roast);

      // Ping requester biar kena notif, lalu roast-nya di chat baru
      const mention = requester?.id ? `<@${requester.id}> ` : "";
      const text = `${mention}${roast}`.trim();

      // Kirim roast di chat baru, lalu hapus status "Roast..."
      await interaction.followUp(text.slice(0, 1950));
      if (interaction.deleteReply) await interaction.deleteReply();
      return;
    } catch (err) {
      log.error("Roast command error:", err?.message || err);
      return interaction.followUp(`❌ ${err?.message || "Gagal bikin roast. Coba lagi nanti."}`);
    }
  },
};

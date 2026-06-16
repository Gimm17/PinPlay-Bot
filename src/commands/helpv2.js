const {
  SlashCommandBuilder,
  EmbedBuilder,
} = require("discord.js");
const { config } = require("../config");

const P = config.prefix;

const PREFIX_COMMANDS = [
  {
    alias: `${P}p`,
    command: "play",
    usage: `${P}p <judul/link>`,
    desc: "Putar lagu / playlist dari judul, link YouTube, atau link Spotify.",
    example: `${P}p never gonna give you up`,
  },
  {
    alias: `${P}p-yt`,
    command: "play-yt",
    usage: `${P}p-yt <judul/link>`,
    desc: "Putar lagu via YouTube saja — aman dari Spotify rate limit. Link Spotify juga bisa.",
    example: `${P}p-yt https://open.spotify.com/playlist/...`,
  },
  {
    alias: `${P}s`,
    command: "skip",
    usage: `${P}s`,
    desc: "Skip lagu yang sedang diputar.",
    example: `${P}s`,
  },
  {
    alias: `${P}st`,
    command: "stop",
    usage: `${P}st`,
    desc: "Stop musik & bersihkan queue.",
    example: `${P}st`,
  },
  {
    alias: `${P}q`,
    command: "queue",
    usage: `${P}q [halaman]`,
    desc: "Lihat daftar antrian lagu (10 per halaman).",
    example: `${P}q 2`,
  },
  {
    alias: `${P}np`,
    command: "nowplaying",
    usage: `${P}np`,
    desc: "Lihat lagu yang sedang diputar + progress bar.",
    example: `${P}np`,
  },
  {
    alias: `${P}pause`,
    command: "pause",
    usage: `${P}pause`,
    desc: "Pause lagu.",
    example: `${P}pause`,
  },
  {
    alias: `${P}re`,
    command: "resume",
    usage: `${P}re`,
    desc: "Lanjutkan lagu dari pause.",
    example: `${P}re`,
  },
  {
    alias: `${P}sh`,
    command: "shuffle",
    usage: `${P}sh`,
    desc: "Acak urutan queue.",
    example: `${P}sh`,
  },
  {
    alias: `${P}cl`,
    command: "clear",
    usage: `${P}cl`,
    desc: "Bersihkan queue tanpa stop lagu saat ini.",
    example: `${P}cl`,
  },
  {
    alias: `${P}v`,
    command: "volume",
    usage: `${P}v <0-100>`,
    desc: "Atur volume bot.",
    example: `${P}v 60`,
  },
  {
    alias: `${P}lp`,
    command: "loop",
    usage: `${P}lp <none|track|queue>`,
    desc: "Atur loop. none=off, track=ulang lagu, queue=ulang antrian.",
    example: `${P}lp track`,
  },
  {
    alias: `${P}sk`,
    command: "seek",
    usage: `${P}sk <detik>`,
    desc: "Loncat ke posisi tertentu dalam lagu.",
    example: `${P}sk 90`,
  },
  {
    alias: `${P}f`,
    command: "filter",
    usage: `${P}f <off|bassboost|nightcore|vaporwave>`,
    desc: "Apply filter audio.",
    example: `${P}f bassboost`,
  },
  {
    alias: `${P}l`,
    command: "leave",
    usage: `${P}l`,
    desc: "Bot keluar dari voice channel.",
    example: `${P}l`,
  },
  {
    alias: `${P}sc`,
    command: "search",
    usage: `${P}sc <judul>`,
    desc: "Cari lagu, pilih dari top 5 hasil.",
    example: `${P}sc blinding lights`,
  },
  {
    alias: `${P}ly`,
    command: "lyrics",
    usage: `${P}ly [judul]`,
    desc: "Cari lirik lagu. Kosongkan = lagu yang sedang diputar.",
    example: `${P}ly`,
  },
  {
    alias: `${P}hist`,
    command: "history",
    usage: `${P}hist`,
    desc: "Lihat 15 lagu terakhir yang diputar.",
    example: `${P}hist`,
  },
  {
    alias: `${P}rm`,
    command: "remove",
    usage: `${P}rm <posisi>`,
    desc: "Hapus lagu dari queue berdasarkan posisi.",
    example: `${P}rm 3`,
  },
  {
    alias: `${P}mv`,
    command: "move",
    usage: `${P}mv <dari> <ke>`,
    desc: "Pindahkan lagu di queue dari posisi A ke B.",
    example: `${P}mv 5 1`,
  },
  {
    alias: `${P}stt`,
    command: "skipto",
    usage: `${P}stt <posisi>`,
    desc: "Skip langsung ke posisi tertentu di queue.",
    example: `${P}stt 4`,
  },
  {
    alias: `${P}panel`,
    command: "panel",
    usage: `${P}panel <create|show|remove>`,
    desc: "Buat/tampilkan/hapus panel kontrol musik.",
    example: `${P}panel create`,
  },
  {
    alias: `${P}h`,
    command: "help",
    usage: `${P}h [all|command]`,
    desc: "Bantuan command bot.",
    example: `${P}h all`,
  },
  {
    alias: `${P}247`,
    command: "24/7 mode",
    usage: `${P}247 <on|off>`,
    desc: "Mode 24/7 — bot tetap di voice saat queue kosong.",
    example: `${P}247 on`,
  },
  {
    alias: `${P}dj`,
    command: "djrole",
    usage: `${P}dj <set @role|view>`,
    desc: "Set/view role DJ untuk akses kontrol musik.",
    example: `${P}dj set @DJ`,
  },
  {
    alias: `${P}access`,
    command: "access",
    usage: `${P}access <mode|view|...>`,
    desc: "Atur siapa yang boleh kontrol musik.",
    example: `${P}access mode restricted`,
  },
  {
    alias: `${P}ap`,
    command: "aiplaylist",
    usage: `${P}ap [tema]`,
    desc: "AI bikin playlist otomatis dari tema/mood, approve buat masuk queue.",
    example: `${P}ap lagu galau indo viral`,
  },
  {
    alias: `${P}roast`,
    command: "roast",
    usage: `${P}roast`,
    desc: "AI roast lagu yang lagi diputar + yang request-nya. Lucu-lucuan.",
    example: `${P}roast`,
  },
  {
    alias: `${P}chat`,
    command: "chat",
    usage: `${P}chat <pesan> [--<personality>]`,
    desc: "Ngobrol sama AI (auto-detect personality). Reply pesan bot untuk lanjut. Owner + whitelist. Owner bisa tambah `--puisi` di akhir buat force personality one-shot.",
    example: `${P}chat buatin puisi tentang hujan --puisi`,
  },
  {
    alias: `${P}limit`,
    command: "ai-limit",
    usage: `${P}limit`,
    desc: "Cek sisa request AI kamu (ephemeral, gak makan quota). Progress bar + reset timer.",
    example: `${P}limit`,
  },
  {
    alias: `${P}ais`,
    command: "ai-set",
    usage: `${P}ais <model|limit|userlimit|bonus|reset-limit|whitelist|memory|fallback|cache|limits|view>`,
    desc: "[Owner] Atur setting global AI. Model: MiniMax-M3 | llama-3.3-70b. Sub: model, limit, userlimit, bonus, reset-limit, whitelist, memory, fallback, cache, limits, view.",
    example: `${P}ais model MiniMax-M3`,
  },
];

function buildHelpV2Embed() {
  const music = PREFIX_COMMANDS.filter((c) =>
    ["play", "play-yt", "search", "nowplaying", "queue", "lyrics", "history"].includes(c.command)
  );
  const control = PREFIX_COMMANDS.filter((c) =>
    [
      "skip", "stop", "pause", "resume", "loop", "shuffle",
      "seek", "volume", "filter", "remove", "move", "clear",
      "leave", "skipto",
    ].includes(c.command)
  );
  const setup = PREFIX_COMMANDS.filter((c) =>
    ["panel", "access", "djrole", "24/7 mode"].includes(c.command)
  );
  const ai = PREFIX_COMMANDS.filter((c) =>
    ["aiplaylist", "roast", "chat", "ai-limit", "ai-set"].includes(c.command)
  );

  const formatList = (list) =>
    list.map((c) => `**\`${c.alias}\`** → ${c.desc}`).join("\n");

  const embed = new EmbedBuilder()
    .setTitle(`📖 Prefix Commands — PinPlay`)
    .setColor(0x5865f2)
    .setDescription(
      `Prefix saat ini: **\`${P}\`**\n` +
      `Semua command ini juga bisa dipakai dengan nama lengkap: \`${P}play\`, \`${P}skip\`, dll.\n\n` +
      `Gunakan **\`/helpv2 detail\`** atau **\`${P}hv2 detail\`** untuk melihat detail tiap command.`
    )
    .addFields(
      { name: "🎵 Music", value: formatList(music), inline: false },
      { name: "🎛️ Control", value: formatList(control), inline: false },
      { name: "⚙️ Setup", value: formatList(setup), inline: false },
      { name: "🤖 AI", value: formatList(ai), inline: false }
    )
    .setFooter({ text: "💡 Tips: Semua prefix command punya permission yang sama dengan slash command." });

  return embed;
}

function buildHelpV2DetailEmbed() {
  const embed = new EmbedBuilder()
    .setTitle(`📖 Prefix Commands Detail — PinPlay`)
    .setColor(0x5865f2)
    .setDescription(
      `Prefix: **\`${P}\`** — Detail usage & contoh untuk setiap command.\n` +
      `Nama lengkap juga didukung: \`${P}play\`, \`${P}skip\`, dll.`
    );

  for (const c of PREFIX_COMMANDS) {
    embed.addFields({
      name: `${c.alias}  (${c.command})`,
      value:
        `**Usage:** \`${c.usage}\`\n` +
        `**Fungsi:** ${c.desc}\n` +
        `**Contoh:** \`${c.example}\``,
      inline: false,
    });
  }

  return embed;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("helpv2")
    .setDescription("Lihat daftar prefix commands (.p, .s, .q, dll)")
    .addStringOption((opt) =>
      opt
        .setName("mode")
        .setDescription("ringkas (default) atau detail")
        .setRequired(false)
        .addChoices(
          { name: "Ringkas", value: "summary" },
          { name: "Detail", value: "detail" }
        )
    ),

  async execute(interaction) {
    const mode = interaction.options.getString("mode") ?? "summary";

    if (mode === "detail") {
      return interaction.reply({ embeds: [buildHelpV2DetailEmbed()], flags: 64 });
    }

    return interaction.reply({ embeds: [buildHelpV2Embed()], flags: 64 });
  },
};

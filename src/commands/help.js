const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const COMMANDS = [
  {
    name: "play",
    usage: "/play query:<judul/link>",
    detail:
      "Tambah lagu/playlist ke antrian. Bisa pakai judul (auto search), link YouTube, atau link Spotify (via LavaSrc).\n" +
      "Wajib join voice channel. Semua orang boleh pakai.",
    examples: [
      "/play query: never gonna give you up",
      "/play query: https://open.spotify.com/track/...",
      "/play query: https://open.spotify.com/playlist/...",
    ],
  },
  {
    name: "nowplaying",
    usage: "/nowplaying",
    detail: "Lihat lagu yang sedang diputar.",
    examples: ["/nowplaying"],
  },
  {
    name: "queue",
    usage: "/queue page:<angka?>",
    detail:
      "Lihat daftar antrian (10 lagu per halaman).\n" +
      "Siapa saja bisa melihat queue — tidak perlu join voice channel.",
    examples: ["/queue", "/queue page:2"],
  },
  {
    name: "loop",
    usage: "/loop mode:<none|track|queue>",
    detail:
      "Atur loop.\n- none: off\n- track: ulang lagu sekarang\n- queue: ulang 1 antrian",
    examples: ["/loop mode:track", "/loop mode:none"],
  },
  {
    name: "pause",
    usage: "/pause",
    detail: "Pause lagu.",
    examples: ["/pause"],
  },
  {
    name: "resume",
    usage: "/resume",
    detail: "Lanjutkan lagu.",
    examples: ["/resume"],
  },
  {
    name: "skip",
    usage: "/skip",
    detail: "Skip lagu sekarang.",
    examples: ["/skip"],
  },
  {
    name: "stop",
    usage: "/stop",
    detail: "Stop & clear queue.",
    examples: ["/stop"],
  },
  {
    name: "shuffle",
    usage: "/shuffle",
    detail: "Acak urutan queue.",
    examples: ["/shuffle"],
  },
  {
    name: "seek",
    usage: "/seek seconds:<angka>",
    detail: "Loncat ke posisi tertentu (detik).",
    examples: ["/seek seconds:90"],
  },
  {
    name: "volume",
    usage: "/volume value:<0-100>",
    detail: "Atur volume player.",
    examples: ["/volume value:60"],
  },

  {
    name: "filter",
    usage: "/filter name:<off|bassboost|nightcore|vaporwave>",
    detail:
      "Apply filter sederhana (equalizer/timescale). Ini termasuk **kontrol**, jadi mengikuti setting `/access`.",
    examples: ["/filter name:bassboost", "/filter name:off"],
  },

  {
    name: "leave",
    usage: "/leave",
    detail: "Memaksa bot keluar dari voice channel dan menghentikan player.",
    examples: ["/leave"],
  },

  {
    name: "panel",
    usage: "/panel action:<create|remove|show>",
    detail:
      "Buat interface (embed + buttons) biar kontrol lebih gampang tanpa banyak command.\n" +
      "- create: kirim panel di channel ini & simpan\n- show: update panel (kalau ada)\n- remove: hapus data panel dari settings",
    examples: ["/panel action:create"],
  },
  {
    name: "access",
    usage: "/access <subcommand>",
    detail:
      "Atur siapa yang boleh kontrol musik (selain /play).\n" +
      "Admin/ManageGuild selalu boleh kontrol.\n" +
      "Mode:\n- all: semua orang boleh kontrol\n- restricted: hanya DJ/admin/allowed user/role\n\n" +
      "Subcommand penting:\n" +
      "- /access mode (set all/restricted)\n" +
      "- /access allowuser (add/remove/list)\n" +
      "- /access allowrole (add/remove/list)\n" +
      "- /access requestchannel (batasi command musik ke 1 text channel)\n" +
      "- /access view (lihat setting)",
    examples: [
      "/access mode mode:restricted",
      "/access allowuser add user:@user",
      "/access allowrole add role:@DJ",
      "/access requestchannel channel:#music",
      "/access view",
    ],
  },
  {
    name: "djrole",
    usage: "/djrole set role:<@role>  atau  /djrole view",
    detail:
      "Set/view role DJ yang otomatis punya izin kontrol saat mode restricted.",
    examples: ["/djrole set role:@DJ", "/djrole view"],
  },
  {
    name: "247",
    usage: "/247 enable:<true|false>",
    detail:
      "Mode 24/7 (bot stay di voice). Kalau aktif, bot tidak auto-leave ketika queue kosong.",
    examples: ["/247 enable:true"],
  },
  {
    name: "search",
    usage: "/search query:<judul>",
    detail:
      "Cari lagu dan pilih dari top 5 hasil via select menu.\n" +
      "Wajib join voice channel.",
    examples: ["/search query:Menunggumu NOAH"],
  },
  {
    name: "lyrics",
    usage: "/lyrics query:<judul?>",
    detail:
      "Cari lirik lagu via lrclib.net (gratis, tanpa API key).\n" +
      "Kalau query kosong, otomatis ambil dari lagu yang sedang diputar.",
    examples: ["/lyrics", "/lyrics query:Blinding Lights"],
  },
  {
    name: "history",
    usage: "/history",
    detail: "Lihat 15 lagu terakhir yang diputar di server ini. History direset saat bot restart.",
    examples: ["/history"],
  },
  {
    name: "remove",
    usage: "/remove position:<angka>",
    detail: "Hapus lagu dari queue berdasarkan posisi (1, 2, 3, ...).",
    examples: ["/remove position:3"],
  },
  {
    name: "move",
    usage: "/move from:<angka> to:<angka>",
    detail: "Pindahkan lagu di queue dari posisi A ke posisi B.",
    examples: ["/move from:5 to:1"],
  },
  {
    name: "clear",
    usage: "/clear",
    detail: "Bersihkan semua lagu di queue tanpa menghentikan lagu yang sedang diputar.",
    examples: ["/clear"],
  },
  {
    name: "skipto",
    usage: "/skipto position:<angka>",
    detail: "Loncat langsung ke posisi tertentu di queue, skip semua lagu sebelumnya.",
    examples: ["/skipto position:4"],
  },
  {
    name: "aiplaylist",
    usage: "/aiplaylist query:<tema>",
    detail:
      "Buat playlist otomatis pake AI. Kasih tema/mood, AI bakal cariin 10-15 lagu yang cocok.\n" +
      "Contoh tema: 'galau indo viral', 'nongkrong santai', 'workout energik'.\n" +
      "Hasilnya muncul dengan tombol Konfirmasi — klik buat masukin semua lagu ke queue.\n" +
      "Wajib join voice channel. Butuh NVIDIA_API_KEY di .env.",
    examples: [
      "/aiplaylist query: lagu galau indo viral",
      ".ap lagu galau indo viral",
      ".ap (lalu ketik temanya)",
    ],
  },
  {
    name: "roast",
    usage: "/roast",
    detail:
      "AI roast lagu yang lagi diputar + orang yang request-nya. Buat lucu-lucuan.\n" +
      "Kalau gaada lagu, AI bakal roast kamu instead. Bahasa Indonesia gaul.\n" +
      "Butuh NVIDIA_API_KEY di .env.",
    examples: ["/roast", ".roast"],
  },
];

// ===== Helpers (untuk /help all + pagination) =====

const HELP_ALL_PER_PAGE = 3;

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function truncate(str, max) {
  if (!str) return "";
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + "…";
}

function buildAllHelpSummaryEmbed() {
  const embed = new EmbedBuilder()
    .setTitle("📚 Help - PinPlay")
    .setDescription(
      "Gunakan:\n" +
        "• `/help command:<nama>` untuk detail per command.\n" +
        "• `/help all:true` untuk menampilkan SEMUA help (dipaginasi).\n\n" +
        "🔑 **Akses kontrol**\n" +
        "- `/play` boleh semua orang (wajib di voice).\n" +
        "- Command kontrol lain mengikuti setting `/access`.\n"
    );

  const music = ["play", "search", "nowplaying", "queue", "lyrics", "history"];
  const control = [
    "loop",
    "pause",
    "resume",
    "skip",
    "skipto",
    "stop",
    "shuffle",
    "seek",
    "volume",
    "filter",
    "remove",
    "move",
    "clear",
    "leave",
  ];
  const setup = ["panel", "access", "djrole", "247"];
  const ai = ["aiplaylist", "roast"];

  embed.addFields(
    { name: "🎵 Music", value: music.map((c) => `\`/${c}\``).join("  ") },
    { name: "🎛️ Control", value: control.map((c) => `\`/${c}\``).join("  ") },
    { name: "⚙️ Setup", value: setup.map((c) => `\`/${c}\``).join("  ") },
    { name: "🤖 AI", value: ai.map((c) => `\`/${c}\``).join("  ") }
  );

  return embed;
}

function buildCommandHelpEmbed(name) {
  const c = COMMANDS.find((x) => x.name === name);
  if (!c) return null;

  const embed = new EmbedBuilder()
    .setTitle(`📌 /${c.name}`)
    .addFields(
      { name: "Usage", value: `\`${c.usage}\`` },
      { name: "Penjelasan", value: c.detail }
    );

  if (c.examples?.length) {
    embed.addFields({
      name: "Contoh",
      value: c.examples.map((e) => `• \`${e}\``).join("\n"),
    });
  }

  return embed;
}

function getAllHelpPages() {
  // Urutkan biar rapi
  const sorted = [...COMMANDS].sort((a, b) => a.name.localeCompare(b.name));
  return chunk(sorted, HELP_ALL_PER_PAGE);
}

function buildHelpAllPageEmbed(pageIndex) {
  const pages = getAllHelpPages();
  const totalPages = pages.length;
  const safeIndex = clamp(pageIndex, 0, totalPages - 1);

  const embed = new EmbedBuilder()
    .setTitle(`📖 Help Lengkap PinPlay — Page ${safeIndex + 1}/${totalPages}`)
    .setDescription(
      "Ini versi detail untuk semua command.\n" +
        "Tips: kamu juga bisa pakai `/help command:<nama>` untuk fokus 1 command.\n"
    );

  const cmds = pages[safeIndex] || [];

  for (const c of cmds) {
    const examples = (c.examples || [])
      .slice(0, 3)
      .map((e) => `• \`${e}\``)
      .join("\n");
    const value =
      `**Usage:** \`${c.usage}\`\n` +
      `**Penjelasan:** ${truncate(c.detail, 900)}\n` +
      (examples ? `**Contoh:**\n${examples}` : "");

    embed.addFields({ name: `/${c.name}`, value });
  }

  return { embed, pageIndex: safeIndex, totalPages };
}

function buildHelpAllPagerRow(pageIndex, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`help:all:prev:${pageIndex}`)
      .setLabel("⬅ Prev")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(pageIndex <= 0),
    new ButtonBuilder()
      .setCustomId(`help:all:next:${pageIndex}`)
      .setLabel("Next ➡")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(pageIndex >= totalPages - 1)
  );
}

// dipakai oleh interactionHandler untuk tombol paging
function renderHelpAllMessage(pageIndex) {
  const { embed, totalPages } = buildHelpAllPageEmbed(pageIndex);
  const row = buildHelpAllPagerRow(pageIndex, totalPages);
  return { embeds: [embed], components: [row] };
}

module.exports = {
  // export helper supaya handler tombol bisa pakai
  renderHelpAllMessage,

  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("Lihat panduan penggunaan bot")
    .addBooleanOption((opt) =>
      opt
        .setName("all")
        .setDescription("Tampilkan semua help (detail, dipaginasi)")
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName("command")
        .setDescription("Nama command (contoh: play, loop, panel)")
        .setRequired(false)
        .setAutocomplete(false)
    ),

  async execute(interaction) {
    const showAll = interaction.options.getBoolean("all") ?? false;
    const name = interaction.options.getString("command");

    // /help all:true => detail semua (page 1)
    if (showAll) {
      const payload = renderHelpAllMessage(0);
      return interaction.reply({ ...payload, flags: 64 });
    }

    // /help command:xxx => detail per command
    if (name) {
      const embed = buildCommandHelpEmbed(name.toLowerCase());
      if (!embed) {
        return interaction.reply({
          content:
            "❌ Command tidak ditemukan. Coba `/help` tanpa parameter untuk list.",
          flags: 64,
        });
      }
      return interaction.reply({ embeds: [embed], flags: 64 });
    }

    // default => ringkas
    return interaction.reply({
      embeds: [buildAllHelpSummaryEmbed()],
      flags: 64,
    });
  },
};

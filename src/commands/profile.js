/**
 * profile.js - /profile [user] | /profile reset
 *
 * Music profile per user: top servers, top friends, top tracks — the same idea
 * as Jockie Music's `m!profile`.
 *
 * DATA SOURCE: src/utils/userPlayHistory.js, fed from `playerStart` in
 * music/events.js. It persists to data/userPlayHistory.json (debounced atomic
 * write), so unlike /history these numbers survive a bot restart.
 *
 * "Top friends" is INFERRED — see the footer of the embed. The bot has no
 * co-listening log (nothing records who shared a voice channel with whom over
 * time), so friends are ranked by Jaccard similarity over played-track sets.
 * That measures similar taste, not a real friendship, and the embed says so
 * rather than implying the bot knows who someone hangs out with.
 *
 * No `GuildMembers` intent is needed: the target user comes from
 * `interaction.options.getUser()` (already in the interaction payload), and
 * resolving a cached id to a name uses the user cache or a REST fetch.
 */

const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { config } = require("../config");
const { Colors } = require("../utils/colors");
const { successEmbed, errorEmbed, infoEmbed } = require("../utils/embeds");
const { makeLogger } = require("../utils/logger");
const userPlayHistory = require("../utils/userPlayHistory");
const aiMemory = require("../utils/aiMemory");

const log = makeLogger(config.logLevel);

/** Escape Discord markdown so a track title cannot break the embed layout. */
function esc(text) {
  return String(text || "").replace(/([*_`~\\|])/g, "\\$1");
}

function isOwner(userId) {
  return Boolean(config.discord.ownerId) && userId === config.discord.ownerId;
}

/**
 * Best-effort display name for a user id.
 * Uses the cache first (free) and falls back to a REST fetch. A failure is not
 * an error here — the row still renders with the raw id.
 */
async function resolveName(client, userId) {
  const cached = client.users?.cache?.get(userId);
  if (cached) return cached.displayName || cached.username || userId;
  try {
    const fetched = await client.users.fetch(userId);
    return fetched.displayName || fetched.username || userId;
  } catch {
    return userId;
  }
}

function buildProfileEmbed(user, profile, guildNames, friendNames) {
  const embed = new EmbedBuilder()
    .setColor(Colors.CHAT)
    .setAuthor({ name: user.displayName || user.username || user.id })
    .setThumbnail(user.displayAvatarURL?.({ size: 128 }) || null);

  const acct = user.createdTimestamp
    ? `Akun dibuat <t:${Math.floor(user.createdTimestamp / 1000)}:R>`
    : "";
  const summary = [
    profile.totalPlays
      ? `**${profile.totalPlays.toLocaleString("id-ID")}** lagu tercatat`
      : "Belum ada aktivitas musik",
    acct,
  ]
    .filter(Boolean)
    .join(" • ");

  embed.setDescription(summary);

  const rank = (i) => `\`${i + 1}.\``;

  // --- Top tracks ---
  if (profile.tracks.length) {
    embed.addFields({
      name: "🎵 Top Tracks",
      value: profile.tracks
        .map((t, i) => {
          const title = esc(t.title);
          const author = t.author ? ` — ${esc(t.author)}` : "";
          return `${rank(i)} ${title}${author} • **${t.count}×**`;
        })
        .join("\n")
        .slice(0, 1024),
    });
  }

  // --- Top servers ---
  if (profile.guilds.length) {
    embed.addFields({
      name: "🏠 Top Servers",
      value: profile.guilds
        .map((g, i) => `${rank(i)} ${esc(guildNames[g.guildId] || g.guildId)} • **${g.count}×**`)
        .join("\n")
        .slice(0, 1024),
    });
  }

  // --- Top friends (inferred) ---
  if (profile.friends.length) {
    embed.addFields({
      name: "👥 Top Friends",
      value: profile.friends
        .map(
          (f, i) =>
            `${rank(i)} ${esc(friendNames[f.userId] || f.userId)} • ${Math.round(f.score * 100)}% mirip`
        )
        .join("\n")
        .slice(0, 1024),
    });
  }

  // --- AI memory (optional, only if the user has any) ---
  if (aiMemory.isMemoryEnabled()) {
    try {
      const mem = aiMemory.getUserMemory(user.id);
      const bits = [];
      if (mem.nickname) bits.push(`Panggilan: **${esc(mem.nickname)}**`);
      if (mem.currentMood) bits.push(`Mood: ${esc(mem.currentMood)}`);
      if (Array.isArray(mem.favoriteArtist) && mem.favoriteArtist.length)
        bits.push(`Artis: ${esc(mem.favoriteArtist.slice(0, 3).join(", "))}`);
      if (Array.isArray(mem.interests) && mem.interests.length)
        bits.push(`Minat: ${esc(mem.interests.slice(0, 3).join(", "))}`);
      if (bits.length) {
        embed.addFields({ name: "🧠 Catatan AI", value: bits.join("\n").slice(0, 1024) });
      }
    } catch {
      /* memory is optional decoration */
    }
  }

  embed.setFooter({
    text: userPlayHistory.getUserProfile(user.id).friends.length
      ? "Top Friends dihitung dari kemiripan lagu yang didengar, bukan dari riwayat voice channel."
      : "Data terkumpul sejak bot mencatat aktivitas musik.",
  });

  return embed;
}

/** Empty-state embed, so a new user sees guidance instead of an error. */
function buildEmptyEmbed(user) {
  return infoEmbed(
    `**${esc(user.displayName || user.username || user.id)}** belum punya data musik.\n` +
      `Putar lagu dengan /play — setelah itu profil (top tracks, top servers, top friends) akan terisi otomatis.`
  ).setThumbnail(user.displayAvatarURL?.({ size: 128 }) || null);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("profile")
    .setDescription("Lihat profil musik: top lagu, server, dan teman dengan selera mirip")
    .addSubcommand((sub) =>
      sub
        .setName("view")
        .setDescription("Lihat profil musik seseorang")
        .addUserOption((o) =>
          o
            .setName("user")
            .setDescription("User yang ingin dilihat (default: kamu sendiri)")
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub.setName("reset").setDescription("[Owner] Hapus data profil musik kamu")
    ),

  async execute(interaction, clientArg) {
    const client = clientArg || interaction.client;
    const sub = interaction.options.getSubcommand(true);

    // === reset (owner only) ===
    if (sub === "reset") {
      if (!isOwner(interaction.user.id)) {
        return interaction.reply({
          embeds: [errorEmbed("❌ Subcommand ini khusus owner bot.")],
          flags: 64,
        });
      }
      const cleared = userPlayHistory.resetUser(interaction.user.id);
      userPlayHistory.flushNow();
      return interaction.reply({
        embeds: [
          cleared
            ? successEmbed("✅ Data profil musik kamu dihapus.")
            : infoEmbed("ℹ️ Tidak ada data profil untuk dihapus."),
        ],
        flags: 64,
      });
    }

    const targetUser = interaction.options.getUser("user") || interaction.user;

    try {
      const profile = userPlayHistory.getUserProfile(targetUser.id, {
        topTracks: 5,
        topGuilds: 5,
        topFriends: 3,
      });

      if (!profile.totalPlays) {
        return interaction.reply({ embeds: [buildEmptyEmbed(targetUser)] });
      }

      // Resolve names for guilds (cache is reliable — no intent needed) and for
      // friend ids (may need a REST fetch, hence the Promise.all).
      const guildNames = {};
      for (const g of profile.guilds) {
        guildNames[g.guildId] = client.guilds?.cache?.get(g.guildId)?.name || g.guildId;
      }
      const friendPairs = await Promise.all(
        profile.friends.map(async (f) => [f.userId, await resolveName(client, f.userId)])
      );
      const friendNames = Object.fromEntries(friendPairs);

      const embed = buildProfileEmbed(targetUser, profile, guildNames, friendNames);
      return interaction.reply({ embeds: [embed] });
    } catch (e) {
      log.error(`Profile error [user=${targetUser?.id}]:`, e?.message || e);
      return interaction.reply({
        embeds: [errorEmbed("❌ Gagal memuat profil. Coba lagi nanti.")],
        flags: 64,
      });
    }
  },
};

// Exported for the smoke test.
module.exports._internal = { buildProfileEmbed, buildEmptyEmbed, resolveName };

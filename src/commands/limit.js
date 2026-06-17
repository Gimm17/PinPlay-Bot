/**
 * limit.js - Self-service AI limit status (Phase D)
 *
 * /ai-limit
 * .limit
 *
 * Show current usage of the calling user — used/total, remaining,
 * reset timer, and progress bar. Ephemeral (only the user sees it).
 *
 * Access: any user allowed by AI access rules
 *   - Owner: always (shows bypass status)
 *   - Whitelisted users: yes
 *   - Non-whitelisted: also allowed to VIEW (not a privileged operation)
 *
 * Does NOT count against rate limit (read-only).
 */

const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { config } = require("../config");
const { Colors } = require("../utils/colors");
const aiLimits = require("../utils/aiLimits");
const aiSettings = require("../utils/aiSettings");
const { successEmbed, errorEmbed, infoEmbed } = require("../utils/embeds");

const PROGRESS_BAR_LENGTH = 10;

function _buildProgressBar(percent) {
  if (!Number.isFinite(percent) || percent <= 0) {
    return "░".repeat(PROGRESS_BAR_LENGTH);
  }
  const filled = Math.round((percent / 100) * PROGRESS_BAR_LENGTH);
  return "█".repeat(filled) + "░".repeat(PROGRESS_BAR_LENGTH - filled);
}

function _buildStatusEmbed(status) {
  if (status.isOwner) {
    return new EmbedBuilder()
      .setColor(Colors.AI)
      .setTitle("⏱️ Status Limit AI Kamu")
      .setDescription(
        `**Used:** — (bypass)\n` +
          `**Limit:** ∞ (unlimited)\n` +
          `**Sisa:** ∞ request\n` +
          `**Reset:** — (gak ada window)\n\n` +
          `👑 Kamu owner — gak kena rate limit.`
      )
      .setFooter({ text: "Tipe akses: Owner bypass" });
  }

  const bar = _buildProgressBar(status.percent);
  const resetTxt =
    status.minutesLeft !== null
      ? status.minutesLeft > 0
        ? `${status.minutesLeft} menit lagi`
        : "sebentar lagi..."
      : "window baru";

  const statusEmoji = {
    ok: "✅",
    "near-limit": "⚠️",
    "limit-exceeded": "🚫",
  }[status.status] || "✅";

  return new EmbedBuilder()
    .setColor(
      status.status === "limit-exceeded"
        ? Colors.ERROR
        : status.status === "near-limit"
        ? Colors.WARNING
        : Colors.AI
    )
    .setTitle("⏱️ Status Limit AI Kamu")
    .setDescription(
      `${statusEmoji} **Used:** ${status.count}/${status.limit} (${status.percent}%)\n` +
        `\`${bar}\`\n` +
        `**Sisa:** ${status.remaining} request\n` +
        `**Reset:** ${resetTxt}\n\n` +
        `_Tip: Limit ini cuma dihitung dari /chat. /roast & /aiplaylist unlimited (gak makan quota)._`
    )
    .setFooter({
      text: `Tipe akses: ${status.isOwner ? "Owner bypass" : "Standard user"} • Window: 1 jam rolling`,
    });
}

function _isAllowedToView(userId) {
  // Anyone can view their own status (read-only operation)
  return Boolean(userId);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ai-limit")
    .setDescription("Cek sisa request AI kamu (ephemeral, gak makan quota)"),

  async execute(interaction) {
    const userId = interaction.user.id;
    if (!_isAllowedToView(userId)) {
      return interaction.reply({ embeds: [errorEmbed("❌ Invalid user.")], flags: 64 });
    }
    const status = aiLimits.getUserLimitStatus(userId);
    const embed = _buildStatusEmbed(status);
    return interaction.reply({ embeds: [embed], flags: 64 });
  },

  // Exposed for testing
  _buildStatusEmbed,
  _buildProgressBar,
};

// === Prefix handler (called from messageHandler via execute) ===
async function handlePrefix(ctx) {
  const userId = ctx.user?.id;
  if (!_isAllowedToView(userId)) {
    return ctx.reply("❌ Invalid user.");
  }
  const status = aiLimits.getUserLimitStatus(userId);
  // For prefix, build as plain text (no embed in prefix reply by default — but PrefixContext supports embeds)
  const embed = _buildStatusEmbed(status);
  return ctx.reply({ embeds: [embed] });
}

module.exports.handlePrefix = handlePrefix;

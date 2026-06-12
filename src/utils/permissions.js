const { config } = require("../config");

function isAdmin(interaction) {
  if (config.discord.ownerId && interaction.user.id === config.discord.ownerId) {
    return true;
  }
  return (
    interaction.memberPermissions?.has("Administrator") ||
    interaction.memberPermissions?.has("ManageGuild")
  );
}

/**
 * Kontrol musik (pause/skip/loop/queue/dll).
 * - Kalau controlMode = "all" -> semua user boleh (tetap wajib di voice & same VC)
 * - Kalau "restricted" -> hanya Admin/ManageGuild, DJ role, allowed users, allowed roles
 */
function canControl(interaction, settings = {}) {
  const mode = settings.controlMode || "all";
  if (mode === "all") return true;

  if (isAdmin(interaction)) return true;

  const member = interaction.member;
  const roles = member?.roles?.cache;

  if (settings.djRoleId && roles?.has(settings.djRoleId)) return true;

  const allowedUsers = Array.isArray(settings.allowedUserIds) ? settings.allowedUserIds : [];
  if (allowedUsers.includes(interaction.user.id)) return true;

  const allowedRoles = Array.isArray(settings.allowedRoleIds) ? settings.allowedRoleIds : [];
  if (allowedRoles.some((id) => roles?.has(id))) return true;

  return false;
}

function inVoice(interaction) {
  const vc = interaction.member?.voice?.channel;
  return vc || null;
}

function sameVoiceAsBot(interaction, player) {
  const userVc = interaction.member?.voice?.channelId;
  const botVc = player?.voiceId;
  if (!userVc || !botVc) return false;
  return userVc === botVc;
}

/**
 * Guard utk /play (SEMUA boleh, tapi wajib ada VC).
 */
async function requireVoiceForPlay(interaction) {
  const vc = inVoice(interaction);
  if (!vc) {
    await interaction.reply({
      content: "❌ Kamu harus **join voice channel** dulu.",
      flags: 64,
    }).catch(() => null);
    return null;
  }
  return vc;
}

/**
 * Guard utk kontrol (pause/skip/queue/loop/dll):
 * - wajib ada player
 * - wajib user di VC
 * - wajib same VC dengan bot
 * - wajib akses (kalau restricted)
 */
async function requireControl(interaction, player, settings) {
  if (!player) {
    await interaction.reply({
      content: "❌ Tidak ada player aktif di server ini.",
      flags: 64,
    }).catch(() => null);
    return false;
  }

  const vc = inVoice(interaction);
  if (!vc) {
    await interaction.reply({
      content: "❌ Kamu harus **join voice channel** dulu.",
      flags: 64,
    }).catch(() => null);
    return false;
  }

  // Pastikan satu VC dengan bot
  if (!sameVoiceAsBot(interaction, player)) {
    await interaction.reply({
      content: "❌ Kamu harus berada di **voice channel yang sama** dengan bot.",
      flags: 64,
    }).catch(() => null);
    return false;
  }

  if (!canControl(interaction, settings)) {
    await interaction.reply({
      content:
        "⛔ Kamu tidak punya izin untuk kontrol musik.\n" +
        "Admin bisa atur via **/access** (mode restricted / allowed users / allowed roles) atau set **/djrole**.",
      flags: 64,
    }).catch(() => null);
    return false;
  }

  return true;
}

module.exports = {
  isAdmin,
  canControl,
  requireVoiceForPlay,
  requireControl,
  sameVoiceAsBot,
};

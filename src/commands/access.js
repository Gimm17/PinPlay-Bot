const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require("discord.js");
const { getGuildSettings, setGuildSettings } = require("../utils/storage");
const { isAdmin } = require("../utils/permissions");

function uniq(arr) {
  return Array.from(new Set(arr));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("access")
    .setDescription("Atur akses kontrol musik (DJ / allowed users / allowed roles)")
    .addSubcommand((sc) =>
      sc
        .setName("mode")
        .setDescription("Set mode akses kontrol")
        .addStringOption((opt) =>
          opt
            .setName("mode")
            .setDescription("all = semua orang bisa kontrol, restricted = hanya DJ/admin/allowed")
            .setRequired(true)
            .addChoices(
              { name: "all", value: "all" },
              { name: "restricted", value: "restricted" }
            )
        )
    )
    .addSubcommand((sc) =>
      sc
        .setName("allowuser")
        .setDescription("Tambah/hapus user yang boleh kontrol saat mode restricted")
        .addStringOption((opt) =>
          opt
            .setName("action")
            .setDescription("Aksi")
            .setRequired(true)
            .addChoices(
              { name: "add", value: "add" },
              { name: "remove", value: "remove" },
              { name: "list", value: "list" }
            )
        )
        .addUserOption((opt) =>
          opt.setName("user").setDescription("User (untuk add/remove)").setRequired(false)
        )
    )
    .addSubcommand((sc) =>
      sc
        .setName("allowrole")
        .setDescription("Tambah/hapus role yang boleh kontrol saat mode restricted")
        .addStringOption((opt) =>
          opt
            .setName("action")
            .setDescription("Aksi")
            .setRequired(true)
            .addChoices(
              { name: "add", value: "add" },
              { name: "remove", value: "remove" },
              { name: "list", value: "list" }
            )
        )
        .addRoleOption((opt) =>
          opt.setName("role").setDescription("Role (untuk add/remove)").setRequired(false)
        )
    )
    .addSubcommand((sc) =>
      sc
        .setName("requestchannel")
        .setDescription("Batasi command music hanya di 1 channel (opsional)")
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("Pilih channel (atau kosongkan untuk disable)")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false)
        )
    )
    .addSubcommand((sc) => sc.setName("view").setDescription("Lihat konfigurasi akses saat ini")),

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return interaction.reply({ content: "❌ Command ini khusus untuk Administrator atau Owner bot.", flags: 64 });
    }

    const guildId = interaction.guildId;
    const settings = getGuildSettings(guildId);
    const sub = interaction.options.getSubcommand();

    if (sub === "mode") {
      const mode = interaction.options.getString("mode", true);
      setGuildSettings(guildId, { controlMode: mode });
      return interaction.reply({ content: `✅ controlMode set to **${mode}**`, flags: 64 });
    }

    if (sub === "allowuser") {
      const action = interaction.options.getString("action", true);
      const user = interaction.options.getUser("user");
      const list = Array.isArray(settings.allowedUserIds) ? settings.allowedUserIds : [];

      if (action === "list") {
        const pretty = list.length ? list.map((id) => `<@${id}>`).join("\n") : "Kosong.";
        return interaction.reply({ content: `👤 Allowed Users:\n${pretty}`, flags: 64 });
      }

      if (!user) {
        return interaction.reply({ content: "❌ Pilih user dulu.", flags: 64 });
      }

      const next =
        action === "add"
          ? uniq([...list, user.id])
          : list.filter((id) => id !== user.id);

      setGuildSettings(guildId, { allowedUserIds: next });
      return interaction.reply({
        content:
          action === "add"
            ? `✅ Ditambahkan: ${user}`
            : `✅ Dihapus: ${user}`,
        flags: 64,
      });
    }

    if (sub === "allowrole") {
      const action = interaction.options.getString("action", true);
      const role = interaction.options.getRole("role");
      const list = Array.isArray(settings.allowedRoleIds) ? settings.allowedRoleIds : [];

      if (action === "list") {
        const pretty = list.length ? list.map((id) => `<@&${id}>`).join("\n") : "Kosong.";
        return interaction.reply({ content: `🎭 Allowed Roles:\n${pretty}`, flags: 64 });
      }

      if (!role) {
        return interaction.reply({ content: "❌ Pilih role dulu.", flags: 64 });
      }

      const next =
        action === "add"
          ? uniq([...list, role.id])
          : list.filter((id) => id !== role.id);

      setGuildSettings(guildId, { allowedRoleIds: next });
      return interaction.reply({
        content:
          action === "add"
            ? `✅ Ditambahkan: ${role}`
            : `✅ Dihapus: ${role}`,
        flags: 64,
      });
    }

    if (sub === "requestchannel") {
      const channel = interaction.options.getChannel("channel");
      setGuildSettings(guildId, { requestChannelId: channel?.id || null });
      return interaction.reply({
        content: channel
          ? `✅ Request channel diset ke ${channel}`
          : "✅ Request channel dimatikan (bebas di mana saja).",
        flags: 64,
      });
    }

    // view
    const embed = new EmbedBuilder()
      .setTitle("⚙️ Access Settings")
      .addFields(
        { name: "controlMode", value: `\`${settings.controlMode || "all"}\``, inline: true },
        { name: "DJ Role", value: settings.djRoleId ? `<@&${settings.djRoleId}>` : "—", inline: true },
        { name: "Request Channel", value: settings.requestChannelId ? `<#${settings.requestChannelId}>` : "—", inline: true },
        {
          name: "Allowed Users",
          value: (settings.allowedUserIds?.length ? settings.allowedUserIds.map((id) => `<@${id}>`).join(" ") : "—"),
        },
        {
          name: "Allowed Roles",
          value: (settings.allowedRoleIds?.length ? settings.allowedRoleIds.map((id) => `<@&${id}>`).join(" ") : "—"),
        }
      );

    return interaction.reply({ embeds: [embed], flags: 64 });
  },
};

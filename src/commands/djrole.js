const { SlashCommandBuilder } = require("discord.js");
const { setGuildSettings, getGuildSettings } = require("../utils/storage");
const { isAdmin } = require("../utils/permissions");
const { successEmbed, infoEmbed } = require("../utils/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("djrole")
    .setDescription("Set or view the DJ role (controls music commands)")
    .addSubcommand(sc =>
      sc.setName("set")
        .setDescription("Set the DJ role")
        .addRoleOption(opt =>
          opt.setName("role")
            .setDescription("Role that can control music")
            .setRequired(true)
        )
    )
    .addSubcommand(sc =>
      sc.setName("view")
        .setDescription("View the current DJ role")
    ),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand(true);

    if (sub === "view") {
      const s = getGuildSettings(interaction.guildId);
      if (!s.djRoleId) return interaction.reply({ embeds: [infoEmbed("ℹ️ DJ role belum di-set. Default: user dengan **Manage Server**.")], flags: 64 });
      return interaction.reply({ embeds: [infoEmbed(`🎧 DJ role saat ini: <@&${s.djRoleId}>`)], flags: 64 });
    }

    const role = interaction.options.getRole("role", true);
    setGuildSettings(interaction.guildId, { djRoleId: role.id });
    return interaction.reply({ embeds: [successEmbed(`✅ DJ role diset ke ${role}`)], flags: 64 });
  }
};

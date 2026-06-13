const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { getGuildSettings, setGuildSettings } = require("../utils/storage");
const { buildPanelEmbed, buildPanelComponents, updatePanel } = require("../music/panel");
const { getPlayer } = require("../utils/player");
const { isAdmin } = require("../utils/permissions");
const { successEmbed, errorEmbed } = require("../utils/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Buat / update Music Panel (embed + buttons)")
    .addStringOption((opt) =>
      opt
        .setName("action")
        .setDescription("Aksi panel")
        .setRequired(true)
        .addChoices(
          { name: "create", value: "create" },
          { name: "show", value: "show" },
          { name: "remove", value: "remove" }
        )
    ),

  async execute(interaction, clientArg) {
    if (!isAdmin(interaction)) {
      return interaction.reply({ embeds: [errorEmbed("❌ Command ini khusus untuk Administrator atau Owner bot.")], flags: 64 });
    }

    const client = clientArg || interaction.client;
    const action = interaction.options.getString("action", true);
    const guildId = interaction.guildId;
    const settings = getGuildSettings(guildId);

    if (action === "remove") {
      setGuildSettings(guildId, { panelChannelId: null, panelMessageId: null });
      return interaction.reply({ embeds: [successEmbed("✅ Panel settings dihapus.")], flags: 64 });
    }

    if (action === "show") {
      await updatePanel(client, guildId);
      return interaction.reply({ embeds: [successEmbed("✅ Panel di-update (kalau sudah dibuat).")], flags: 64 });
    }

    // create
    const player = getPlayer(client, guildId);
    const embed = buildPanelEmbed(player);
    const components = buildPanelComponents(player);

    const msg = await interaction.channel.send({ embeds: [embed], components });

    setGuildSettings(guildId, { panelChannelId: interaction.channelId, panelMessageId: msg.id });

    return interaction.reply({ embeds: [successEmbed("✅ Panel dibuat di channel ini.")], flags: 64 });
  },
};

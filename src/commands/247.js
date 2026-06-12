const { SlashCommandBuilder } = require("discord.js");
const { getGuildSettings, setGuildSettings } = require("../utils/storage");
const { config } = require("../config");
const { getPlayer } = require("../utils/player");
const { isAdmin } = require("../utils/permissions");

/**
 * 24/7 mode:
 * - ON  : bot stay di voice (tidak auto-leave saat queue kosong)
 * - OFF : kembali normal (bot bisa auto-leave saat idle)
 *
 * Catatan: untuk menghindari error "No node found",
 * command ini akan membuat/reuse player hanya setelah Lavalink siap.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName("247")
    .setDescription("Toggle mode 24/7 (bot stay di voice channel)")
    .addBooleanOption((opt) =>
      opt
        .setName("enable")
        .setDescription("true = ON, false = OFF")
        .setRequired(true)
    ),

  async execute(interaction, clientArg) {
    if (!isAdmin(interaction)) {
      return interaction.reply({ content: "❌ Command ini khusus untuk Administrator atau Owner bot.", flags: 64 });
    }

    const client = clientArg || interaction.client;
    const enable = interaction.options.getBoolean("enable", true);
    const settings = getGuildSettings(interaction.guildId);

    if (!enable) {
      setGuildSettings(interaction.guildId, { stay247: false });
      return interaction.reply({
        content: "✅ Mode 24/7 **OFF**. Bot bisa keluar saat idle (kalau queue kosong).",
        flags: 64,
      });
    }

    // enable === true
    const voice = interaction.member?.voice?.channel;
    if (!voice) {
      return interaction.reply({
        content: "❌ Join voice channel dulu, lalu jalankan `/247 enable:true`.",
        flags: 64,
      });
    }

    await interaction.deferReply({ flags: 64 }).catch(() => null);

    // Reuse player jika sudah ada
    let player = getPlayer(client, interaction.guildId);
    if (!player) {
      player = await client.kazagumo.createPlayer({
        guildId: interaction.guildId,
        voiceId: voice.id,
        textId: interaction.channelId,
        volume: settings.volume ?? config.defaults.volume,
        deaf: true,
      });
    } else {
      if (player.voiceId !== voice.id) await player.setVoiceChannel(voice.id);
      player.textId = interaction.channelId;
    }

    setGuildSettings(interaction.guildId, {
      stay247: true,
      voiceChannelId: voice.id,
      textChannelId: interaction.channelId,
    });

    return interaction.editReply(
      "✅ Mode 24/7 **ON**. Bot akan stay di voice channel ini."
    );
  },
};

const { makeLogger } = require("../utils/logger");
const { config } = require("../config");
const {
  handlePanelButton,
  handleAddModal,
} = require("../music/panelInteractions");

// import helper dari help.js untuk render halaman help all
const helpCmd = require("../commands/help");
const { RateLimiter } = require("../utils/rateLimiter");
const { isAdmin } = require("../utils/permissions");

const rateLimiter = new RateLimiter();

function attachInteractionHandler(client) {
  const log = makeLogger(config.logLevel);

  client.on("interactionCreate", async (interaction) => {
    // Check rate limit first
    const { limited, retryAfterMs } = rateLimiter.check(interaction.user.id);
    if (limited && !isAdmin(interaction)) {
      const secs = Math.ceil(retryAfterMs / 1000);
      return interaction.reply({
        content: `⏳ Terlalu cepat! Tunggu **${secs} detik** lagi.`,
        flags: 64
      }).catch(() => null);
    }

    try {
      // Buttons
      if (interaction.isButton()) {
        const id = interaction.customId || "";

        // ✅ Handle /help all pagination buttons
        // format: help:all:prev:<page>  atau  help:all:next:<page>
        if (id.startsWith("help:all:")) {
          const parts = id.split(":"); // ["help","all","prev|next","<page>"]
          const dir = parts[2];
          const curPage = parseInt(parts[3] || "0", 10) || 0;

          let nextPage = curPage;
          if (dir === "prev") nextPage = Math.max(0, curPage - 1);
          if (dir === "next") nextPage = curPage + 1;

          const payload = helpCmd.renderHelpAllMessage(nextPage);

          // update message (ephemeral juga bisa)
          await interaction.update(payload).catch(() => null);
          return;
        }

        // AI Playlist buttons (aiplaylist:approve/cancel)
        if (id.startsWith("aiplaylist:")) {
          const { handleAIPlaylistButton } = require("../commands/aiplaylist");
          await handleAIPlaylistButton(interaction, client);
          return;
        }

        // Panel buttons (pinplay:)
        const handled = await handlePanelButton(interaction, client);
        if (handled) return;
      }

      // Modals
      if (interaction.isModalSubmit()) {
        const handled = await handleAddModal(interaction, client);
        if (handled) return;
      }

      // Select Menus (search results)
      if (interaction.isStringSelectMenu()) {
        if (interaction.customId === "pinplay:search_select") {
          const cache = client._searchCache?.get(`${interaction.user.id}:${interaction.guildId}`);
          if (!cache) {
            return interaction.reply({ content: "❌ Hasil pencarian sudah kadaluarsa. Coba `/search` lagi.", flags: 64 });
          }

          const pickIndex = parseInt(interaction.values[0]?.split(":")[1], 10);
          const track = cache.tracks[pickIndex];
          if (!track) {
            return interaction.reply({ content: "❌ Track tidak ditemukan.", flags: 64 });
          }

          await interaction.deferReply({ flags: 64 });

          const { getPlayer } = require("../utils/player");
          const { getGuildSettings, setGuildSettings } = require("../utils/storage");
          const { config: appConfig } = require("../config");

          const settings = getGuildSettings(interaction.guildId);
          let player = getPlayer(client, interaction.guildId);

          if (!player) {
            player = await client.kazagumo.createPlayer({
              guildId: interaction.guildId,
              voiceId: cache.voiceId,
              textId: cache.channelId,
              volume: settings.volume ?? appConfig.defaults.volume,
              deaf: true,
            });
          }

          player.queue.add(track);
          if (!player.playing && !player.paused) player.play();

          setGuildSettings(interaction.guildId, { textChannelId: cache.channelId });
          client._searchCache.delete(`${interaction.user.id}:${interaction.guildId}`);

          const { updatePanel } = require("../music/panel");
          await updatePanel(client, interaction.guildId);

          return interaction.editReply(`✅ Added **${track.title}** to queue.`);
        }
      }

      // Slash commands
      if (!interaction.isChatInputCommand()) return;

      const cmd = client.commands.get(interaction.commandName);
      if (!cmd) return;

      await cmd.execute(interaction, client);
    } catch (err) {
      // Silently ignore "Unknown interaction" — means Discord already timed out (>3s)
      if (err?.code === 10062) return;

      log.error("Interaction error:", err);
      const payload = { content: "⚠️ Something went wrong.", flags: 64 };

      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(payload).catch(() => null);
      } else {
        await interaction.reply(payload).catch(() => null);
      }
    }
  });
}

module.exports = { attachInteractionHandler };

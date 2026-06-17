/**
 * ai-set.js - [Owner] Global AI settings manager (Phase B upgrade)
 *
 * Subcommands:
 *   model <name>                                  - switch model (provider auto-set)
 *   limit <number>                                - global per-user hourly request limit
 *   whitelist <add|remove|list> [@user]           - manage allowed users for /chat
 *   userlimit <set|remove|list> [@user] [value]   - per-user override limit
 *   bonus <set|add|remove|list> [@user] [value]   - per-user bonus/penalty (can be negative)
 *   reset-limit [@user|all]                       - reset limit counter for user
 *   memory <view|set|clear|global> [@user] [...]  - manage AI memory
 *   fallback <on|off>                             - toggle provider fallback
 *   cache <stats|clear>                           - manage prompt cache
 *   view                                          - show current settings
 *
 * Prefix: .ais <subcommand> [...]
 * Settings apply GLOBALLY to all AI features (/chat, /aiplaylist, /roast).
 */

const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { config } = require("../config");
const { Colors } = require("../utils/colors");
const aiSettings = require("../utils/aiSettings");
const aiLimits = require("../utils/aiLimits");
const aiMemory = require("../utils/aiMemory");
const aiPromptCache = require("../utils/aiPromptCache");
const aiTokenUsage = require("../utils/aiTokenUsage");
const {
  getAvailableProviders,
  getDefaultProviderName,
  getDefaultModel,
  isProviderAvailable,
  PROVIDERS,
  MODELS,
  MODEL_NAMES,
} = require("../utils/ai");
const { successEmbed, errorEmbed, infoEmbed } = require("../utils/embeds");

function _ensureOwner(interaction) {
  return interaction.user.id === config.discord.ownerId;
}

/**
 * Resolve a "user" option from an interaction, supporting both Discord
 * user mentions (slash) and raw 17-20 digit IDs (prefix commands store
 * raw IDs in string options since PrefixContext doesn't resolve mentions).
 *
 * Returns the Discord User object if found via getUser(), or a synthetic
 * `{ id }` object if only a raw ID was provided, or `null` if neither.
 *
 * Used by whitelist, userlimit, bonus, reset-limit, memory subcommands.
 */
function _resolveUser(interaction) {
  let user = interaction.options.getUser("user");
  if (user) return user;
  const rawUser = interaction.options.getString("user");
  if (rawUser && /^\d{17,20}$/.test(rawUser)) {
    return { id: rawUser };
  }
  return null;
}

/**
 * Send an ephemeral reply to the owner. All /ai-set subcommand replies
 * are owner-only and ephemeral (flags:64) — keeps settings changes out
 * of public chat. Pass an embed built with successEmbed/errorEmbed/infoEmbed.
 */
async function _replyEphemeral(interaction, embed) {
  return interaction.reply({ embeds: [embed], flags: 64 });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ai-set")
    .setDescription("[Owner] Atur setting global AI (model, limit, memory, dll)")
    .addSubcommand((sc) =>
      sc
        .setName("model")
        .setDescription("Pilih model AI. Provider otomatis ter-set sesuai model.")
        .addStringOption((o) =>
          o
            .setName("name")
            .setDescription("Model")
            .setRequired(true)
            .addChoices(
              ...MODEL_NAMES.map((name) => ({ name: `${MODELS[name].label} — ${MODELS[name].description}`, value: name }))
            )
        )
    )
    .addSubcommand((sc) =>
      sc
        .setName("limit")
        .setDescription("Set global per-user hourly request limit")
        .addIntegerOption((o) =>
          o
            .setName("value")
            .setDescription("Limit (min 1)")
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(1000)
        )
    )
    .addSubcommand((sc) =>
      sc
        .setName("whitelist")
        .setDescription("Manage user whitelist untuk /chat")
        .addStringOption((o) =>
          o
            .setName("action")
            .setDescription("Aksi")
            .setRequired(true)
            .addChoices(
              { name: "add", value: "add" },
              { name: "remove", value: "remove" },
              { name: "list", value: "list" }
            )
        )
        .addUserOption((o) =>
          o.setName("user").setDescription("User (untuk add/remove)").setRequired(false)
        )
    )
    .addSubcommand((sc) =>
      sc
        .setName("userlimit")
        .setDescription("Set/remove per-user custom limit (override global)")
        .addStringOption((o) =>
          o
            .setName("action")
            .setDescription("Aksi")
            .setRequired(true)
            .addChoices(
              { name: "set", value: "set" },
              { name: "remove", value: "remove" },
              { name: "list", value: "list" }
            )
        )
        .addUserOption((o) => o.setName("user").setDescription("User").setRequired(false))
        .addIntegerOption((o) =>
          o
            .setName("value")
            .setDescription("Limit value (untuk set, min 1)")
            .setRequired(false)
            .setMinValue(1)
        )
    )
    .addSubcommand((sc) =>
      sc
        .setName("bonus")
        .setDescription("Add/remove per-user bonus/penalty (additive to global limit)")
        .addStringOption((o) =>
          o
            .setName("action")
            .setDescription("Aksi")
            .setRequired(true)
            .addChoices(
              { name: "set", value: "set" },
              { name: "add", value: "add" },
              { name: "remove", value: "remove" },
              { name: "list", value: "list" }
            )
        )
        .addUserOption((o) => o.setName("user").setDescription("User").setRequired(false))
        .addIntegerOption((o) =>
          o
            .setName("value")
            .setDescription("Bonus value (bisa negatif untuk penalty)")
            .setRequired(false)
        )
    )
    .addSubcommand((sc) =>
      sc
        .setName("reset-limit")
        .setDescription("Reset limit counter untuk user (atau semua user)")
        .addStringOption((o) =>
          o
            .setName("target")
            .setDescription("User ID atau 'all'")
            .setRequired(false)
        )
        .addUserOption((o) => o.setName("user").setDescription("User (alternatif)").setRequired(false))
    )
    .addSubcommand((sc) =>
      sc
        .setName("memory")
        .setDescription("Manage AI memory (per-user profile + global notes)")
        .addStringOption((o) =>
          o
            .setName("action")
            .setDescription("Aksi")
            .setRequired(true)
            .addChoices(
              { name: "view", value: "view" },
              { name: "set", value: "set" },
              { name: "clear", value: "clear" },
              { name: "global", value: "global" }
            )
        )
        .addUserOption((o) => o.setName("user").setDescription("User (untuk view/set/clear)").setRequired(false))
        .addStringOption((o) =>
          o
            .setName("field")
            .setDescription("Field untuk set: nickname|mood|genre|artist|interests")
            .setRequired(false)
            .addChoices(
              { name: "nickname", value: "nickname" },
              { name: "mood", value: "currentMood" },
              { name: "genre", value: "favoriteGenre" },
              { name: "artist", value: "favoriteArtist" },
              { name: "interests", value: "interests" }
            )
        )
        .addStringOption((o) => o.setName("value").setDescription("Value (untuk set, pisahkan dengan koma untuk array)").setRequired(false))
    )
    .addSubcommand((sc) =>
      sc
        .setName("fallback")
        .setDescription("Toggle auto-fallback to alternative provider on 5xx/timeout")
        .addBooleanOption((o) =>
          o.setName("enabled").setDescription("Enable fallback?").setRequired(true)
        )
    )
    .addSubcommand((sc) =>
      sc
        .setName("cache")
        .setDescription("Manage AI prompt cache (stateless commands)")
        .addStringOption((o) =>
          o
            .setName("action")
            .setDescription("Aksi")
            .setRequired(true)
            .addChoices(
              { name: "stats", value: "stats" },
              { name: "clear", value: "clear" }
            )
        )
    )
    .addSubcommand((sc) =>
      sc
        .setName("limits")
        .setDescription("Lihat status limit semua user yang lagi aktif (window 1 jam)")
    )
    .addSubcommand((sc) =>
      sc
        .setName("tokens")
        .setDescription("Lihat/atur token usage tracking & cost")
        .addStringOption((o) =>
          o
            .setName("action")
            .setDescription("Aksi")
            .setRequired(true)
            .addChoices(
              { name: "stats", value: "stats" },
              { name: "reset", value: "reset" },
              { name: "cost", value: "cost" },
              { name: "costlist", value: "costlist" }
            )
        )
        .addStringOption((o) =>
          o.setName("modelkey").setDescription("Nama model (untuk cost)").setRequired(false)
        )
        .addNumberOption((o) =>
          o.setName("value").setDescription("USD per 1M tokens (untuk cost)").setRequired(false)
        )
    )
    .addSubcommand((sc) =>
      sc.setName("view").setDescription("Lihat setting saat ini")
    ),

  async execute(interaction) {
    if (!_ensureOwner(interaction)) {
      return _replyEphemeral(interaction, errorEmbed("⛔ Khusus owner bot."));
    }

    const sub = interaction.options.getSubcommand(true);

    // === model ===
    if (sub === "model") {
      const name = interaction.options.getString("name", true);
      if (!MODELS[name]) {
        return _replyEphemeral(
          interaction,
          errorEmbed(`❌ Model "${name}" tidak dikenal. Pilih salah satu: ${MODEL_NAMES.join(", ")}`)
        );
      }
      const modelDef = MODELS[name];
      if (!isProviderAvailable(modelDef.provider)) {
        const keyName = modelDef.provider === "nvidia" ? "NVIDIA_API_KEY" : "TOKENROUTER_API_KEY";
        return _replyEphemeral(
          interaction,
          errorEmbed(
            `❌ Model "${name}" butuh provider **${modelDef.provider}** tapi \`${keyName}\` belum di-set di .env.`
          )
        );
      }
      aiSettings.setProvider(modelDef.provider);
      aiSettings.setModel(name);
      return _replyEphemeral(
        interaction,
        successEmbed(
          `✅ Model diset ke **${modelDef.label}** (provider: **${modelDef.provider}**)\n` +
            `📝 ${modelDef.description}`
        )
      );
    }

    // === limit ===
    if (sub === "limit") {
      const v = interaction.options.getInteger("value", true);
      aiSettings.setUserHourlyLimit(v);
      return _replyEphemeral(interaction, successEmbed(`✅ Limit per-user/hour diset ke **${v}**`));
    }

    // === whitelist ===
    if (sub === "whitelist") {
      const action = interaction.options.getString("action", true);
      const user = _resolveUser(interaction);
      if (action === "list") {
        const s = aiSettings.getAISettings();
        const list = Array.isArray(s.whitelist) ? s.whitelist : [];
        const pretty = list.length
          ? list.map((id) => `<@${id}>`).join("\n")
          : "Kosong.";
        return _replyEphemeral(interaction, infoEmbed(`👥 **Chat Whitelist:**\n${pretty}`));
      }
      if (!user) {
        return _replyEphemeral(interaction, errorEmbed("❌ Pilih user dulu (untuk add/remove)."));
      }
      if (action === "add") {
        aiSettings.addToWhitelist(user.id);
        return _replyEphemeral(interaction, successEmbed(`✅ Ditambahkan ke whitelist: ${user}`));
      }
      if (action === "remove") {
        aiSettings.removeFromWhitelist(user.id);
        return _replyEphemeral(interaction, successEmbed(`✅ Dihapus dari whitelist: ${user}`));
      }
    }

    // === userlimit ===
    if (sub === "userlimit") {
      const action = interaction.options.getString("action", true);
      const user = _resolveUser(interaction);
      const value = interaction.options.getInteger("value");
      if (action === "list") {
        const list = aiLimits.listLimitOverrides();
        if (!list.length) {
          return _replyEphemeral(interaction, infoEmbed("📊 Belum ada user limit/bonus yang di-set."));
        }
        const lines = list
          .map((o) => {
            const bits = [];
            if (o.limit) bits.push(`limit:${o.limit}`);
            if (o.bonus) bits.push(`bonus:${o.bonus > 0 ? "+" : ""}${o.bonus}`);
            return `• <@${o.userId}> → effective **${o.effective}**/jam (${bits.join(", ") || "base"})`;
          })
          .join("\n");
        return _replyEphemeral(interaction, infoEmbed(`📊 **Per-user limits:**\n${lines}`));
      }
      if (!user) return _replyEphemeral(interaction, errorEmbed("❌ Pilih user dulu."));
      if (action === "remove") {
        aiSettings.removeUserLimit(user.id);
        return _replyEphemeral(interaction, successEmbed(`✅ User limit untuk ${user} dihapus.`));
      }
      // set
      if (!value || value < 1) return _replyEphemeral(interaction, errorEmbed("❌ Value harus angka ≥ 1."));
      aiSettings.setUserLimit(user.id, value);
      return _replyEphemeral(
        interaction,
        successEmbed(`✅ ${user} sekarang punya limit **${value}**/jam (override global).`)
      );
    }

    // === bonus ===
    if (sub === "bonus") {
      const action = interaction.options.getString("action", true);
      const user = _resolveUser(interaction);
      const value = interaction.options.getInteger("value");
      if (action === "list") {
        const list = aiLimits.listLimitOverrides().filter((o) => o.bonus !== 0);
        if (!list.length) {
          return _replyEphemeral(interaction, infoEmbed("📊 Belum ada bonus/penalty."));
        }
        const lines = list
          .map((o) => `• <@${o.userId}> → bonus **${o.bonus > 0 ? "+" : ""}${o.bonus}** (effective: ${o.effective}/jam)`)
          .join("\n");
        return _replyEphemeral(interaction, infoEmbed(`📊 **Bonus/Penalty:**\n${lines}`));
      }
      if (!user) return _replyEphemeral(interaction, errorEmbed("❌ Pilih user dulu."));
      if (value === null || value === undefined) {
        return _replyEphemeral(interaction, errorEmbed("❌ Value harus angka (boleh negatif)."));
      }
      if (action === "remove") {
        aiSettings.removeUserBonus(user.id);
        return _replyEphemeral(interaction, successEmbed(`✅ Bonus untuk ${user} dihapus.`));
      }
      if (action === "set") {
        aiSettings.setUserBonus(user.id, value);
      } else if (action === "add") {
        const s = aiSettings.getAISettings();
        const current = s.userBonuses?.[user.id] || 0;
        aiSettings.setUserBonus(user.id, current + value);
      }
      const newS = aiSettings.getAISettings();
      const finalBonus = newS.userBonuses?.[user.id] || 0;
      const effective = aiLimits.getEffectiveLimit(user.id);
      return _replyEphemeral(
        interaction,
        successEmbed(
          `✅ Bonus ${user} = **${finalBonus > 0 ? "+" : ""}${finalBonus}** (effective limit: **${effective}**/jam)`
        )
      );
    }

    // === reset-limit ===
    if (sub === "reset-limit") {
      const target = interaction.options.getString("target");
      // getUser() returns null for raw IDs (only works on mention format);
      // _resolveUser() also accepts a raw 17-20 digit ID via getString('user').
      const user = _resolveUser(interaction);

      // Determine action: "all" > specific user > ambiguous (error)
      if (target === "all") {
        const n = aiLimits.resetAll();
        return _replyEphemeral(
          interaction,
          successEmbed(`✅ Semua limit counter di-reset (**${n}** user) dari window aktif.`)
        );
      }
      if (user?.id) {
        const had = aiLimits.resetForUser(user.id);
        return _replyEphemeral(
          interaction,
          successEmbed(
            had
              ? `✅ Limit counter untuk <@${user.id}> di-reset.`
              : `ℹ️ <@${user.id}> gak ada di window aktif (gak perlu reset).`
          )
        );
      }
      if (target && /^\d{17,20}$/.test(target)) {
        // target option used as raw user ID
        const had = aiLimits.resetForUser(target);
        return _replyEphemeral(
          interaction,
          successEmbed(
            had
              ? `✅ Limit counter untuk <@${target}> di-reset.`
              : `ℹ️ <@${target}> gak ada di window aktif (gak perlu reset).`
          )
        );
      }
      // No valid input
      return _replyEphemeral(
        interaction,
        errorEmbed(
          "❌ Specify user atau `all`.\n" +
            "**Slash:** `/ai-set reset-limit target:all` atau `/ai-set reset-limit user:@user`\n" +
            "**Prefix:** `.ais reset-limit all` atau `.ais reset-limit @user`"
        )
      );
    }

    // === memory ===
    if (sub === "memory") {
      const action = interaction.options.getString("action", true);
      const user = _resolveUser(interaction);
      const field = interaction.options.getString("field");
      const value = interaction.options.getString("value");

      if (action === "global") {
        if (!value) {
          const g = aiMemory.getGlobalMemory();
          const txt =
            `**Vibe:** ${g.serverVibe || "_(kosong)_"}\n` +
            `**Common genres:** ${g.commonGenres?.length ? g.commonGenres.join(", ") : "_(kosong)_"}\n` +
            `**Owner notes:** ${g.ownerNotes || "_(kosong)_"}`;
          return _replyEphemeral(interaction, infoEmbed(`🌍 **Global memory:**\n${txt}`));
        }
        // Store raw value into ownerNotes for now (simple, owner can edit later via direct file)
        aiMemory.setGlobalNotes(value);
        return _replyEphemeral(
          interaction,
          successEmbed(`✅ Global notes diset: ${value.slice(0, 200)}`)
        );
      }

      if (action === "clear") {
        if (!user) return _replyEphemeral(interaction, errorEmbed("❌ Pilih user dulu."));
        aiMemory.clearUserMemory(user.id);
        return _replyEphemeral(interaction, successEmbed(`✅ Memory ${user} di-reset.`));
      }

      if (action === "view") {
        if (!user) {
          // List all
          const all = aiMemory.listUserMemories();
          if (!all.length) return _replyEphemeral(interaction, infoEmbed("📭 Belum ada user memory."));
          const lines = all
            .slice(0, 20)
            .map(({ userId, profile }) => {
              const tag = profile.nickname ? ` (${profile.nickname})` : "";
              const facts = profile.facts?.length || 0;
              return `• <@${userId}>${tag} — ${facts} fact(s)`;
            })
            .join("\n");
          return _replyEphemeral(interaction, infoEmbed(`🧠 **User memories (${all.length}):**\n${lines}`));
        }
        const mem = aiMemory.getUserMemory(user.id);
        const hasContent =
          mem.nickname || mem.currentMood || mem.favoriteGenre?.length ||
          mem.favoriteArtist?.length || mem.interests?.length || mem.facts?.length;
        if (!hasContent) {
          return _replyEphemeral(interaction, infoEmbed(`📭 ${user} belum punya memory.`));
        }
        const lines = [
          mem.nickname && `**Nickname:** ${mem.nickname}`,
          mem.currentMood && `**Mood:** ${mem.currentMood}`,
          mem.favoriteGenre?.length && `**Genre:** ${mem.favoriteGenre.join(", ")}`,
          mem.favoriteArtist?.length && `**Artist:** ${mem.favoriteArtist.join(", ")}`,
          mem.interests?.length && `**Interests:** ${mem.interests.join(", ")}`,
          mem.facts?.length && `**Facts (${mem.facts.length}):**\n${mem.facts.slice(-10).map((f) => `  - ${f}`).join("\n")}`,
          mem.lastSeen && `**Last seen:** ${mem.lastSeen}`,
        ].filter(Boolean).join("\n");
        return _replyEphemeral(interaction, infoEmbed(`🧠 **${user}**\n${lines}`));
      }

      // action === "set"
      if (!user) return _replyEphemeral(interaction, errorEmbed("❌ Pilih user dulu."));
      if (!field || !value) {
        return _replyEphemeral(
          interaction,
          errorEmbed("❌ Field dan value wajib di-isi. Pisahkan array dengan koma.")
        );
      }
      const arr = ["favoriteGenre", "favoriteArtist", "interests"];
      const finalValue = arr.includes(field)
        ? value.split(",").map((s) => s.trim()).filter(Boolean)
        : value;
      try {
        aiMemory.setUserField(user.id, field, finalValue);
        return _replyEphemeral(
          interaction,
          successEmbed(
            `✅ ${user} → **${field}** diset ke: \`${Array.isArray(finalValue) ? finalValue.join(", ") : finalValue}\``
          )
        );
      } catch (e) {
        return _replyEphemeral(interaction, errorEmbed(`❌ ${e.message}`));
      }
    }

    // === fallback ===
    if (sub === "fallback") {
      const enabled = interaction.options.getBoolean("enabled", true);
      aiSettings.setFallbackEnabled(enabled);
      return _replyEphemeral(
        interaction,
        successEmbed(`✅ Auto-fallback ke provider alternatif: **${enabled ? "ON" : "OFF"}**`)
      );
    }

    // === cache ===
    if (sub === "cache") {
      const action = interaction.options.getString("action", true);
      if (action === "stats") {
        const s = aiPromptCache.stats();
        return _replyEphemeral(
          interaction,
          infoEmbed(
            `🗄️ **Prompt Cache:**\n` +
              `• Users cached: **${s.totalUsers}**\n` +
              `• Total entries: **${s.totalEntries}**\n` +
              `• Max per user: **${s.maxPerUser}**\n` +
              `• TTL: **${Math.round(s.ttlMs / 60000)} min**`
          )
        );
      }
      if (action === "clear") {
        aiPromptCache.clear();
        return _replyEphemeral(interaction, successEmbed("✅ Prompt cache di-clear."));
      }
    }

    // === limits (Phase D) ===
    if (sub === "limits") {
      const all = aiLimits.listAllLimits();
      if (all.length === 0) {
        return _replyEphemeral(
          interaction,
          infoEmbed("📊 Belum ada user yang pakai AI dalam window 1 jam terakhir.")
        );
      }
      const statusEmoji = {
        "limit-exceeded": "🚫",
        "near-limit": "⚠️",
        ok: "✅",
      };
      const lines = all.slice(0, 25).map((u) => {
        const e = statusEmoji[u.status] || "•";
        const resetTxt = u.minutesLeft > 0 ? `reset in **${u.minutesLeft}m**` : "resetting...";
        return `${e} <@${u.userId}> — **${u.count}/${u.limit}** (${resetTxt})`;
      });
      const exceededCount = all.filter((u) => u.status === "limit-exceeded").length;
      const nearCount = all.filter((u) => u.status === "near-limit").length;
      const embed = new EmbedBuilder()
        .setColor(Colors.AI)
        .setTitle("📊 AI Limit Monitor")
        .setDescription(lines.join("\n"))
        .addFields({
          name: "📈 Ringkasan",
          value:
            `• Total user aktif: **${all.length}**\n` +
            `• 🚫 Limit exceeded: **${exceededCount}**\n` +
            `• ⚠️ Near limit (≥80%): **${nearCount}**\n` +
            `• Owner: bypass (unlimited)`,
          inline: false,
        })
        .setFooter({ text: "Window: 1 jam rolling. Pakai /ai-set reset-limit @user untuk clear counter." });
      return _replyEphemeral(interaction, embed);
    }

    // === tokens ===
    if (sub === "tokens") {
      const action = interaction.options.getString("action", true);
      const modelKey = interaction.options.getString("modelkey");
      const value = interaction.options.getNumber("value");

      if (action === "reset") {
        const before = aiTokenUsage.getStats();
        const callsBefore = before.totals.calls;
        aiTokenUsage.resetStats();
        return _replyEphemeral(
          interaction,
          successEmbed(
            `✅ Token usage di-reset.\n${callsBefore} call(s) sebelumnya di-clear. \`startedAt\` dipertahankan.`
          )
        );
      }

      if (action === "cost") {
        if (!modelKey || value === null || value === undefined) {
          return _replyEphemeral(
            interaction,
            errorEmbed(
              "❌ Specify model + value.\n" +
                "**Slash:** `/ai-set tokens cost modelkey:MiniMax-M3 value:0.15`\n" +
                "**Prefix:** `.ais tokens cost MiniMax-M3 0.15`"
            )
          );
        }
        try {
          aiSettings.setCostPerMillion(modelKey, value);
          return _replyEphemeral(
            interaction,
            successEmbed(`✅ Cost diset: \`${modelKey}\` = **$${value}/1M tokens**`)
          );
        } catch (e) {
          return _replyEphemeral(interaction, errorEmbed(`❌ ${e.message}`));
        }
      }

      if (action === "costlist") {
        const costs = aiSettings.listCostPerMillion();
        const keys = Object.keys(costs);
        if (!keys.length) {
          return _replyEphemeral(
            interaction,
            infoEmbed("📊 Belum ada cost rate yang diset. Semua model = $0 (free).")
          );
        }
        const lines = keys
          .sort()
          .map((k) => `• \`${k}\` = **$${costs[k]}/1M tokens**`)
          .join("\n");
        return _replyEphemeral(interaction, infoEmbed(`💰 **Cost rates:**\n${lines}`));
      }

      // action === "stats"
      const stats = aiTokenUsage.getStats();
      const providers = aiTokenUsage.getProviderBreakdown();
      const sources = aiTokenUsage.getSourceBreakdown();
      const models = aiTokenUsage.getModelBreakdown();
      const estCost = aiTokenUsage.getEstimatedCost();

      if (stats.totals.calls === 0) {
        return _replyEphemeral(
          interaction,
          infoEmbed("📊 Belum ada token usage yang tercatat. Jalankan /chat, /roast, atau /aiplaylist dulu.")
        );
      }

      // Build provider lines
      const providerLines = providers
        .filter((p) => p.calls > 0)
        .map((p) => {
          const avg = p.totalTokens > 0 ? Math.round(p.totalTokens / p.calls) : 0;
          return `• \`${p.provider}\`: **${p.totalTokens.toLocaleString()}** tokens, **${p.calls}** call(s) (avg ${avg}/call)`;
        })
        .join("\n") || "_(none)_";

      // Build source lines (top 5)
      const sourceLines = sources
        .filter((s) => s.calls > 0)
        .slice(0, 5)
        .map((s) => `• \`${s.source}\`: **${s.totalTokens.toLocaleString()}** tokens, **${s.calls}** call(s)`)
        .join("\n") || "_(none)_";

      // Build model lines (top 5)
      const modelLines = models
        .slice(0, 5)
        .map((m) => `• \`${m.model}\`: **${m.totalTokens.toLocaleString()}** tokens, **${m.calls}** call(s)`)
        .join("\n") || "_(none)_";

      const embed = new EmbedBuilder()
        .setColor(Colors.AI)
        .setTitle("📊 Token Usage (All-time)")
        .addFields(
          {
            name: "🌐 Global Totals",
            value:
              `• Total tokens: **${stats.totals.totalTokens.toLocaleString()}**\n` +
              `• Prompt: **${stats.totals.promptTokens.toLocaleString()}** • Completion: **${stats.totals.completionTokens.toLocaleString()}**\n` +
              `• API calls: **${stats.totals.calls}**\n` +
              `• Est. cost: **$${estCost.toFixed(2)}**`,
            inline: false,
          },
          {
            name: "🛠️ Per-Provider",
            value: providerLines,
            inline: false,
          },
          {
            name: "📦 Per-Source (top 5)",
            value: sourceLines,
            inline: false,
          },
          {
            name: "🤖 Per-Model (top 5)",
            value: modelLines,
            inline: false,
          }
        )
        .setFooter({
          text: `Started: ${stats.startedAt?.slice(0, 19) || "?"} • Last: ${stats.lastUpdated?.slice(0, 19) || "?"} • Cache hits = 0 tokens (no API call)`,
        });
      return _replyEphemeral(interaction, embed);
    }

    // === view ===
    const s = aiSettings.getAISettings();
    const avail = getAvailableProviders();
    const provider = getDefaultProviderName();
    const model = getDefaultModel(provider);
    const whitelist = Array.isArray(s.whitelist) ? s.whitelist : [];
    const overrides = aiLimits.listLimitOverrides();
    const memEnabled = s.memoryEnabled !== false;
    const fallbackEnabled = s.fallbackEnabled !== false;
    const cacheStats = aiPromptCache.stats();
    const tokenStats = aiTokenUsage.getStats();
    const estCost = aiTokenUsage.getEstimatedCost();

    // Build per-model availability: show which models are usable
    const modelLines = MODEL_NAMES.map((name) => {
      const def = MODELS[name];
      const provOk = isProviderAvailable(def.provider);
      const isCurrent = name === model;
      return `${isCurrent ? "✅" : "▫️"} \`${name}\` (${def.provider}) ${provOk ? "" : "❌ API key missing"}`;
    });

    const overrideLines = overrides.length
      ? overrides.slice(0, 8).map((o) => `• <@${o.userId}> → **${o.effective}**/jam`).join("\n")
      : "_(tidak ada)_";

    // Token usage summary
    const tokenLine = tokenStats.totals.calls === 0
      ? "📊 Belum ada call. Jalankan /chat, /roast, /aiplaylist."
      : `📊 **${tokenStats.totals.totalTokens.toLocaleString()}** tokens • **${tokenStats.totals.calls}** call(s) • Est. **$${estCost.toFixed(2)}**\n_Lihat detail: /ai-set tokens stats_`;

    const embed = new EmbedBuilder()
      .setColor(Colors.AI)
      .setTitle("⚙️ AI Settings (Global)")
      .addFields(
        {
          name: "🧠 Model aktif",
          value: `\`${model || "(tidak di-set)"}\` • provider: \`${provider}\``,
          inline: false,
        },
        {
          name: "📚 Model tersedia",
          value: modelLines.join("\n"),
          inline: false,
        },
        {
          name: "⏱️ Hourly limit/user",
          value: `Base: \`${s.userHourlyLimit}\` • Overrides: ${overrideLines}`,
          inline: false,
        },
        {
          name: `👥 Whitelist (${whitelist.length})`,
          value: whitelist.length
            ? whitelist.map((id) => `<@${id}>`).join(" ")
            : "_(kosong — hanya owner yang bisa pakai /chat)_",
          inline: false,
        },
        {
          name: "🔧 Toggles",
          value:
            `• Fallback: **${fallbackEnabled ? "ON" : "OFF"}**\n` +
            `• Memory: **${memEnabled ? "ON" : "OFF"}**\n` +
            `• Cache: **${cacheStats.totalEntries}** entries (${cacheStats.totalUsers} users)`,
          inline: false,
        },
        {
          name: "💰 Token Usage (all-time)",
          value: tokenLine,
          inline: false,
        }
      )
      .setFooter({
        text: `Model berlaku untuk /chat, /aiplaylist, /roast • Setting di data/aiSettings.json`,
      });

    return _replyEphemeral(interaction, embed);
  },
};

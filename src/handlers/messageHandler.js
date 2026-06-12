/**
 * messageHandler.js - Handler untuk prefix commands (e.g., .p, .s, .q)
 *
 * Membaca messageCreate events, mendeteksi prefix, parsing argument,
 * dan mengeksekusi command yang sesuai.
 */

const { PREFIX_ALIASES, parsePrefixArgs } = require("../config/prefixAliases");
const { PrefixContext } = require("../adapters/PrefixContext");
const { PrefixOptions } = require("../adapters/PrefixOptions");
const { RateLimiter } = require("../utils/rateLimiter");
const { isAdmin } = require("../utils/permissions");
const { config } = require("../config");
const { makeLogger } = require("../utils/logger");

const log = makeLogger(config.logLevel);

// Reuse rate limiter dari interaction handler
const rateLimiter = new RateLimiter();

/**
 * Attach message handler ke client
 */
function attachMessageHandler(client) {
  client.on("messageCreate", async (message) => {
    // === Guard clauses ===
    if (message.author.bot) return; // Ignore bot messages
    if (!message.guild) return; // Ignore DMs
    if (!message.content.startsWith(config.prefix)) return; // No prefix

    // === Parse alias ===
    const withoutPrefix = message.content.slice(config.prefix.length).trim();
    const [alias, ...restTokens] = withoutPrefix.split(/\s+/);
    const aliasLower = alias.toLowerCase();

    const mapping = PREFIX_ALIASES[aliasLower];
    if (!mapping) return; // Unknown alias, silently ignore

    // === Lookup command ===
    const cmd = client.commands.get(mapping.command);
    if (!cmd) return; // Command not found

    // === Rate limit check ===
    const { limited, retryAfterMs } = rateLimiter.check(message.author.id);
    const pseudoCtx = {
      user: message.author,
      memberPermissions: message.member?.permissions,
    };

    if (limited && !isAdmin(pseudoCtx)) {
      const secs = Math.ceil(retryAfterMs / 1000);
      return message
        .reply(`⏳ Terlalu cepat! Tunggu **${secs} detik** lagi.`)
        .catch(() => null);
    }

    // === Parse arguments ===
    const restText = restTokens.join(" ");
    let options;
    try {
      options = parsePrefixArgs(restText, mapping);
    } catch (err) {
      return message.reply(`❌ ${err.message}`).catch(() => null);
    }

    // === Build PrefixContext ===
    const ctx = new PrefixContext(message, mapping.command, options);

    // === Execute command ===
    try {
      await cmd.execute(ctx, client);
    } catch (err) {
      log.error("Prefix command error:", err);
      try {
        if (ctx.deferred || ctx.replied) {
          await ctx.followUp({ content: "⚠️ Something went wrong." }).catch(
            () => null
          );
        } else {
          await ctx
            .reply({ content: "⚠️ Something went wrong." })
            .catch(() => null);
        }
      } catch {
        // Ignore any error in error handling
      }
    }
  });

  log.info("✅ Message handler attached");
}

module.exports = { attachMessageHandler };

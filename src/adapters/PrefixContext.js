/**
 * PrefixContext - Adapter class yang membungkus Message
 * dan menyediakan API yang identik dengan ChatInputCommandInteraction
 *
 * Dengan class ini, semua 25 command file yang sudah ada
 * TIDAK PERLU DIUBAH sama sekali.
 */

const { PrefixOptions } = require("./PrefixOptions");

class PrefixContext {
  constructor(message, commandName, options) {
    // === Core identity ===
    this.commandName = commandName;
    this.options = options || new PrefixOptions();

    // === From Message (menggunakan real GuildMember) ===
    this.user = message.author;
    this.member = message.member;
    this.guildId = message.guildId;
    this.channelId = message.channelId;
    this.channel = message.channel;
    this.client = message.client;

    // GuildMember permissions ( sama seperti interaction.memberPermissions )
    this.memberPermissions = message.member?.permissions || null;

    // === Internal state tracking ===
    this._message = message;
    this._deferred = false;
    this._replied = false;
    this._deferredMessage = null;
  }

  // Read-only getters untuk state
  get deferred() {
    return this._deferred;
  }

  get replied() {
    return this._replied;
  }

  /**
   * reply(payload) - Send reply to channel
   * Payload bisa string atau object { content, embeds, flags }
   * Note: flags (ephemeral) diabaikan untuk prefix commands
   */
  async reply(payload) {
    if (typeof payload === "string") {
      payload = { content: payload };
    }

    // Strip flags (prefix commands tidak bisa ephemeral)
    const { flags, ...rest } = payload;
    const sent = await this._message.reply(rest).catch(() => null);

    this._replied = true;
    this._deferred = false; // If we reply, we're no longer deferred
    return sent;
  }

  /**
   * deferReply(options) - Send a placeholder message that can be edited later
   * Used for commands that take time (play, search, lyrics, etc.)
   */
  async deferReply(options = {}) {
    // Send placeholder message
    const placeholder = await this._message
      .reply({ content: "_Searching..._" })
      .catch(() => null);

    this._deferred = true;
    this._deferredMessage = placeholder;
    return placeholder;
  }

  /**
   * editReply(payload) - Edit the deferred message
   * Can also use as fallback if no deferred message exists
   */
  async editReply(payload) {
    if (typeof payload === "string") {
      payload = { content: payload };
    }

    // Strip flags
    const { flags, ...rest } = payload;

    // Saat edit pesan placeholder "Searching..." dengan embeds/components
    // tapi tanpa content, Discord TIDAK menghapus teks lama. Paksa content
    // kosong biar placeholder kehapus (kecuali command memang set content).
    if (rest.content === undefined && (rest.embeds || rest.components)) {
      rest.content = "";
    }

    if (this._deferredMessage) {
      // Edit the deferred message. JANGAN null-kan reference-nya —
      // command bisa panggil editReply berkali-kali (progress → hasil),
      // dan semuanya harus edit pesan yang SAMA (seperti interaction asli).
      const edited = await this._deferredMessage.edit(rest).catch(() => null);
      this._deferred = false;
      this._replied = true;
      return edited;
    }

    // Fallback: if no deferred message, just send new reply
    const sent = await this._message.reply(rest).catch(() => null);
    this._replied = true;
    return sent;
  }

  /**
   * followUp(payload) - Send a follow-up message
   * Used for error handling after deferredReply
   */
  async followUp(payload) {
    if (typeof payload === "string") {
      payload = { content: payload };
    }

    // Strip flags
    const { flags, ...rest } = payload;
    return this._message.channel.send(rest).catch(() => null);
  }

  /**
   * deleteReply() - Hapus pesan placeholder/deferred
   * Dipakai command yang kirim hasil di chat baru (followUp)
   * lalu mau hapus status "Roast..." biar ga numpuk.
   */
  async deleteReply() {
    if (this._deferredMessage) {
      await this._deferredMessage.delete().catch(() => null);
      this._deferredMessage = null;
    }
    return null;
  }

  /**
   * toString() - String representation for debugging
   */
  toString() {
    return `PrefixContext(command=${this.commandName}, user=${this.user?.tag}, guild=${this.guildId})`;
  }
}

module.exports = { PrefixContext };

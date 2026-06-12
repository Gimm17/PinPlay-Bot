/**
 * PrefixOptions - Simulasi interaction.options untuk prefix commands
 *
 * Dari message ".p never gonna give you up" → parse jadi:
 * { query: "never gonna give you up" }
 *
 * Dari message ".v 60" → parse jadi:
 * { value: 60 }
 */
class PrefixOptions {
  constructor(store = {}) {
    this._store = store;
    this._subcommand = store._subcommand || null;
  }

  /**
   * getString(name, required = false)
   * Returns string value or null if not found
   */
  getString(name, required = false) {
    const val = this._store[name];
    if (required && (val === undefined || val === null)) {
      throw new Error(`Missing required option: ${name}`);
    }
    return val ?? null;
  }

  /**
   * getInteger(name, required = false)
   * Parse integer from stored value
   */
  getInteger(name, required = false) {
    const val = this._store[name];
    if (required && (val === undefined || val === null)) {
      throw new Error(`Missing required option: ${name}`);
    }
    if (val === undefined || val === null) return null;
    const parsed = parseInt(val, 10);
    return isNaN(parsed) ? null : parsed;
  }

  /**
   * getBoolean(name, required = false)
   * Parse boolean from "on/off/true/false/yes/no"
   */
  getBoolean(name, required = false) {
    const val = this._store[name];
    if (required && (val === undefined || val === null)) {
      throw new Error(`Missing required option: ${name}`);
    }
    if (val === undefined || val === null) return null;
    if (typeof val === "boolean") return val;
    const s = String(val).toLowerCase();
    if (s === "true" || s === "yes" || s === "on" || s === "1") return true;
    if (s === "false" || s === "no" || s === "off" || s === "0") return false;
    return null;
  }

  /**
   * getSubcommand(required = false)
   * Return subcommand name (for commands like panel, djrole, access)
   */
  getSubcommand(required = false) {
    if (required && !this._subcommand) {
      throw new Error("Missing required subcommand");
    }
    return this._subcommand;
  }

  /**
   * getUser(name)
   * Parse user mention <@123456> and return { id, toString() }
   */
  getUser(name) {
    const val = this._store[name];
    if (!val) return null;
    const match = String(val).match(/^<@!?(\d+)>$/);
    if (!match) return null;
    return { id: match[1], toString: () => val };
  }

  /**
   * getRole(name)
   * Parse role mention <@&123456> and return { id, toString() }
   */
  getRole(name) {
    const val = this._store[name];
    if (!val) return null;
    const match = String(val).match(/^<@&(\d+)>$/);
    if (!match) return null;
    return { id: match[1], toString: () => val };
  }

  /**
   * getChannel(name)
   * Parse channel mention <#123456> and return { id, toString() }
   */
  getChannel(name) {
    const val = this._store[name];
    if (!val) return null;
    const match = String(val).match(/^<#(\d+)>$/);
    if (!match) return null;
    return { id: match[1], toString: () => val };
  }
}

module.exports = { PrefixOptions };

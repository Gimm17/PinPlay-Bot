/**
 * Prefix Aliases - Mapping prefix command aliases ke slash commands
 *
 * Format:
 *   alias: {
 *     command: "command_name",
 *     parse: "parse_type",
 *     option: "option_name",      // untuk single-option commands
 *     options: ["opt1", "opt2"],  // untuk multi-option commands
 *     choices: [...],             // untuk choice-based commands
 *     required: true/false        // apakah argumen wajib
 *   }
 */

const { PrefixOptions } = require("../adapters/PrefixOptions");

// === CATEGORY A: No arguments (17 commands) ===
const NO_ARGS_ALIASES = {
  // skip
  s: { command: "skip", parse: "none" },
  st: { command: "stop", parse: "none" },

  // pause/resume
  pause: { command: "pause", parse: "none" },
  re: { command: "resume", parse: "none" },

  // shuffle/clear
  sh: { command: "shuffle", parse: "none" },
  cl: { command: "clear", parse: "none" },

  // nowplaying/history
  np: { command: "nowplaying", parse: "none" },
  hist: { command: "history", parse: "none" },

  // leave
  l: { command: "leave", parse: "none" },

  // roast (AI)
  roast: { command: "roast", parse: "none" },

  // limit (Phase D) - cek status limit AI
  limit: { command: "ai-limit", parse: "none" },
};

// === CATEGORY B: Single rest-of-string argument (3 commands) ===
const REST_STRING_ALIASES = {
  play: { command: "play", parse: "rest", option: "query" },
  p: { command: "play", parse: "rest", option: "query" },
  sc: { command: "search", parse: "rest", option: "query" },
  ly: { command: "lyrics", parse: "rest", option: "query", required: false },
  ap: { command: "aiplaylist", parse: "rest", option: "query", required: false },
  "p-yt": { command: "play-yt", parse: "rest", option: "query" },
  chat: { command: "chat", parse: "rest", option: "prompt", required: true },
};

// === CATEGORY C: Single integer argument (3 commands) ===
const INT_ALIASES = {
  v: { command: "volume", parse: "int", option: "value", required: true },
  sk: { command: "seek", parse: "int", option: "seconds", required: true },
  q: { command: "queue", parse: "int", option: "page", required: false },
};

// === CATEGORY D: One or two integers (3 commands) ===
const INT_PAIR_ALIASES = {
  rm: { command: "remove", parse: "int", option: "position", required: true },
  stt: { command: "skipto", parse: "int", option: "position", required: true },
  mv: { command: "move", parse: "intPair", options: ["from", "to"] },
};

// === CATEGORY E: String with choices (2 commands) ===
const CHOICE_ALIASES = {
  lp: {
    command: "loop",
    parse: "choice",
    option: "mode",
    choices: ["none", "track", "queue"],
  },
  f: {
    command: "filter",
    parse: "choice",
    option: "name",
    choices: ["off", "bassboost", "nightcore", "vaporwave"],
  },
};

// === CATEGORY F: Boolean (1 command) ===
const BOOL_ALIASES = {
  247: { command: "247", parse: "bool", option: "enable" },
};

// === CATEGORY G: Help special parsing (1 command) ===
const HELP_ALIASES = {
  h: { command: "help", parse: "help" },
  hv2: { command: "helpv2", parse: "rest", option: "mode", required: false },
};

// === CATEGORY H: Subcommands (3 commands) ===
const SUBCOMMAND_ALIASES = {
  panel: { command: "panel", parse: "subcommand:panel" },
  dj: { command: "djrole", parse: "subcommand:djrole" },
  access: { command: "access", parse: "subcommand:access" },
  ais: { command: "ai-set", parse: "subcommand:ai-set" },
};

// === Full command names as aliases ===
// Jika user ketik ".play" atau ".skip", juga work
const FULL_COMMAND_ALIASES = {
  play: { command: "play", parse: "rest", option: "query" },
  skip: { command: "skip", parse: "none" },
  stop: { command: "stop", parse: "none" },
  queue: { command: "queue", parse: "int", option: "page", required: false },
  pause: { command: "pause", parse: "none" },
  resume: { command: "resume", parse: "none" },
  shuffle: { command: "shuffle", parse: "none" },
  clear: { command: "clear", parse: "none" },
  volume: { command: "volume", parse: "int", option: "value", required: true },
  loop: { command: "loop", parse: "choice", option: "mode", choices: ["none", "track", "queue"] },
  nowplaying: { command: "nowplaying", parse: "none" },
  seek: { command: "seek", parse: "int", option: "seconds", required: true },
  filter: { command: "filter", parse: "choice", option: "name", choices: ["off", "bassboost", "nightcore", "vaporwave"] },
  leave: { command: "leave", parse: "none" },
  search: { command: "search", parse: "rest", option: "query" },
  lyrics: { command: "lyrics", parse: "rest", option: "query", required: false },
  history: { command: "history", parse: "none" },
  remove: { command: "remove", parse: "int", option: "position", required: true },
  move: { command: "move", parse: "intPair", options: ["from", "to"] },
  skipto: { command: "skipto", parse: "int", option: "position", required: true },
  panel: { command: "panel", parse: "subcommand:panel" },
  help: { command: "help", parse: "help" },
  helpv2: { command: "helpv2", parse: "rest", option: "mode", required: false },
  "247": { command: "247", parse: "bool", option: "enable" },
  djrole: { command: "djrole", parse: "subcommand:djrole" },
  access: { command: "access", parse: "subcommand:access" },
  aiplaylist: { command: "aiplaylist", parse: "rest", option: "query", required: false },
  "play-yt": { command: "play-yt", parse: "rest", option: "query" },
  roast: { command: "roast", parse: "none" },
  chat: { command: "chat", parse: "rest", option: "prompt", required: true },
  "ai-set": { command: "ai-set", parse: "subcommand:ai-set" },
  "ai-limit": { command: "ai-limit", parse: "none" },
};

// === GABUNG SEMUA ALIASES ===
const PREFIX_ALIASES = {
  ...NO_ARGS_ALIASES,
  ...REST_STRING_ALIASES,
  ...INT_ALIASES,
  ...INT_PAIR_ALIASES,
  ...CHOICE_ALIASES,
  ...BOOL_ALIASES,
  ...HELP_ALIASES,
  ...SUBCOMMAND_ALIASES,
  ...FULL_COMMAND_ALIASES,
};

/**
 * Parse arguments dari message text berdasarkan parsing rule
 */
function parsePrefixArgs(text, mapping) {
  const args = text.trim().split(/\s+/).filter((t) => t.length > 0);

  // Category: No arguments
  if (mapping.parse === "none") {
    return new PrefixOptions({});
  }

  // Category: Rest of string (everything after alias)
  if (mapping.parse === "rest") {
    const option = mapping.option;
    if (text.trim().length === 0 && mapping.required !== false) {
      throw new Error(`Missing required option: ${option}`);
    }
    return new PrefixOptions({ [option]: text.trim() });
  }

  // Category: Single integer
  if (mapping.parse === "int") {
    const option = mapping.option;
    if (args.length === 0) {
      if (mapping.required) {
        throw new Error(`Missing required option: ${option}`);
      }
      return new PrefixOptions({ [option]: null });
    }
    const value = parseInt(args[0], 10);
    if (isNaN(value)) {
      throw new Error(`Invalid integer: ${args[0]}`);
    }
    return new PrefixOptions({ [option]: value });
  }

  // Category: Integer pair
  if (mapping.parse === "intPair") {
    if (args.length < mapping.options.length) {
      throw new Error(
        `Missing options. Usage: .${mapping.command} ${mapping.options.join(" ")}`
      );
    }
    const options = {};
    mapping.options.forEach((opt, idx) => {
      const value = parseInt(args[idx], 10);
      if (isNaN(value)) {
        throw new Error(`Invalid integer for ${opt}: ${args[idx]}`);
      }
      options[opt] = value;
    });
    return new PrefixOptions(options);
  }

  // Category: Choice
  if (mapping.parse === "choice") {
    const option = mapping.option;
    if (args.length === 0) {
      throw new Error(`Missing required option: ${option}`);
    }
    const value = args[0].toLowerCase();
    if (!mapping.choices.includes(value)) {
      throw new Error(
        `Invalid ${option}. Must be one of: ${mapping.choices.join(", ")}`
      );
    }
    return new PrefixOptions({ [option]: value });
  }

  // Category: Boolean
  if (mapping.parse === "bool") {
    const option = mapping.option;
    if (args.length === 0) {
      throw new Error(`Missing required option: ${option}`);
    }
    const value = args[0].toLowerCase();
    if (["true", "yes", "on", "1"].includes(value)) {
      return new PrefixOptions({ [option]: true });
    }
    if (["false", "no", "off", "0"].includes(value)) {
      return new PrefixOptions({ [option]: false });
    }
    throw new Error(`Invalid boolean: ${args[0]}`);
  }

  // Category: Help special parsing
  if (mapping.parse === "help") {
    const options = {};
    if (args.length > 0) {
      const first = args[0].toLowerCase();
      if (first === "all") {
        options.all = true;
      } else {
        options.command = args[0];
      }
    }
    return new PrefixOptions(options);
  }

  // Category: Subcommands
  if (mapping.parse && mapping.parse.startsWith("subcommand:")) {
    const subcommandType = mapping.parse.split(":")[1];
    if (args.length === 0) {
      throw new Error(
        `Missing subcommand. Usage: .${mapping.command} <${subcommandType}>`
      );
    }
    return parseSubcommand(subcommandType, args);
  }

  return new PrefixOptions({});
}

/**
 * Parse subcommand-based commands (panel, djrole, access)
 */
function parseSubcommand(type, args) {
  const subcommand = args[0].toLowerCase();
  const rest = args.slice(1);

  switch (type) {
    case "panel": {
      const validActions = ["create", "show", "remove"];
      if (!validActions.includes(subcommand)) {
        throw new Error(
          `Invalid action. Must be one of: ${validActions.join(", ")}`
        );
      }
      return new PrefixOptions({
        _subcommand: subcommand,
        action: subcommand,
      });
    }

    case "djrole": {
      const options = { _subcommand: subcommand };
      if (subcommand === "set") {
        if (rest.length === 0) {
          throw new Error("Missing role. Usage: .dj set @role");
        }
        options.role = rest[0];
      }
      return new PrefixOptions(options);
    }

    case "access": {
      const options = { _subcommand: subcommand };

      if (subcommand === "mode") {
        if (rest.length === 0) {
          throw new Error("Missing mode. Usage: .access mode <all|restricted>");
        }
        if (!["all", "restricted"].includes(rest[0].toLowerCase())) {
          throw new Error("Invalid mode. Must be: all, restricted");
        }
        options.mode = rest[0].toLowerCase();
      } else if (subcommand === "allowuser") {
        if (rest.length < 2) {
          throw new Error("Usage: .access allowuser <add|remove|list> [@user]");
        }
        options.action = rest[0].toLowerCase();
        options.user = rest[1];
      } else if (subcommand === "allowrole") {
        if (rest.length < 2) {
          throw new Error("Usage: .access allowrole <add|remove|list> [@role]");
        }
        options.action = rest[0].toLowerCase();
        options.role = rest[1];
      } else if (subcommand === "requestchannel") {
        if (rest.length === 0) {
          throw new Error("Usage: .access requestchannel [#channel]");
        }
        options.channel = rest[0];
      } else if (subcommand === "view") {
        // No additional args needed
      } else {
        throw new Error(
          `Invalid subcommand. Must be one of: mode, allowuser, allowrole, requestchannel, view`
        );
      }

      return new PrefixOptions(options);
    }

    case "ai-set": {
      const validSubs = ["model", "limit", "whitelist", "userlimit", "bonus", "reset-limit", "memory", "fallback", "cache", "limits", "view"];
      if (!validSubs.includes(subcommand)) {
        throw new Error(
          `Invalid sub. Must be one of: ${validSubs.join(", ")}`
        );
      }
      const options = { _subcommand: subcommand };

      if (subcommand === "model") {
        if (rest.length === 0) {
          throw new Error("Usage: .ais model <MiniMax-M3|llama-3.3-70b>");
        }
        // Accept exact match (case-insensitive) against MODEL_NAMES
        const { MODEL_NAMES } = require("../utils/ai");
        const lower = rest[0].toLowerCase();
        const match = MODEL_NAMES.find((n) => n.toLowerCase() === lower);
        if (!match) {
          throw new Error(
            `Model tidak dikenal. Pilih: ${MODEL_NAMES.join(", ")}`
          );
        }
        options.name = match;
      } else if (subcommand === "limit") {
        if (rest.length === 0) {
          throw new Error("Usage: .ais limit <number>");
        }
        const n = parseInt(rest[0], 10);
        if (isNaN(n) || n < 1) {
          throw new Error("Limit must be a positive integer");
        }
        options.value = n;
      } else if (subcommand === "whitelist") {
        if (rest.length === 0) {
          throw new Error("Usage: .ais whitelist <add|remove|list> [@user]");
        }
        options.action = rest[0].toLowerCase();
        if (rest[1]) {
          const mentionMatch = String(rest[1]).match(/^<@!?(\d+)>$/);
          const idMatch = String(rest[1]).match(/^(\d{17,20})$/);
          if (mentionMatch) {
            options.user = mentionMatch[1];
          } else if (idMatch) {
            options.user = idMatch[1];
          } else {
            throw new Error("User gak valid. Pakai @mention atau user ID.");
          }
        }
      } else if (subcommand === "userlimit") {
        if (rest.length === 0) {
          throw new Error("Usage: .ais userlimit <set|remove|list> [@user] [value]");
        }
        options.action = rest[0].toLowerCase();
        if (rest[1]) {
          // Accept <@mention> or raw ID
          const mentionMatch = String(rest[1]).match(/^<@!?(\d+)>$/);
          const idMatch = String(rest[1]).match(/^(\d{17,20})$/);
          if (mentionMatch) {
            options.user = mentionMatch[1];
          } else if (idMatch) {
            options.user = idMatch[1];
          } else {
            throw new Error("User gak valid. Pakai @mention atau user ID.");
          }
        }
        if (rest[2]) {
          const n = parseInt(rest[2], 10);
          if (isNaN(n) || n < 1) throw new Error("Value must be a positive integer");
          options.value = n;
        }
      } else if (subcommand === "bonus") {
        if (rest.length === 0) {
          throw new Error("Usage: .ais bonus <set|add|remove|list> [@user] [value]");
        }
        options.action = rest[0].toLowerCase();
        if (rest[1]) {
          const mentionMatch = String(rest[1]).match(/^<@!?(\d+)>$/);
          const idMatch = String(rest[1]).match(/^(\d{17,20})$/);
          if (mentionMatch) {
            options.user = mentionMatch[1];
          } else if (idMatch) {
            options.user = idMatch[1];
          } else {
            throw new Error("User gak valid. Pakai @mention atau user ID.");
          }
        }
        if (rest[2] !== undefined) {
          const n = parseInt(rest[2], 10);
          if (isNaN(n)) throw new Error("Value must be an integer");
          options.value = n;
        }
      } else if (subcommand === "reset-limit") {
        if (rest.length === 0) {
          throw new Error("Usage: .ais reset-limit <@user|all|userid>");
        }
        const arg = rest[0].toLowerCase();
        if (arg === "all") {
          options.target = "all";
        } else {
          // Accept <@mention>, <@!mention> (nickname), or raw 17-20 digit ID
          const mentionMatch = String(rest[0]).match(/^<@!?(\d+)>$/);
          const idMatch = String(rest[0]).match(/^(\d{17,20})$/);
          if (mentionMatch) {
            options.user = mentionMatch[1];
          } else if (idMatch) {
            options.user = idMatch[1];
          } else {
            throw new Error(
              "Argument gak valid. Pakai: .ais reset-limit <@user|all|userid>"
            );
          }
        }
      } else if (subcommand === "memory") {
        if (rest.length === 0) {
          throw new Error("Usage: .ais memory <view|set|clear|global> [@user] [field] [value]");
        }
        options.action = rest[0].toLowerCase();
        if (rest[1]) {
          const mentionMatch = String(rest[1]).match(/^<@!?(\d+)>$/);
          const idMatch = String(rest[1]).match(/^(\d{17,20})$/);
          if (mentionMatch) {
            options.user = mentionMatch[1];
          } else if (idMatch) {
            options.user = idMatch[1];
          } else {
            throw new Error("User gak valid. Pakai @mention atau user ID.");
          }
        }
        if (rest[2]) options.field = rest[2];
        if (rest.slice(3).length > 0) options.value = rest.slice(3).join(" ");
      } else if (subcommand === "fallback") {
        if (rest.length === 0) {
          throw new Error("Usage: .ais fallback <on|off>");
        }
        const v = rest[0].toLowerCase();
        if (!["on", "off", "true", "false"].includes(v)) {
          throw new Error("Value must be: on|off");
        }
        options.enabled = ["on", "true"].includes(v);
      } else if (subcommand === "cache") {
        if (rest.length === 0) {
          throw new Error("Usage: .ais cache <stats|clear>");
        }
        options.action = rest[0].toLowerCase();
      }
      // view: no extra args

      return new PrefixOptions(options);
    }

    default:
      return new PrefixOptions({ _subcommand: subcommand });
  }
}

module.exports = { PREFIX_ALIASES, parsePrefixArgs };

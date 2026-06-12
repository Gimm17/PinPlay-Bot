const { REST, Routes } = require("discord.js");
const fs = require("fs");
const path = require("path");
const { config } = require("../src/config");

const args = process.argv.slice(2);
const isGlobal = args.includes("--global");
const isGuild = args.includes("--guild");

if (!isGlobal && !isGuild) {
  console.error("Usage: node scripts/deploy-commands.js --global | --guild");
  process.exit(1);
}
if (isGuild && !config.discord.guildId) {
  console.error("Missing GUILD_ID in .env for --guild deploy.");
  process.exit(1);
}

const commandsPath = path.join(__dirname, "..", "src", "commands");
const files = fs.readdirSync(commandsPath).filter(f => f.endsWith(".js"));

const commands = files.map(f => {
  const cmd = require(path.join(commandsPath, f));
  return cmd.data.toJSON();
});

const rest = new REST({ version: "10" }).setToken(config.discord.token);

(async () => {
  try {
    console.log(`Deploying ${commands.length} commands...`);

    if (isGlobal) {
      await rest.put(
        Routes.applicationCommands(config.discord.clientId),
        { body: commands }
      );
      console.log("✅ Deployed global commands.");
    } else {
      await rest.put(
        Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
        { body: commands }
      );
      console.log("✅ Deployed guild commands.");
    }
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();

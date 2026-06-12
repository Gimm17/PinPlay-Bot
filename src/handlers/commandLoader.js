const fs = require("fs");
const path = require("path");

function loadCommands() {
  const commandsPath = path.join(__dirname, "..", "commands");
  const files = fs.readdirSync(commandsPath).filter(f => f.endsWith(".js"));

  const commands = new Map();
  for (const file of files) {
    const cmd = require(path.join(commandsPath, file));
    commands.set(cmd.data.name, cmd);
  }
  return commands;
}

module.exports = { loadCommands };

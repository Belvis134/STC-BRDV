// Run this to update Discord app's command
console.log("Updating Discord app commands...");
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const {token, discord_client_id, discord_guild_id} = require('../config.js');
const fs = require('node:fs');
const path = require('path');

const commands = [];
const commandsPath = path.join(__dirname, '../commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('_stc.json'));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  commands.push(command);
  console.log(`Loaded command from file: ${file}`);
}

const rest = new REST({ version: '9' }).setToken(token);

(async () => {
  try {
    await rest.put(
      Routes.applicationGuildCommands(discord_client_id, discord_guild_id),
      { body: commands }
    );
  } catch (error) {
    console.error(error);
  }
})();
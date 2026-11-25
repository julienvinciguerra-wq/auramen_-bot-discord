require('dotenv').config();

const { REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

/** ID applicazione: CLIENT_ID (o alias) oppure ricavato dal token bot. */
function resolveClientId(token = process.env.DISCORD_TOKEN) {
  const explicit = String(process.env.CLIENT_ID || process.env.DISCORD_CLIENT_ID || process.env.APPLICATION_ID || '').trim();
  if (explicit) return explicit;
  // Il primo segmento di un token bot è l'ID applicazione codificato in base64.
  const encoded = String(token || '').split('.')[0];
  if (!encoded) return null;
  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8').trim();
    return /^\d{15,25}$/.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

/** Server su cui registrare i comandi (registrazione immediata). Vuoto = globale. */
function resolveGuildId() {
  return String(process.env.GUILD_ID || process.env.DISCORD_GUILD_ID || '').trim();
}

function loadCommands() {
  const commands = [];
  const commandsPath = path.join(__dirname, 'commands');
  for (const file of fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'))) {
    const command = require(path.join(commandsPath, file));
    commands.push(command.data.toJSON());
  }
  return commands;
}

async function deployCommands() {
  const token = process.env.DISCORD_TOKEN;
  const clientId = resolveClientId(token);
  const guildId = resolveGuildId();

  if (!token || !clientId) {
    console.error('Configura DISCORD_TOKEN nel file .env o nei secrets del servizio (CLIENT_ID è facoltativo: se manca viene ricavato dal token).');
    process.exitCode = 1;
    return;
  }

  const commands = loadCommands();
  const rest = new REST({ version: '10' }).setToken(token);

  try {
    const route = guildId
      ? Routes.applicationGuildCommands(clientId, guildId)
      : Routes.applicationCommands(clientId);
    await rest.put(route, { body: commands });
    console.log(`Registrati ${commands.length} comandi slash ${guildId ? `nel server ${guildId}` : 'globalmente'}.`);
    if (!guildId) {
      console.log('Senza GUILD_ID la registrazione è globale: Discord può impiegare fino a un\'ora a mostrarli. Imposta GUILD_ID per vederli subito.');
    }
    console.log(`Comandi: ${commands.map(command => `/${command.name}`).join(', ')}`);
  } catch (error) {
    console.error('Registrazione comandi fallita:', error);
    if (error?.code === 50001 || error?.status === 403) {
      console.error('Il bot non ha accesso a quel server: controlla GUILD_ID e invitalo di nuovo con lo scope applications.commands.');
    }
    process.exitCode = 1;
  }
}

if (require.main === module) {
  deployCommands();
}

module.exports = { deployCommands, resolveClientId, resolveGuildId, loadCommands };

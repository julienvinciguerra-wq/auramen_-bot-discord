require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const {
  Client,
  Collection,
  GatewayIntentBits,
  Partials,
  Events
} = require('discord.js');

if (!process.env.DISCORD_TOKEN) {
  console.error('DISCORD_TOKEN mancante. Copia .env.example in .env e inserisci il token.');
  process.exit(1);
}

const { registerLogs } = require('./events/register-logs');
const { handleButton } = require('./systems/tickets');
const { handleTicketMessage } = require('./systems/ticket-assistant');
const { startProfileApi } = require('./systems/profile-api');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildPresences
  ],
  partials: [Partials.Message, Partials.Channel, Partials.User]
});

registerLogs(client);
startProfileApi(client);

// Assistente impostazioni: risponde solo nei ticket aperti registrati nel database.
client.on(Events.MessageCreate, async message => {
  try { await handleTicketMessage(message); }
  catch (error) { console.error('[Ticket assistant] Errore:', error); }
});

client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'))) {
  const command = require(path.join(commandsPath, file));
  client.commands.set(command.data.name, command);
}

client.once(Events.ClientReady, readyClient => {
  console.log(`auramen bot online come ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isButton()) {
    try { await handleButton(interaction); }
    catch (error) {
      console.error('Errore ticket button:', error);
      const payload = { content: 'Operazione ticket non riuscita.', ephemeral: true };
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
      else await interaction.reply(payload).catch(() => {});
    }
    return;
  }
  if (!interaction.isChatInputCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction, client);
  } catch (error) {
    console.error(`Errore comando /${interaction.commandName}:`, error);
    const payload = { content: 'Si è verificato un errore. Controlla i log del bot.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
});

client.login(process.env.DISCORD_TOKEN);

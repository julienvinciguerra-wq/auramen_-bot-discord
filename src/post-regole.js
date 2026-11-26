/**
 * Pubblica il regolamento come APP (webhook), senza pallino online/offline.
 *
 *   npm run regole -- --guild <ID>
 *   npm run regole -- --guild <ID> --canale regolamento
 *   npm run regole -- --guild <ID> --reset   (torna alle regole predefinite)
 *
 * Il webhook si chiama "Regolamento" e viene creato la prima volta; le
 * esecuzioni successive aggiornano lo stesso messaggio.
 */

require('dotenv').config();

const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const { publishRulesAsApp } = require('./systems/rules-webhook');
const { resetRules } = require('./commands/regole');

const USAGE = `Uso: npm run regole -- --guild <ID> [--canale <nome>] [--reset]

  --guild <ID>    Server Discord (o GUILD_ID in .env)
  --canale <nome>  Canale delle regole, default "regolamento"
  --reset          Ripristina le regole predefinite e ripubblica
  --help           Mostra questo aiuto

Scrive con un webhook chiamato "Regolamento": il messaggio appare come APP,
senza stato online/offline. Serve DISCORD_TOKEN in .env e il permesso
"Gestisci webhook" nel canale.`;

function parseArgs(argv) {
  const args = { guild: null, channel: 'regolamento', reset: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--reset') args.reset = true;
    else if (arg === '--guild') args.guild = argv[++i];
    else if (arg.startsWith('--guild=')) args.guild = arg.split('=')[1];
    else if (arg === '--canale') args.channel = argv[++i];
    else if (arg.startsWith('--canale=')) args.channel = arg.split('=')[1];
  }
  args.guild = args.guild || process.env.GUILD_ID || process.env.DISCORD_GUILD_ID || null;
  return args;
}

function plainName(name) {
  const value = String(name || '');
  const index = value.lastIndexOf('｜');
  return index === -1 ? value : value.slice(index + 1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.guild) {
    console.log(USAGE);
    if (!args.guild) process.exitCode = 1;
    return;
  }
  if (!process.env.DISCORD_TOKEN) {
    console.error('Manca DISCORD_TOKEN nel file .env.');
    process.exitCode = 1;
    return;
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  try {
    await client.login(process.env.DISCORD_TOKEN);
    const guild = await client.guilds.fetch(args.guild);
    const channels = [...(await guild.channels.fetch()).values()].filter(Boolean);
    const wanted = plainName(args.channel).toLowerCase();
    const channel = channels.find(
      item => item.type === ChannelType.GuildText && plainName(item.name).toLowerCase() === wanted
    );
    if (!channel) {
      console.error(`Canale "${args.channel}" non trovato nel server ${guild.name}.`);
      process.exitCode = 1;
      return;
    }

    if (args.reset) resetRules(guild.id);

    const result = await publishRulesAsApp(channel);
    console.log(`${result.edited ? 'Regolamento aggiornato' : 'Regolamento pubblicato'} in #${channel.name}.`);
    console.log(`Autore del messaggio: APP "${result.webhook.name}" (webhook, nessuno stato online/offline).`);
  } catch (error) {
    console.error('Pubblicazione regolamento fallita:', error.message || error);
    process.exitCode = 1;
  } finally {
    client.destroy();
  }
}

if (require.main === module) main();

module.exports = { parseArgs, plainName };

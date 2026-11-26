require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  ChannelType,
  PermissionFlagsBits
} = require('discord.js');
const { ROLES, CATEGORIES } = require('./systems/server-structure');

const STAFF_ROLES = ['Admin', 'Moderatore', 'Staff'];
const REASON = 'Struttura auramen';

const USAGE = `Uso: npm run setup-server -- --guild <ID> [--apply]

  --guild <ID>  Server Discord in cui creare la struttura (obbligatorio)
  --apply       Crea davvero ruoli e canali (senza, mostra solo l'anteprima)
  --help        Mostra questo aiuto

Per l'anteprima non serve il token; per creare la struttura serve DISCORD_TOKEN in .env.`;

function parseArgs(argv) {
  const options = { guildId: null, apply: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--apply') options.apply = true;
    else if (arg === '--guild') options.guildId = String(argv[index += 1] || '').trim();
    else if (arg.startsWith('--guild=')) options.guildId = arg.slice('--guild='.length).trim();
    else if (/^\d{15,25}$/.test(arg)) options.guildId = arg;
  }
  return options;
}

function printPlan(guildId) {
  console.log(`Struttura per il server ${guildId}\n`);
  console.log(`Ruoli (${ROLES.length}): ${ROLES.map(role => role.name).join(' · ')}`);
  for (const category of CATEGORIES) {
    console.log(`\n${category.name}${category.private ? ' [privata]' : ''}`);
    for (const channel of category.channels) {
      const notes = [];
      if (channel.type === 'voice') notes.push('vocale');
      if (channel.readOnly) notes.push('sola lettura');
      if (channel.topic) notes.push(channel.topic);
      console.log(`  - ${channel.type === 'voice' ? '🔊' : '#'}${channel.name}${notes.length ? `  (${notes.join(' · ')})` : ''}`);
    }
  }
  console.log('\nRuoli, categorie e canali con lo stesso nome vengono saltati: nessun duplicato.');
  console.log('Anteprima soltanto. Aggiungi --apply per creare davvero tutto.');
}

/** I nuovi ruoli finiscono in fondo alla gerarchia: creandoli al contrario restano nell'ordine voluto. */
async function ensureRoles(guild, report) {
  for (const def of [...ROLES].reverse()) {
    if (guild.roles.cache.find(role => role.name === def.name)) {
      report.skipped.push(`ruolo ${def.name}`);
      continue;
    }
    const payload = { name: def.name, reason: REASON };
    if (def.color) payload.colors = { primaryColor: def.color };
    if (def.mentionable) payload.mentionable = true;
    const role = await guild.roles.create(payload);
    report.created.push(`ruolo ${role.name}`);
  }
}

async function ensureCategory(guild, def, staffRoleIds, report) {
  const existing = guild.channels.cache.find(channel => channel.type === ChannelType.GuildCategory && channel.name === def.name);
  if (existing) {
    report.skipped.push(`categoria ${def.name}`);
    return existing;
  }

  const permissionOverwrites = [];
  if (def.private) {
    permissionOverwrites.push({ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] });
    for (const roleId of staffRoleIds) {
      permissionOverwrites.push({
        id: roleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory
        ]
      });
    }
  }

  const category = await guild.channels.create({
    name: def.name,
    type: ChannelType.GuildCategory,
    permissionOverwrites,
    reason: REASON
  });
  report.created.push(`categoria ${def.name}`);
  return category;
}

async function ensureChannel(guild, category, def, report) {
  const type = def.type === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText;
  const existing = guild.channels.cache.find(channel => channel.type === type && channel.name === def.name);
  if (existing) {
    report.skipped.push(`canale #${def.name}`);
    return existing;
  }

  const options = { name: def.name, type, parent: category.id, reason: REASON };
  if (type === ChannelType.GuildText && def.topic) options.topic = def.topic;
  if (type === ChannelType.GuildText && def.readOnly) {
    options.permissionOverwrites = [{
      id: guild.roles.everyone.id,
      deny: [
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.CreatePublicThreads,
        PermissionFlagsBits.SendMessagesInThreads
      ]
    }];
  }

  const channel = await guild.channels.create(options);
  report.created.push(`canale #${channel.name}`);
  return channel;
}

/** Crea la struttura mancante: è ripetibile senza duplicare nulla. */
async function applyStructure(guild) {
  const report = { created: [], skipped: [], errors: [] };
  const me = await guild.members.fetchMe();
  const required = [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles];
  if (!me.permissions.has(required)) {
    throw new Error(`Al bot mancano "Gestisci canali" e "Gestisci ruoli" in "${guild.name}": reinvitalo con quei permessi.`);
  }

  await ensureRoles(guild, report);
  const staffRoleIds = STAFF_ROLES
    .map(name => guild.roles.cache.find(role => role.name === name)?.id)
    .filter(Boolean);

  for (const def of CATEGORIES) {
    try {
      const category = await ensureCategory(guild, def, staffRoleIds, report);
      for (const channel of def.channels) {
        await ensureChannel(guild, category, channel, report);
      }
    } catch (error) {
      report.errors.push(`${def.name}: ${error.message}`);
    }
  }

  return report;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.guildId) {
    console.log(USAGE);
    if (!options.guildId) process.exitCode = 1;
    return;
  }

  if (!options.apply) {
    printPlan(options.guildId);
    return;
  }

  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    console.error('DISCORD_TOKEN mancante: inseriscilo in .env (o nei secrets del servizio) e riprova.');
    process.exitCode = 1;
    return;
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  try {
    await client.login(token);
    const guild = await client.guilds.fetch(options.guildId);
    console.log(`Server: ${guild.name} (${guild.id})`);
    const report = await applyStructure(guild);
    for (const line of report.created) console.log(`+ ${line}`);
    for (const line of report.skipped) console.log(`= ${line} (già presente)`);
    for (const line of report.errors) console.error(`! ${line}`);
    console.log(`\nCreati ${report.created.length} elementi, saltati ${report.skipped.length}, errori ${report.errors.length}.`);
    if (report.errors.length) process.exitCode = 1;
  } catch (error) {
    console.error('Creazione struttura fallita:', error.message || error);
    if (String(error?.message || '').includes('Missing Permissions')) {
      console.error('Controlla che il ruolo del bot sia sopra i ruoli da creare e che abbia Gestisci canali e Gestisci ruoli.');
    }
    process.exitCode = 1;
  } finally {
    client.destroy();
  }
}

if (require.main === module) main();

module.exports = { applyStructure, parseArgs, printPlan };

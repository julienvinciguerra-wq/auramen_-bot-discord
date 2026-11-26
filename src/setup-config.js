/**
 * Configurazione completa del server da terminale, senza slash command.
 *
 *   npm run setup-config -- --guild <ID>
 *   npm run setup-config -- --guild <ID> --conteggi
 *
 * È ripetibile: aggiorna la stessa configurazione e modifica il pannello e il
 * regolamento già pubblicati invece di duplicarli.
 */

require('dotenv').config();

const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const { getGuildConfig, setGuildConfig } = require('./database/database');
const { updateWelcomeSettings } = require('./systems/welcome');
const { buildRulesEmbed, getRulesSettings, updateRulesSettings } = require('./commands/regole');
const { updateTicketConfig, getTicketSettings, buildPanelMessage } = require('./systems/tickets');
const { startCounting } = require('./systems/counting');
const { setCounter, updateCounters } = require('./systems/counters');

const LOG_CHANNELS = {
  members: 'log-membri',
  messages: 'log-messaggi',
  channels: 'log-canali',
  roles: 'log-ruoli',
  moderation: 'log-moderazione',
  ticket: 'log-ticket',
  voice: 'log-vocali',
  server: 'log-server'
};

const MODERATION_COMMANDS = ['warn', 'timeout', 'untimeout', 'kick', 'ban', 'unban', 'purge'];

function parseArgs(argv) {
  const args = { guild: null, conteggi: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--guild') args.guild = argv[++i];
    else if (argv[i].startsWith('--guild=')) args.guild = argv[i].split('=')[1];
    else if (argv[i] === '--conteggi') args.conteggi = true;
  }
  args.guild = args.guild || process.env.GUILD_ID || process.env.DISCORD_GUILD_ID || null;
  return args;
}

/** "🎫｜ticket" → "ticket", così si cerca per nome semplice. */
function plainName(name) {
  const value = String(name || '');
  const index = value.lastIndexOf('｜');
  return index === -1 ? value : value.slice(index + 1);
}

function findChannel(channels, name) {
  const wanted = plainName(name).toLowerCase();
  return channels.find(channel => plainName(channel.name).toLowerCase() === wanted) || null;
}

function findCategory(channels, part) {
  return channels.find(channel => channel.type === ChannelType.GuildCategory && channel.name.includes(part)) || null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.guild) {
    console.error('Serve l’ID del server: npm run setup-config -- --guild 1575446199232634911');
    process.exitCode = 1;
    return;
  }
  if (!process.env.DISCORD_TOKEN) {
    console.error('Manca DISCORD_TOKEN nel file .env.');
    process.exitCode = 1;
    return;
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  const esiti = [];
  const problemi = [];

  try {
    await client.login(process.env.DISCORD_TOKEN);
    const guild = await client.guilds.fetch(args.guild);
    const channels = [...(await guild.channels.fetch()).values()].filter(Boolean);
    const roles = [...(await guild.roles.fetch()).values()];
    const guildId = guild.id;

    const staffRole = roles.find(role => role.name === 'Staff') || null;
    const staffChannel = findChannel(channels, 'staff-chat');
    const regolamento = findChannel(channels, 'regolamento');
    const benvenuto = findChannel(channels, 'benvenuto');
    const panelChannel = findChannel(channels, 'ticket');
    const transcriptChannel = findChannel(channels, 'archivio-transcript');
    const logTicket = findChannel(channels, 'log-ticket');

    // --- Benvenuto ---
    if (benvenuto) {
      updateWelcomeSettings(guildId, { channelId: benvenuto.id });
      esiti.push(`benvenuto → #${benvenuto.name}`);
    } else {
      problemi.push('canale benvenuto non trovato');
    }

    // --- Log ---
    const config = getGuildConfig(guildId);
    config.logging = config.logging || {};
    for (const [category, name] of Object.entries(LOG_CHANNELS)) {
      const channel = findChannel(channels, name);
      if (!channel) { problemi.push(`canale log mancante: ${name}`); continue; }
      config.logging[category] = channel.id;
      esiti.push(`log ${category} → #${channel.name}`);
    }
    setGuildConfig(guildId, config);

    // --- Regolamento ---
    if (regolamento) {
      const rules = getRulesSettings(guildId);
      const payload = { embeds: [buildRulesEmbed(rules)], allowedMentions: { parse: [] } };
      let messageId = rules.messageId;
      let edited = false;
      if (rules.messageId && rules.channelId === regolamento.id) {
        const existing = await regolamento.messages.fetch(rules.messageId).catch(() => null);
        if (existing?.editable) {
          await existing.edit(payload);
          edited = true;
        }
      }
      if (!edited) {
        const sent = await regolamento.send(payload);
        messageId = sent.id;
      }
      updateRulesSettings(guildId, { messageId, channelId: regolamento.id });
      esiti.push(`regolamento ${edited ? 'aggiornato' : 'pubblicato'} → #${regolamento.name}`);
    } else {
      problemi.push('canale regolamento non trovato');
    }

    // --- Ticket ---
    const ticketCategory = findCategory(channels, 'TICKET');
    if (ticketCategory && panelChannel && staffRole) {
      updateTicketConfig(guildId, {
        categoryId: ticketCategory.id,
        panelChannelId: panelChannel.id,
        logChannelId: logTicket?.id || null,
        transcriptChannelId: transcriptChannel?.id || null,
        staffRoleIds: [staffRole.id],
        transcriptMode: 'both',
        maxOpenPerUser: 2
      });
      esiti.push(`ticket → categoria ${ticketCategory.name}, pannello #${panelChannel.name}`);

      const settings = getTicketSettings(guildId);
      const payload = buildPanelMessage(settings);
      let messageId = settings.panelMessageId;
      let edited = false;
      if (settings.panelMessageId && settings.panelMessageChannelId === panelChannel.id) {
        const existing = await panelChannel.messages.fetch(settings.panelMessageId).catch(() => null);
        if (existing?.editable) {
          await existing.edit(payload);
          edited = true;
        }
      }
      if (!edited) {
        const sent = await panelChannel.send(payload);
        messageId = sent.id;
      }
      updateTicketConfig(guildId, { panelMessageId: messageId, panelMessageChannelId: panelChannel.id });
      esiti.push(`pannello ticket ${edited ? 'aggiornato' : 'pubblicato'} → #${panelChannel.name}`);
    } else if (!ticketCategory) {
      problemi.push('categoria TICKET non trovata (creala o passa --categoria)');
    }

    // --- Conteggio ---
    let countingChannel = findChannel(channels, 'conteggio');
    if (!countingChannel) {
      const general = findCategory(channels, 'GENERAL');
      countingChannel = await guild.channels.create({
        name: '🔢｜conteggio',
        type: ChannelType.GuildText,
        parent: general?.id,
        reason: 'Configurazione auramen'
      });
      esiti.push(`canale conteggio creato → #${countingChannel.name}`);
    }
    startCounting(guildId, countingChannel.id);
    esiti.push(`conteggio → #${countingChannel.name}`);

    // --- Permessi moderazione (ruolo Staff, canale staff-chat) ---
    if (staffRole && staffChannel) {
      const cfg = getGuildConfig(guildId);
      cfg.commandPermissions = cfg.commandPermissions || {};
      for (const command of MODERATION_COMMANDS) {
        cfg.commandPermissions[command] = { roleId: staffRole.id, channelId: staffChannel.id };
      }
      setGuildConfig(guildId, cfg);
      esiti.push(`permessi /moderazione → @${staffRole.name} in #${staffChannel.name}`);
    } else {
      problemi.push('ruolo Staff o canale staff-chat non trovato: permessi moderazione non impostati');
    }

    // --- Counter (opzionale) ---
    if (args.conteggi) {
      const vocali = findCategory(channels, 'VOCALI');
      const counters = [
        { type: 'membri', name: '📊｜Membri', template: 'Membri: {count}' },
        { type: 'online', name: '🟢｜Online', template: 'Online: {count}' }
      ];
      for (const counter of counters) {
        let channel = findChannel(channels, counter.name);
        if (!channel) {
          channel = await guild.channels.create({
            name: counter.name,
            type: ChannelType.GuildVoice,
            parent: vocali?.id,
            reason: 'Configurazione auramen'
          });
          esiti.push(`canale counter creato → 🔊 ${channel.name}`);
        }
        setCounter(guildId, counter.type, { channelId: channel.id, template: counter.template });
        esiti.push(`counter ${counter.type} → 🔊 ${channel.name}`);
      }
      const risultato = await updateCounters(guild);
      esiti.push(`counter aggiornati: ${risultato.updated.length}`);
    }

    console.log('\nConfigurazione completata:');
    for (const riga of esiti) console.log(`  ✅ ${riga}`);
    if (problemi.length) {
      console.log('\nDa sistemare a mano:');
      for (const riga of problemi) console.log(`  ⚠️  ${riga}`);
    }
    if (staffRole) {
      console.log('\nNota: i moderatori devono avere anche il ruolo Staff per usare /moderazione in #staff-chat.');
    }
  } catch (error) {
    console.error('Configurazione fallita:', error);
    process.exitCode = 1;
  } finally {
    await client.destroy().catch(() => {});
  }
}

if (require.main === module) main();

module.exports = { parseArgs, plainName, findChannel, LOG_CHANNELS, MODERATION_COMMANDS };

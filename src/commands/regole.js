const {
  SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder
} = require('discord.js');
const { getGuildConfig, setGuildConfig } = require('../database/database');
const { BRAND_COLOR } = require('../systems/tickets');

const DEFAULT_RULES = {
  title: 'Regole del server',
  description: 'Leggi e rispetta le regole: restare nel server implica accettarle.',
  text: [
    'Rispetta tutti i membri e lo staff: niente insulti, discriminazioni o molestie.',
    'Niente spam, flood, tag di massa o abuso di emoji e maiuscole.',
    'Niente contenuti illegali, minacce, gore o materiale per adulti.',
    'Niente pubblicità, autopromozione o link non autorizzati dallo staff.',
    'Chatta in 💬｜chat-generale, usa i comandi in 🤖｜chat-comandi e pubblica clip e video nei canali CONTENUTI.',
    'Problemi con un utente o con lo staff? Apri un ticket in 🎫｜ticket; per le segnalazioni usa 🚨｜segnalazioni.',
    'Le decisioni dello staff si discutono in privato, mai in pubblico.'
  ].join('\n'),
  footer: 'AURAMEN • Regolamento',
  color: BRAND_COLOR
};

function getRulesSettings(guildId) {
  const stored = getGuildConfig(guildId).rules || {};
  return {
    title: stored.title || DEFAULT_RULES.title,
    description: stored.description || DEFAULT_RULES.description,
    text: typeof stored.text === 'string' ? stored.text : DEFAULT_RULES.text,
    footer: stored.footer || DEFAULT_RULES.footer,
    color: Number.isInteger(stored.color) ? stored.color : DEFAULT_RULES.color,
    messageId: stored.messageId || null,
    channelId: stored.channelId || null
  };
}

function updateRulesSettings(guildId, patch) {
  const config = getGuildConfig(guildId);
  config.rules = { ...(config.rules || {}), ...patch };
  setGuildConfig(guildId, config);
  return getRulesSettings(guildId);
}

/** Trasforma le righe in elenco numerato, scartando righe vuote. */
function numberRules(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map((line, index) => `**${index + 1}.** ${line}`)
    .join('\n');
}

function buildRulesEmbed(rules) {
  const list = numberRules(rules.text);
  const description = [rules.description, list].filter(Boolean).join('\n\n').slice(0, 4096);
  return new EmbedBuilder()
    .setColor(rules.color)
    .setTitle(rules.title.slice(0, 256))
    .setDescription(description || 'Nessuna regola impostata.')
    .setFooter({ text: rules.footer.slice(0, 2048) })
    .setTimestamp();
}

function resetRules(guildId) {
  return updateRulesSettings(guildId, {
    title: DEFAULT_RULES.title,
    description: DEFAULT_RULES.description,
    text: DEFAULT_RULES.text,
    footer: DEFAULT_RULES.footer,
    color: DEFAULT_RULES.color
  });
}

module.exports = {
  DEFAULT_RULES,
  buildRulesEmbed,
  getRulesSettings,
  updateRulesSettings,
  resetRules,
  data: new SlashCommandBuilder()
    .setName('regole')
    .setDescription('Pubblica e personalizza il regolamento del server.')
    .addSubcommand(sub => sub.setName('pubblica').setDescription('Pubblica o aggiorna il regolamento in un canale (solo admin).')
      .addChannelOption(o => o.setName('canale').setDescription('Canale in cui pubblicare il regolamento')
        .addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(sub => sub.setName('config').setDescription('Personalizza il regolamento (solo admin).')
      .addStringOption(o => o.setName('titolo').setDescription('Titolo dell’embed').setMaxLength(256))
      .addStringOption(o => o.setName('descrizione').setDescription('Testo introduttivo').setMaxLength(1000))
      .addStringOption(o => o.setName('testo').setDescription('Regole separate da \\n (vengono numerate automaticamente)').setMaxLength(3000))
      .addStringOption(o => o.setName('footer').setDescription('Testo in fondo all’embed').setMaxLength(200))
      .addStringOption(o => o.setName('colore').setDescription('Colore esadecimale, es. #A855F7').setMaxLength(7))
      .addBooleanOption(o => o.setName('ripristina').setDescription('Ripristina testo e stile predefiniti')))
    .addSubcommand(sub => sub.setName('mostra').setDescription('Anteprima del regolamento (solo admin).')),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Usa questo comando dentro un server.', ephemeral: true });
    }
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: 'Solo gli amministratori possono gestire il regolamento.', ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();
    if (sub === 'pubblica') return publishRules(interaction);
    if (sub === 'config') return configureRules(interaction);

    const rules = getRulesSettings(interaction.guildId);
    return interaction.reply({
      content: 'Anteprima del regolamento (solo tu la vedi). Per pubblicarlo usa `/regole pubblica`.',
      embeds: [buildRulesEmbed(rules)],
      ephemeral: true
    });
  }
};

async function publishRules(interaction) {
  const channel = interaction.options.getChannel('canale', true);
  const rules = getRulesSettings(interaction.guildId);
  const me = interaction.guild.members.me;
  const perms = me ? channel.permissionsFor(me) : null;
  if (!perms?.has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory])) {
    return interaction.reply({ content: `Il bot non può scrivere in ${channel}: servono Invia messaggi e Incorpora link.`, ephemeral: true });
  }

  const payload = { embeds: [buildRulesEmbed(rules)], allowedMentions: { parse: [] } };

  if (rules.messageId && rules.channelId === channel.id) {
    const existing = await channel.messages.fetch(rules.messageId).catch(() => null);
    if (existing?.editable) {
      await existing.edit(payload);
      return interaction.reply({ content: `Regolamento aggiornato in ${channel}.`, ephemeral: true });
    }
  }

  const sent = await channel.send(payload);
  updateRulesSettings(interaction.guildId, { messageId: sent.id, channelId: channel.id });
  return interaction.reply({ content: `Regolamento pubblicato in ${channel}.`, ephemeral: true });
}

async function configureRules(interaction) {
  const o = interaction.options;
  const patch = {};

  if (o.getBoolean('ripristina')) {
    Object.assign(patch, {
      title: DEFAULT_RULES.title,
      description: DEFAULT_RULES.description,
      text: DEFAULT_RULES.text,
      footer: DEFAULT_RULES.footer,
      color: DEFAULT_RULES.color
    });
  } else {
    const title = o.getString('titolo');
    const description = o.getString('descrizione');
    const text = o.getString('testo');
    const footer = o.getString('footer');
    const color = o.getString('colore');

    if (title) patch.title = title;
    if (description) patch.description = description.replaceAll('\\n', '\n');
    if (text) patch.text = text.replaceAll('\\n', '\n');
    if (footer) patch.footer = footer;
    if (color) {
      if (!/^#?[0-9a-f]{6}$/i.test(color)) {
        return interaction.reply({ content: 'Colore non valido: usa il formato `#A855F7`.', ephemeral: true });
      }
      patch.color = parseInt(color.replace('#', ''), 16);
    }
  }

  const current = getRulesSettings(interaction.guildId);
  if (!Object.keys(patch).length) {
    return interaction.reply({
      content: 'Configurazione attuale (usa le opzioni per modificarla).',
      embeds: [buildRulesEmbed(current)],
      ephemeral: true
    });
  }

  updateRulesSettings(interaction.guildId, patch);
  return interaction.reply({
    content: 'Regolamento salvato. Esegui `/regole pubblica` per aggiornare il messaggio già pubblicato.',
    embeds: [buildRulesEmbed(getRulesSettings(interaction.guildId))],
    ephemeral: true
  });
}

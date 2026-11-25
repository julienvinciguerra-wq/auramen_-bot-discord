const {
  SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder, AttachmentBuilder
} = require('discord.js');
const { db } = require('../database/database');
const {
  publishPanel, getTicketSettings, updateTicketConfig, isStaff, logTicket, getTicketByChannel, buildTranscript,
  DEFAULT_PANEL, DEFAULT_WELCOME, BRAND_COLOR
} = require('../systems/tickets');

const ACCESS = { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true };

// Nota: `pannello` è il comando già esistente per pubblicare il pannello (equivalente a "panel").
module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Gestione del sistema ticket.')
    .addSubcommand(sub => sub.setName('setup').setDescription('Configura categoria, canali e ruoli staff dei ticket (solo admin).')
      .addChannelOption(o => o.setName('categoria').setDescription('Categoria in cui creare i ticket').addChannelTypes(ChannelType.GuildCategory))
      .addChannelOption(o => o.setName('pannello').setDescription('Canale del pannello ticket').addChannelTypes(ChannelType.GuildText))
      .addChannelOption(o => o.setName('log').setDescription('Canale dei log ticket').addChannelTypes(ChannelType.GuildText))
      .addChannelOption(o => o.setName('transcript').setDescription('Canale archivio transcript (se omesso usa quello già salvato o il log)').addChannelTypes(ChannelType.GuildText))
      .addRoleOption(o => o.setName('staff').setDescription('Ruolo staff autorizzato'))
      .addRoleOption(o => o.setName('staff2').setDescription('Secondo ruolo staff (opzionale)'))
      .addRoleOption(o => o.setName('staff3').setDescription('Terzo ruolo staff (opzionale)'))
      .addIntegerOption(o => o.setName('max_per_utente').setDescription('Ticket aperti contemporaneamente per utente (1-5)').setMinValue(1).setMaxValue(5)))
    .addSubcommand(sub => sub.setName('config').setDescription('Personalizza pannello e messaggi dei ticket, o mostra la configurazione (solo admin).')
      .addStringOption(o => o.setName('titolo').setDescription('Titolo del pannello').setMaxLength(256))
      .addStringOption(o => o.setName('descrizione').setDescription('Descrizione del pannello (usa \\n per andare a capo)').setMaxLength(1500))
      .addStringOption(o => o.setName('pulsante').setDescription('Testo del pulsante Apri Ticket').setMaxLength(80))
      .addStringOption(o => o.setName('footer').setDescription('Testo in fondo al pannello').setMaxLength(100))
      .addStringOption(o => o.setName('colore').setDescription('Colore esadecimale, es. #A855F7').setMaxLength(7))
      .addStringOption(o => o.setName('benvenuto').setDescription('Messaggio nel ticket. Segnaposto: {user} {staff} {ticket}').setMaxLength(1500))
      .addBooleanOption(o => o.setName('ripristina').setDescription('Ripristina titolo, testi e colore del pannello ai valori predefiniti')))
    .addSubcommand(sub => sub.setName('pannello').setDescription('Pubblica il pannello di apertura ticket.'))
    .addSubcommand(sub => sub.setName('trasferisci').setDescription('Trasferisce il ticket a uno staffer o a un ruolo.')
      .addUserOption(o => o.setName('utente').setDescription('Nuovo responsabile').setRequired(false))
      .addRoleOption(o => o.setName('ruolo').setDescription('Ruolo che prenderà in carico il ticket').setRequired(false)))
    .addSubcommand(sub => sub.setName('aggiungi').setDescription('Dà accesso al ticket a un utente.')
      .addUserOption(o => o.setName('utente').setDescription('Utente da aggiungere').setRequired(true)))
    .addSubcommand(sub => sub.setName('rimuovi').setDescription('Toglie l’accesso al ticket a un utente.')
      .addUserOption(o => o.setName('utente').setDescription('Utente da rimuovere').setRequired(true)))
    .addSubcommand(sub => sub.setName('transcript').setDescription('Genera il transcript HTML del ticket corrente.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Usa questo comando dentro un server.', ephemeral: true });
    }

    // --- Comandi amministrativi ---
    if (['pannello', 'setup', 'config'].includes(sub)) {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: 'Solo gli amministratori possono usare questo comando.', ephemeral: true });
      }
      if (sub === 'pannello') return publishPanel(interaction);
      if (sub === 'setup') return handleSetup(interaction);
      return handleConfig(interaction);
    }

    // --- Comandi staff, validi solo dentro un ticket registrato ---
    const settings = getTicketSettings(interaction.guildId);
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!isStaff(member, settings)) {
      return interaction.reply({ content: 'Solo lo staff autorizzato può usare questo comando.', ephemeral: true });
    }
    const ticket = getTicketByChannel(interaction.guildId, interaction.channelId);
    if (!ticket || ticket.status === 'deleted') {
      return interaction.reply({ content: 'Usa questo comando dentro un ticket registrato.', ephemeral: true });
    }
    if (sub !== 'transcript' && ticket.status !== 'open') {
      return interaction.reply({ content: 'Usa questo comando dentro un ticket aperto.', ephemeral: true });
    }

    if (sub === 'transcript') {
      return sendTranscript(interaction, ticket, settings);
    }

    if (sub === 'trasferisci') {
      const user = interaction.options.getUser('utente');
      const role = interaction.options.getRole('ruolo');
      if (Boolean(user) === Boolean(role)) {
        return interaction.reply({ content: 'Indica un solo destinatario: utente oppure ruolo.', ephemeral: true });
      }
      let targetId;
      let label;
      if (user) {
        const targetMember = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (!targetMember) return interaction.reply({ content: 'L’utente non appartiene al server.', ephemeral: true });
        if (!isStaff(targetMember, settings)) {
          return interaction.reply({ content: 'Puoi trasferire il ticket solo a un membro dello staff o a un amministratore.', ephemeral: true });
        }
        targetId = user.id;
        label = user.toString();
      } else {
        targetId = role.id;
        label = role.toString();
      }
      await interaction.channel.permissionOverwrites.edit(targetId, ACCESS);
      db.prepare('UPDATE tickets SET transferred_to = ? WHERE id = ?').run(targetId, ticket.id);
      await interaction.reply({ content: `Ticket trasferito a ${label}. Lo staff precedente mantiene l’accesso.`, allowedMentions: { parse: [] } });
      return logTicket(interaction.guild, settings, { ticket, action: 'transfer', title: 'Ticket trasferito', actorId: interaction.user.id, targetId: user?.id, details: role ? `Ruolo ${role.name}` : null });
    }

    if (sub === 'aggiungi') {
      const user = interaction.options.getUser('utente', true);
      if (user.bot) return interaction.reply({ content: 'Non puoi aggiungere un bot al ticket.', ephemeral: true });
      const target = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!target) return interaction.reply({ content: 'L’utente non appartiene al server.', ephemeral: true });
      await interaction.channel.permissionOverwrites.edit(user.id, ACCESS);
      await interaction.reply({ content: `${user} è stato aggiunto al ticket.`, allowedMentions: { users: [user.id] } });
      return logTicket(interaction.guild, settings, { ticket, action: 'add_member', title: 'Membro aggiunto al ticket', actorId: interaction.user.id, targetId: user.id });
    }

    if (sub === 'rimuovi') {
      const user = interaction.options.getUser('utente', true);
      if (user.id === ticket.opener_id) {
        return interaction.reply({ content: 'Non puoi rimuovere chi ha aperto il ticket: chiudi il ticket.', ephemeral: true });
      }
      if (user.id === interaction.client.user.id) {
        return interaction.reply({ content: 'Non posso rimuovere me stesso dal ticket.', ephemeral: true });
      }
      const overwrite = interaction.channel.permissionOverwrites.cache.get(user.id);
      if (!overwrite) {
        return interaction.reply({ content: 'Questo utente non ha un accesso individuale al ticket (potrebbe avere accesso tramite un ruolo staff).', ephemeral: true });
      }
      await interaction.channel.permissionOverwrites.delete(user.id);
      await interaction.reply({ content: `${user} è stato rimosso dal ticket.`, allowedMentions: { parse: [] } });
      return logTicket(interaction.guild, settings, { ticket, action: 'remove_member', title: 'Membro rimosso dal ticket', actorId: interaction.user.id, targetId: user.id });
    }
  }
};

/** Genera a richiesta il file HTML del ticket, anche se è già chiuso. */
async function sendTranscript(interaction, ticket, settings) {
  await interaction.deferReply({ ephemeral: true });
  const buffer = await buildTranscript(interaction.channel, ticket);
  const name = `ticket-${ticket.id}-transcript-${new Date().toISOString().slice(0, 10)}.html`;
  await interaction.editReply({
    content: `Transcript del ticket #${ticket.id} (stato: ${ticket.status}) • ${Math.round(buffer.length / 1024)} KB.`,
    files: [new AttachmentBuilder(buffer, { name })]
  });
  return logTicket(interaction.guild, settings, {
    ticket, action: 'transcript', title: 'Transcript generato', actorId: interaction.user.id, details: `File ${name}`
  });
}

async function handleSetup(interaction) {
  const patch = {};
  const category = interaction.options.getChannel('categoria');
  const panel = interaction.options.getChannel('pannello');
  const log = interaction.options.getChannel('log');
  const transcript = interaction.options.getChannel('transcript');
  const max = interaction.options.getInteger('max_per_utente');
  const roles = ['staff', 'staff2', 'staff3'].map(name => interaction.options.getRole(name)).filter(Boolean);

  if (category) patch.categoryId = category.id;
  if (panel) patch.panelChannelId = panel.id;
  if (log) patch.logChannelId = log.id;
  if (transcript) patch.transcriptChannelId = transcript.id;
  if (max) patch.maxOpenPerUser = max;
  if (roles.length) {
    const ids = [...new Set(roles.map(r => r.id))];
    patch.staffRoleIds = ids;
    patch.staffRoleId = ids[0]; // compatibilità con /setup tickets
  }
  if (!Object.keys(patch).length) {
    return interaction.reply({ content: 'Nessuna opzione indicata: usa `/ticket config` per vedere la configurazione attuale.', ephemeral: true });
  }
  // Se non esiste ancora un archivio, usa il canale log come transcript.
  const current = getTicketSettings(interaction.guildId);
  if (!current.transcriptChannelId && !patch.transcriptChannelId && patch.logChannelId) patch.transcriptChannelId = patch.logChannelId;

  const settings = updateTicketConfig(interaction.guildId, patch);
  return interaction.reply({ embeds: [configEmbed(settings, 'Configurazione ticket aggiornata')], ephemeral: true });
}

async function handleConfig(interaction) {
  const o = interaction.options;
  const title = o.getString('titolo');
  const description = o.getString('descrizione');
  const button = o.getString('pulsante');
  const footer = o.getString('footer');
  const color = o.getString('colore');
  const welcome = o.getString('benvenuto');
  const reset = o.getBoolean('ripristina');

  const current = getTicketSettings(interaction.guildId);
  const panel = { ...current.panel };
  const patch = {};

  if (reset) {
    patch.panel = { ...DEFAULT_PANEL };
    patch.welcomeMessage = DEFAULT_WELCOME;
  } else {
    if (title) panel.title = title;
    if (description) panel.description = description.replaceAll('\\n', '\n');
    if (button) panel.buttonLabel = button;
    if (footer) panel.footer = footer;
    if (color) {
      if (!/^#?[0-9a-f]{6}$/i.test(color)) return interaction.reply({ content: 'Colore non valido: usa il formato `#A855F7`.', ephemeral: true });
      panel.color = parseInt(color.replace('#', ''), 16);
    }
    if (welcome) patch.welcomeMessage = welcome.replaceAll('\\n', '\n');
    if (title || description || button || footer || color) patch.panel = panel;
  }

  if (!Object.keys(patch).length) {
    return interaction.reply({ embeds: [configEmbed(current, 'Configurazione ticket')], ephemeral: true });
  }
  const settings = updateTicketConfig(interaction.guildId, patch);
  return interaction.reply({
    content: 'Salvato. Esegui `/ticket pannello` per aggiornare il pannello già pubblicato.',
    embeds: [configEmbed(settings, 'Configurazione ticket aggiornata')],
    ephemeral: true
  });
}

function configEmbed(settings, title) {
  const ch = id => (id ? `<#${id}>` : '*non configurato*');
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(title)
    .addFields(
      { name: 'Categoria ticket', value: settings.categoryId ? `<#${settings.categoryId}>` : '*nessuna (ticket fuori categoria)*', inline: true },
      { name: 'Canale pannello', value: ch(settings.panelChannelId), inline: true },
      { name: 'Canale log', value: ch(settings.logChannelId), inline: true },
      { name: 'Archivio transcript', value: ch(settings.transcriptChannelId || settings.logChannelId), inline: true },
      { name: 'Ruoli staff', value: settings.staffRoleIds.length ? settings.staffRoleIds.map(id => `<@&${id}>`).join(' ') : '*non configurati*', inline: true },
      { name: 'Max ticket per utente', value: String(settings.maxOpenPerUser), inline: true },
      { name: 'Pannello', value: `**${settings.panel.title}**\n${settings.panel.description}`.slice(0, 1000) },
      { name: 'Messaggio di benvenuto', value: settings.welcomeMessage.slice(0, 1000) }
    );
}

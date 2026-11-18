const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  ChannelType, PermissionFlagsBits, AttachmentBuilder
} = require('discord.js');
const { db, getGuildConfig, setGuildConfig } = require('../database/database');

const BRAND_COLOR = 0xA855F7; // viola AURAMEN
const SUCCESS_COLOR = 0x57F287;
const DANGER_COLOR = 0xED4245;
const BRAND_NAME = 'AURAMEN';

const DEFAULT_PANEL = {
  title: 'Contattami — Apri un ticket',
  description: 'Hai bisogno di assistenza, vuoi collaborare o vuoi richiedere un servizio? Premi il pulsante qui sotto per aprire un ticket privato: ti risponderò appena possibile.',
  buttonLabel: 'Apri Ticket',
  footer: 'AURAMEN UNIVERSE • Supporto',
  color: BRAND_COLOR
};

const DEFAULT_WELCOME = 'Ciao {user}, grazie per avermi contattato! Descrivi con chiarezza la tua richiesta (assistenza, collaborazione o servizio) e {staff} ti risponderà appena possibile.';

const MEMBER_PERMS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AttachFiles
];

// Blocco anti-doppio-click / race condition mentre un ticket sta venendo creato.
const openingLocks = new Set();

// ---------------------------------------------------------------------------
// Configurazione
// ---------------------------------------------------------------------------

function parseIdList(value) {
  return String(value || '')
    .split(/[,\s]+/)
    .map(id => id.trim())
    .filter(id => /^\d{15,25}$/.test(id));
}

/**
 * Configurazione ticket normalizzata.
 * Precedenza: database (comandi /ticket setup, /setup tickets) > variabili d'ambiente.
 * Nessun ID è inventato: se non è configurato resta null / [].
 */
function getTicketSettings(guildId) {
  const stored = getGuildConfig(guildId).tickets || {};
  const envApplies = !process.env.GUILD_ID || process.env.GUILD_ID === guildId;
  const env = envApplies ? process.env : {};

  const staffRoleIds = Array.isArray(stored.staffRoleIds) && stored.staffRoleIds.length
    ? stored.staffRoleIds
    : stored.staffRoleId
      ? [stored.staffRoleId]
      : parseIdList(env.TICKET_STAFF_ROLE_IDS);

  return {
    panelChannelId: stored.panelChannelId || env.TICKET_PANEL_CHANNEL_ID || null,
    transcriptChannelId: stored.transcriptChannelId || env.TICKET_TRANSCRIPT_CHANNEL_ID || null,
    logChannelId: stored.logChannelId || env.TICKET_LOG_CHANNEL_ID || null,
    categoryId: stored.categoryId || env.TICKET_CATEGORY_ID || null,
    staffRoleIds,
    maxOpenPerUser: Number(stored.maxOpenPerUser) > 0 ? Number(stored.maxOpenPerUser) : 1,
    panel: { ...DEFAULT_PANEL, ...(stored.panel || {}) },
    welcomeMessage: stored.welcomeMessage || DEFAULT_WELCOME,
    panelMessageId: stored.panelMessageId || null,
    panelMessageChannelId: stored.panelMessageChannelId || null
  };
}

/** Salva solo i campi indicati, preservando il resto della configurazione. */
function updateTicketConfig(guildId, patch) {
  const config = getGuildConfig(guildId);
  config.tickets = { ...(config.tickets || {}), ...patch };
  setGuildConfig(guildId, config);
  return getTicketSettings(guildId);
}

function archiveChannelId(settings) {
  return settings.transcriptChannelId || settings.logChannelId || null;
}

function isStaff(member, settings) {
  if (!member) return false;
  if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;
  return settings.staffRoleIds.some(id => member.roles?.cache?.has(id));
}

function staffMention(settings) {
  return settings.staffRoleIds.length ? settings.staffRoleIds.map(id => `<@&${id}>`).join(' ') : 'lo staff';
}

function renderWelcome(template, { user, settings, ticketId }) {
  return String(template)
    .replaceAll('{user}', `${user}`)
    .replaceAll('{staff}', staffMention(settings))
    .replaceAll('{ticket}', `#${ticketId}`);
}

// ---------------------------------------------------------------------------
// Database / log
// ---------------------------------------------------------------------------

function getTicketByChannel(guildId, channelId) {
  return db.prepare('SELECT * FROM tickets WHERE guild_id = ? AND channel_id = ?').get(guildId, channelId);
}

function recordEvent(ticketId, guildId, action, actorId, targetId, details) {
  try {
    db.prepare('INSERT INTO ticket_logs (ticket_id, guild_id, action, actor_id, target_id, details) VALUES (?, ?, ?, ?, ?, ?)')
      .run(ticketId ?? null, guildId, action, actorId ?? null, targetId ?? null, details ?? null);
  } catch (error) {
    console.error('Impossibile salvare il log ticket nel database:', error.message);
  }
}

/** Registra l'evento nel database e lo invia al canale log (se configurato). */
async function logTicket(guild, settings, { ticket, action, title, actorId, targetId, details, color = BRAND_COLOR }) {
  recordEvent(ticket?.id, guild.id, action, actorId, targetId, details);
  const channelId = settings.logChannelId || settings.transcriptChannelId;
  if (!channelId) return;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  const fields = [];
  if (ticket) fields.push({ name: 'Ticket', value: `#${ticket.id}${ticket.channel_id ? ` • <#${ticket.channel_id}>` : ''}`, inline: true });
  if (actorId) fields.push({ name: 'Eseguito da', value: `<@${actorId}>`, inline: true });
  if (targetId) fields.push({ name: 'Utente', value: `<@${targetId}>`, inline: true });
  if (details) fields.push({ name: 'Dettagli', value: String(details).slice(0, 1000) });

  await channel.send({
    embeds: [new EmbedBuilder().setColor(color).setTitle(String(title).slice(0, 256)).addFields(fields)
      .setFooter({ text: `${BRAND_NAME} • Ticket` }).setTimestamp()],
    allowedMentions: { parse: [] }
  }).catch(error => console.error('Impossibile inviare il log ticket:', error.message));
}

function reply(interaction, content) {
  const payload = { content, ephemeral: true };
  return interaction.deferred || interaction.replied
    ? interaction.followUp(payload)
    : interaction.reply(payload);
}

// ---------------------------------------------------------------------------
// Pannello
// ---------------------------------------------------------------------------

function buildPanelMessage(settings) {
  const panel = settings.panel;
  const embed = new EmbedBuilder()
    .setColor(panel.color ?? BRAND_COLOR)
    .setTitle(panel.title)
    .setDescription(panel.description)
    .addFields({ name: 'Prima di aprire un ticket', value: 'Descrivi la richiesta con chiarezza e non aprire più ticket per lo stesso motivo.' })
    .setFooter({ text: panel.footer });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('auramen:ticket:open').setLabel(panel.buttonLabel).setStyle(ButtonStyle.Primary)
  );
  return { embeds: [embed], components: [row] };
}

async function publishPanel(interaction) {
  const settings = getTicketSettings(interaction.guildId);
  if (!settings.panelChannelId || !archiveChannelId(settings) || !settings.staffRoleIds.length) {
    return interaction.reply({ content: 'Prima configura i ticket con `/ticket setup` (oppure `/setup tickets`): servono canale pannello, canale log/transcript e almeno un ruolo staff.', ephemeral: true });
  }
  const channel = await interaction.guild.channels.fetch(settings.panelChannelId).catch(() => null);
  if (!channel?.isTextBased()) return interaction.reply({ content: 'Canale pannello non valido.', ephemeral: true });

  const me = interaction.guild.members.me;
  const perms = me ? channel.permissionsFor(me) : null;
  if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
    return interaction.reply({ content: `Il bot non ha i permessi per scrivere in ${channel} (servono Vedi canale, Invia messaggi, Incorpora link).`, ephemeral: true });
  }

  const message = buildPanelMessage(settings);

  // Evita pannelli duplicati: se esiste già un pannello nello stesso canale, lo aggiorna.
  if (settings.panelMessageId && settings.panelMessageChannelId === channel.id) {
    const existing = await channel.messages.fetch(settings.panelMessageId).catch(() => null);
    if (existing?.editable) {
      await existing.edit(message);
      return interaction.reply({ content: `Pannello ticket aggiornato in ${channel}.`, ephemeral: true });
    }
  }

  const sent = await channel.send(message);
  updateTicketConfig(interaction.guildId, { panelMessageId: sent.id, panelMessageChannelId: channel.id });
  return interaction.reply({ content: `Pannello ticket pubblicato in ${channel}.`, ephemeral: true });
}

// ---------------------------------------------------------------------------
// Apertura
// ---------------------------------------------------------------------------

function sanitizeName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 16) || 'utente';
}

function ticketButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('auramen:ticket:claim').setLabel('Claim').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('auramen:ticket:close').setLabel('Chiudi ticket').setStyle(ButtonStyle.Danger)
  );
}

function closedButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('auramen:ticket:reopen').setLabel('Riapri ticket').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('auramen:ticket:delete').setLabel('Elimina ticket').setStyle(ButtonStyle.Danger)
  );
}

/** Conta i ticket aperti dell'utente; i record orfani (canale cancellato a mano) vengono chiusi. */
async function countOpenTickets(guild, userId) {
  const rows = db.prepare("SELECT * FROM tickets WHERE guild_id = ? AND opener_id = ? AND status = 'open'").all(guild.id, userId);
  const alive = [];
  for (const row of rows) {
    const channel = row.channel_id ? await guild.channels.fetch(row.channel_id).catch(() => null) : null;
    if (channel) alive.push({ row, channel });
    else db.prepare("UPDATE tickets SET status = 'deleted', closed_at = CURRENT_TIMESTAMP WHERE id = ?").run(row.id);
  }
  return alive;
}

async function openTicket(interaction) {
  const settings = getTicketSettings(interaction.guildId);
  if (!settings.staffRoleIds.length || !archiveChannelId(settings)) {
    return interaction.reply({ content: 'Il sistema ticket non è ancora configurato.', ephemeral: true });
  }

  const lockKey = `${interaction.guildId}:${interaction.user.id}`;
  if (openingLocks.has(lockKey)) {
    return interaction.reply({ content: 'Stiamo già creando il tuo ticket, attendi qualche secondo.', ephemeral: true });
  }
  openingLocks.add(lockKey);

  try {
    await interaction.deferReply({ ephemeral: true });

    const open = await countOpenTickets(interaction.guild, interaction.user.id);
    if (open.length >= settings.maxOpenPerUser) {
      return interaction.editReply({ content: `Hai già un ticket aperto: ${open[0].channel}` });
    }

    const me = interaction.guild.members.me;
    if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.editReply({ content: 'Il bot non ha il permesso “Gestisci canali”: avvisa lo staff.' });
    }

    let parent = null;
    let categoryWarning = null;
    if (settings.categoryId) {
      const category = await interaction.guild.channels.fetch(settings.categoryId).catch(() => null);
      if (category?.type === ChannelType.GuildCategory) parent = category.id;
      else categoryWarning = `La categoria ticket configurata (${settings.categoryId}) non è valida: ticket creato fuori categoria.`;
    }

    const staffOverwrites = [];
    for (const roleId of settings.staffRoleIds) {
      if (!interaction.guild.roles.cache.has(roleId) && !(await interaction.guild.roles.fetch(roleId).catch(() => null))) continue;
      staffOverwrites.push({ id: roleId, allow: [...MEMBER_PERMS, PermissionFlagsBits.ManageMessages] });
    }
    if (!staffOverwrites.length) {
      return interaction.editReply({ content: 'Nessun ruolo staff valido configurato: avvisa un amministratore.' });
    }

    const channel = await interaction.guild.channels.create({
      name: `ticket-${sanitizeName(interaction.user.username)}`,
      type: ChannelType.GuildText,
      ...(parent ? { parent } : {}),
      topic: `Ticket di ${interaction.user.tag} • ID ${interaction.user.id}`,
      permissionOverwrites: [
        { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: interaction.user.id, allow: MEMBER_PERMS },
        ...staffOverwrites,
        { id: interaction.client.user.id, allow: [...MEMBER_PERMS, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.EmbedLinks] }
      ],
      reason: `Ticket aperto da ${interaction.user.tag}`
    });

    let ticketId;
    try {
      ticketId = db.prepare('INSERT INTO tickets (guild_id, channel_id, opener_id) VALUES (?, ?, ?)')
        .run(interaction.guildId, channel.id, interaction.user.id).lastInsertRowid;
    } catch (error) {
      // Nessun canale "fantasma" senza record: annulla la creazione.
      await channel.delete('Registrazione del ticket non riuscita').catch(() => {});
      throw error;
    }
    const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);

    const embed = new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setTitle(`Ticket #${ticketId}`)
      .setDescription(renderWelcome(settings.welcomeMessage, { user: interaction.user, settings, ticketId }).slice(0, 4000))
      .addFields(
        { name: 'Stato', value: '🟢 Aperto', inline: true },
        { name: 'Claim', value: 'Non ancora assegnato', inline: true }
      )
      .setFooter({ text: `${BRAND_NAME} • Ticket` })
      .setTimestamp();

    await channel.send({
      content: `${interaction.user} ${staffMention(settings)}`,
      embeds: [embed],
      components: [ticketButtons()],
      allowedMentions: { users: [interaction.user.id], roles: settings.staffRoleIds }
    });

    await logTicket(interaction.guild, settings, {
      ticket, action: 'open', title: 'Ticket aperto', actorId: interaction.user.id, color: SUCCESS_COLOR
    });
    if (categoryWarning) {
      await logTicket(interaction.guild, settings, { ticket, action: 'config_warning', title: 'Attenzione configurazione', details: categoryWarning, color: DANGER_COLOR });
    }
    await interaction.editReply({ content: `Ticket creato: ${channel}` });
  } catch (error) {
    console.error('Errore apertura ticket:', error);
    await interaction.editReply({ content: 'Non sono riuscito a creare il ticket (errore Discord o permessi mancanti). Riprova tra poco o avvisa lo staff.' }).catch(() => {});
  } finally {
    openingLocks.delete(lockKey);
  }
}

// ---------------------------------------------------------------------------
// Transcript (invariato)
// ---------------------------------------------------------------------------

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

async function buildTranscript(channel, ticket) {
  const messages = [];
  let before;
  for (let page = 0; page < 10; page++) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }).catch(() => null);
    if (!batch?.size) break;
    messages.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  const body = messages.map(message => {
    const author = escapeHtml(message.author?.tag || 'Utente sconosciuto');
    const avatar = escapeHtml(message.author?.displayAvatarURL({ extension: 'png', size: 64 }) || '');
    const content = escapeHtml(message.cleanContent || (message.attachments.size ? '[Allegato]' : '[Messaggio senza testo]')).replace(/\n/g, '<br>');
    const attachments = [...message.attachments.values()].map(file =>
      `<p><a href="${escapeHtml(file.url)}" rel="noopener noreferrer">${escapeHtml(file.name || 'Allegato')}</a></p>`
    ).join('');
    return `<article class="message"><img src="${avatar}" alt=""><div class="message-body"><div class="meta"><strong>${author}</strong><time>${new Date(message.createdTimestamp).toLocaleString('it-IT')}</time></div><div>${content}</div>${attachments}</div></article>`;
  }).join('\n');

  const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Transcript ticket #${ticket.id}</title><style>
  *{box-sizing:border-box}body{margin:0;background:#313338;color:#dbdee1;font:15px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}.wrap{max-width:1000px;margin:32px auto;padding:24px}.header{background:#232428;border:1px solid #45464d;border-radius:12px;padding:22px;margin-bottom:18px}.header h1{margin:0 0 8px;color:#fff}.muted,time{color:#aeb1b8;font-size:12px}.message{display:flex;gap:14px;padding:14px 12px;border-bottom:1px solid #3f4147}.message img{width:40px;height:40px;border-radius:50%;background:#45464d}.message-body{min-width:0;overflow-wrap:anywhere}.meta{display:flex;gap:10px;align-items:baseline;margin-bottom:4px}.meta strong{color:#fff}.message a{color:#00a8fc}.footer{color:#949ba4;text-align:center;padding:24px;font-size:12px}@media(max-width:600px){.wrap{padding:12px;margin:8px auto}.header{padding:16px}}
  </style></head><body><main class="wrap"><header class="header"><h1>Transcript ticket #${ticket.id}</h1><div class="muted">Server: ${escapeHtml(channel.guild.name)} • Canale: #${escapeHtml(channel.name)}</div><div class="muted">Aperto da ID: ${escapeHtml(ticket.opener_id)} • Chiuso: ${new Date().toLocaleString('it-IT')}</div></header>${body}<footer class="footer">Generato da auramen bot</footer></main></body></html>`;

  return Buffer.from(html, 'utf8');
}

// ---------------------------------------------------------------------------
// Chiusura / riapertura / eliminazione
// ---------------------------------------------------------------------------

/** Impedisce (o ripristina) la scrittura ai membri con accesso individuale al ticket. */
async function setMembersCanWrite(channel, botId, canWrite) {
  for (const overwrite of channel.permissionOverwrites.cache.values()) {
    if (overwrite.type !== 1 /* member */ || overwrite.id === botId) continue;
    await channel.permissionOverwrites.edit(overwrite.id, { SendMessages: canWrite }).catch(error =>
      console.error('Aggiornamento permessi ticket fallito:', error.message));
  }
}

async function closeTicket(interaction, channel) {
  const settings = getTicketSettings(interaction.guildId);
  const ticket = db.prepare("SELECT * FROM tickets WHERE guild_id = ? AND channel_id = ? AND status = 'open'")
    .get(interaction.guildId, channel.id);
  if (!ticket) return interaction.reply({ content: 'Questo canale non risulta un ticket aperto.', ephemeral: true });
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (ticket.opener_id !== interaction.user.id && !isStaff(member, settings)) {
    return interaction.reply({ content: 'Solo chi ha aperto il ticket o lo staff può chiuderlo.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });
  const transcriptChannel = archiveChannelId(settings)
    ? await interaction.guild.channels.fetch(archiveChannelId(settings)).catch(() => null)
    : null;
  if (!transcriptChannel?.isTextBased()) {
    return interaction.editReply({ content: 'Canale transcript non disponibile: il ticket è rimasto aperto per non perdere la conversazione.' });
  }

  const transcript = await buildTranscript(channel, ticket);
  const attachment = new AttachmentBuilder(transcript, { name: `ticket-${ticket.id}-transcript.html` });
  try {
    await transcriptChannel.send({
      embeds: [new EmbedBuilder().setColor(DANGER_COLOR).setTitle(`Transcript ticket #${ticket.id}`)
        .setDescription(`Ticket di <@${ticket.opener_id}> chiuso da <@${interaction.user.id}>.`)
        .addFields({ name: 'Canale', value: channel.name }, { name: 'Download', value: 'Scarica il file HTML allegato e aprilo con il browser.' })
        .setTimestamp()],
      files: [attachment],
      allowedMentions: { parse: [] }
    });
  } catch (error) {
    console.error('Invio transcript fallito:', error);
    return interaction.editReply({ content: 'Non sono riuscito a inviare il transcript: il ticket è rimasto aperto per non perdere la conversazione.' });
  }

  db.prepare("UPDATE tickets SET status = 'closed', closed_at = CURRENT_TIMESTAMP, closed_by = ? WHERE id = ?")
    .run(interaction.user.id, ticket.id);
  await setMembersCanWrite(channel, interaction.client.user.id, false);

  await channel.send({
    embeds: [new EmbedBuilder().setColor(DANGER_COLOR).setTitle('🔒 Ticket chiuso')
      .setDescription(`Chiuso da ${interaction.user}. Il transcript è stato archiviato.\nLo staff può **riaprire** il ticket oppure **eliminare** definitivamente il canale.`)
      .setTimestamp()],
    components: [closedButtons()],
    allowedMentions: { parse: [] }
  }).catch(() => {});

  await logTicket(interaction.guild, settings, {
    ticket: { ...ticket, status: 'closed' }, action: 'close', title: 'Ticket chiuso', actorId: interaction.user.id, color: DANGER_COLOR
  });
  await interaction.editReply({ content: 'Ticket chiuso. Il transcript HTML è stato inviato al canale archivio.' });
}

async function reopenTicket(interaction) {
  const settings = getTicketSettings(interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!isStaff(member, settings)) return interaction.reply({ content: 'Solo lo staff può riaprire un ticket.', ephemeral: true });

  const ticket = getTicketByChannel(interaction.guildId, interaction.channelId);
  if (!ticket || ticket.status !== 'closed') return interaction.reply({ content: 'Questo ticket non è chiuso.', ephemeral: true });

  await interaction.deferReply({ ephemeral: true });
  const others = db.prepare("SELECT COUNT(*) AS n FROM tickets WHERE guild_id = ? AND opener_id = ? AND status = 'open'")
    .get(interaction.guildId, ticket.opener_id).n;
  if (others >= settings.maxOpenPerUser) {
    return interaction.editReply({ content: 'L’utente ha già un altro ticket aperto: chiudilo prima di riaprire questo.' });
  }

  db.prepare("UPDATE tickets SET status = 'open', closed_at = NULL, closed_by = NULL, reopened_at = CURRENT_TIMESTAMP WHERE id = ?").run(ticket.id);
  await setMembersCanWrite(interaction.channel, interaction.client.user.id, true);
  await interaction.channel.send({
    content: `<@${ticket.opener_id}>`,
    embeds: [new EmbedBuilder().setColor(SUCCESS_COLOR).setTitle('🔓 Ticket riaperto')
      .setDescription(`Riaperto da ${interaction.user}.`).setTimestamp()],
    components: [ticketButtons()],
    allowedMentions: { users: [ticket.opener_id] }
  }).catch(() => {});
  await logTicket(interaction.guild, settings, {
    ticket, action: 'reopen', title: 'Ticket riaperto', actorId: interaction.user.id, color: SUCCESS_COLOR
  });
  await interaction.editReply({ content: 'Ticket riaperto.' });
}

async function askDeleteConfirmation(interaction) {
  const settings = getTicketSettings(interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!isStaff(member, settings)) return interaction.reply({ content: 'Solo lo staff può eliminare un ticket.', ephemeral: true });
  const ticket = getTicketByChannel(interaction.guildId, interaction.channelId);
  if (!ticket || ticket.status === 'deleted') return interaction.reply({ content: 'Ticket non trovato.', ephemeral: true });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('auramen:ticket:delete_confirm').setLabel('Sì, elimina').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('auramen:ticket:delete_cancel').setLabel('Annulla').setStyle(ButtonStyle.Secondary)
  );
  const warning = ticket.status === 'open'
    ? '\n⚠️ Questo ticket è ancora **aperto**: chiudilo prima per archiviare il transcript, altrimenti la conversazione andrà persa.'
    : '';
  return interaction.reply({ content: `Vuoi eliminare definitivamente questo canale? L’operazione non è reversibile.${warning}`, components: [row], ephemeral: true });
}

async function confirmDelete(interaction) {
  const settings = getTicketSettings(interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!isStaff(member, settings)) return interaction.reply({ content: 'Solo lo staff può eliminare un ticket.', ephemeral: true });
  const ticket = getTicketByChannel(interaction.guildId, interaction.channelId);
  if (!ticket) return interaction.update({ content: 'Ticket non trovato.', components: [] });

  await interaction.update({ content: 'Eliminazione in corso…', components: [] });
  try {
    await interaction.channel.delete(`Ticket #${ticket.id} eliminato da ${interaction.user.tag}`);
  } catch (error) {
    console.error('Eliminazione ticket fallita:', error);
    return interaction.editReply({ content: 'Non sono riuscito a eliminare il canale (permessi mancanti?).' }).catch(() => {});
  }
  db.prepare("UPDATE tickets SET status = 'deleted', closed_at = COALESCE(closed_at, CURRENT_TIMESTAMP) WHERE id = ?").run(ticket.id);
  await logTicket(interaction.guild, settings, {
    ticket: { ...ticket, channel_id: null }, action: 'delete', title: 'Ticket eliminato', actorId: interaction.user.id,
    details: `Canale #${interaction.channel?.name || ticket.channel_id}`, color: DANGER_COLOR
  });
}

async function claimTicket(interaction) {
  const settings = getTicketSettings(interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!isStaff(member, settings)) return interaction.reply({ content: 'Solo lo staff può claimare un ticket.', ephemeral: true });
  const ticket = db.prepare("SELECT * FROM tickets WHERE channel_id = ? AND status = 'open'").get(interaction.channelId);
  if (!ticket) return interaction.reply({ content: 'Ticket non trovato o già chiuso.', ephemeral: true });
  if (ticket.claimed_by) return interaction.reply({ content: `Ticket già claimato da <@${ticket.claimed_by}>.`, ephemeral: true });
  db.prepare('UPDATE tickets SET claimed_by = ? WHERE id = ?').run(interaction.user.id, ticket.id);
  await interaction.reply({ content: `🙋 Ticket preso in carico da ${interaction.user}.`, allowedMentions: { parse: [] } });
  await logTicket(interaction.guild, settings, { ticket, action: 'claim', title: 'Ticket preso in carico', actorId: interaction.user.id });
}

async function handleButton(interaction) {
  if (!interaction.customId.startsWith('auramen:ticket:')) return false;
  if (!interaction.inGuild()) {
    await interaction.reply({ content: 'I ticket funzionano solo dentro un server.', ephemeral: true });
    return true;
  }
  const action = interaction.customId.split(':')[2];
  if (action === 'open') await openTicket(interaction);
  else if (action === 'claim') await claimTicket(interaction);
  else if (action === 'close') await closeTicket(interaction, interaction.channel);
  else if (action === 'reopen') await reopenTicket(interaction);
  else if (action === 'delete') await askDeleteConfirmation(interaction);
  else if (action === 'delete_confirm') await confirmDelete(interaction);
  else if (action === 'delete_cancel') await interaction.update({ content: 'Eliminazione annullata.', components: [] });
  return true;
}

module.exports = {
  publishPanel, handleButton, closeTicket,
  getTicketSettings, updateTicketConfig, isStaff, logTicket, getTicketByChannel,
  DEFAULT_PANEL, DEFAULT_WELCOME, BRAND_COLOR, reply
};
